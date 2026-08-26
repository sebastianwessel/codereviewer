// The command-line half of the committed evaluation configuration: reading
// `--capability <flag>=<true|false>` off argv.
//
// The pin table itself — which capabilities an eval run pins, to what, and why —
// is measurement policy and lives with the runner, in
// `src/domains/evaluation/run/eval-capability-pins.ts`. This file holds only the
// argv parsing, because that is a CLI concern and it needs `parseOptionValues`
// beside it; moving it into the domain would make the evaluation domain import
// `src/cli/`, which is the layering inversion the split exists to avoid.
//
// The accepted flag set is derived from the pin table rather than restated here,
// so a pin added or removed in the domain cannot leave the parser accepting or
// refusing a flag the pins no longer describe.
import { evalCapabilityPins } from '../domains/evaluation/index.js'
import { parseOptionValues } from './args.js'

const capabilityOverrideOption = '--capability'

const pinnedFlags = new Set<string>(evalCapabilityPins.map((pin) => pin.flag))

/**
 * Reads `--capability <flag>=<true|false>` (repeatable) — the deliberate escape
 * from a pin, spelled out on the command line where it lands in the run log and
 * in the shell history that produced the artifact.
 *
 * A flag outside the pinned set is REFUSED rather than folded into the config:
 * an unpinned capability is already governed by the configuration file, so
 * accepting it here would offer two ways to set one value and quietly make the
 * documented one lose.
 */
export const parseEvalCapabilityOverrides = (
  args: readonly string[]
): ReadonlyMap<string, boolean> => {
  const overrides = new Map<string, boolean>()

  for (const entry of parseOptionValues(args, capabilityOverrideOption)) {
    const separatorIndex = entry.indexOf('=')

    if (separatorIndex === -1) {
      throw new TypeError(
        `${capabilityOverrideOption} must be <flag>=true or <flag>=false`
      )
    }

    const flag = entry.slice(0, separatorIndex)
    const value = entry.slice(separatorIndex + 1)

    if (!pinnedFlags.has(flag)) {
      throw new TypeError(
        `${capabilityOverrideOption} does not pin "${flag}". Pinned flags are ${[...pinnedFlags].join(', ')}.`
      )
    }

    if (value !== 'true' && value !== 'false') {
      throw new TypeError(
        `${capabilityOverrideOption} ${flag} must be true or false`
      )
    }

    overrides.set(flag, value === 'true')
  }

  return overrides
}
