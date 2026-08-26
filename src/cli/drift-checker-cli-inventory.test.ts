// The drift checker's CLI inventory must match the CLI's real dispatch.
//
// `drift check` reports documentation naming a command the implementation does not
// provide. It decides that against a hand-written set in the drift domain, because a
// domain must not import from the CLI layer — which makes that set a SECOND SOURCE OF
// TRUTH, and it drifted: `intent` was missing long after `intent check` shipped, so
// every spec documenting the command correctly was reported as documenting a command
// that does not exist. That finding is `error`-gated, so it failed `drift check`
// outright and kept the gate out of CI entirely.
//
// A checker that reports the truth as drift is worse than no checker: it trains people
// to ignore it. This test lives in the CLI layer so it may import both sides, and
// fails whenever a command is added or removed without updating the mirror.
//
// `implementedCliCommands` is deliberately NOT on `drift`'s barrel and is imported by
// module path instead. It is an internal of the checker, and `src/index.ts` re-exports
// the `drift` barrel wholesale, so publishing it to satisfy one test would put an
// implementation detail in the package's public API. This is the whole exception.

import { describe, expect, test } from 'vitest'
import { implementedCliCommands } from '../domains/drift/drift-checker.js'
import { runCli } from './index.js'

// The usage message is the CLI's own enumeration of what it dispatches. Reading the
// inventory back out of it means the test cannot pass by agreeing with a stale copy.
const commandsFromUsage = async (): Promise<ReadonlySet<string>> => {
  const result = await runCli([], { cwd: process.cwd(), environment: {} })
  const { message } = JSON.parse(result.stderr) as { message: string }
  const list = message.replace(/^Expected command:\s*/u, '')

  return new Set(
    list
      .split(',')
      .map((entry) => entry.trim().replace(/^or\s+/u, ''))
      // Each entry is either `review` or `<command> <subcommand>`; the inventory
      // tracks the command, which is what documentation is matched on.
      .map((entry) => entry.split(/\s+/u)[0])
      .filter((command): command is string => command !== undefined && command !== '')
  )
}

describe('drift checker CLI inventory', () => {
  test('matches the commands the CLI actually dispatches', async () => {
    expect([...(await commandsFromUsage())].sort()).toEqual(
      [...implementedCliCommands].sort()
    )
  })

  test('includes intent, the command whose absence broke the gate', async () => {
    // Pinned separately so the regression that motivated this file is named. A
    // wholesale rewrite of the usage string cannot quietly drop it.
    expect(await commandsFromUsage()).toContain('intent')
    expect(implementedCliCommands).toContain('intent')
  })
})
