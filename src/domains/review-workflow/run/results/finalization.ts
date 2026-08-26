import {
  resolveBaselineFingerprints,
  type BaselineFingerprintRecord
} from '../../../admission/index.js'
import {
  summarizeRunCost,
  type RunCostSummary,
  type RunTokenUsage
} from '../../../costs/index.js'
import type { DriftFinding } from '../../../drift/index.js'
import type {
  AdmittedFinding,
  CodeReviewerConfig,
  FindingFingerprint
} from '../../../../shared/contracts/index.js'
import { driftWarningsFor } from '../drift.js'

export const prepareReviewRunFinalization = (
  input: {
    readonly config: CodeReviewerConfig
    readonly configWarnings?: readonly string[] | undefined
    readonly driftFindings: readonly DriftFinding[]
    readonly admissionWarnings: readonly string[]
    readonly contextIngestionWarnings?: readonly string[] | undefined
    // Kept apart from the ingestion warnings above rather than folded into them:
    // both describe context the reviewer did not read as written, but one points
    // at an external provider's configuration and the other at a secret pattern
    // matching this repository's own source. Merging them would put a redaction
    // behind a message about provider caps.
    readonly contextRedactionWarnings?: readonly string[] | undefined
    // Context the reviewer never saw because the referenced-definition caps kept
    // it out, or because a resolved dependency could not be read. Its own input
    // for the same reason the two above are separate: this one is about what the
    // engine's own bounds withheld from the model, not about an external provider
    // or a redaction pattern, and the remedy differs again.
    readonly referencedDefinitionWarnings?: readonly string[] | undefined
    readonly admittedFindings: readonly AdmittedFinding[]
    readonly baselineFingerprints?: readonly BaselineFingerprintRecord[] | undefined
    readonly providerUsage?: RunTokenUsage | undefined
  }
): {
  readonly runCost: RunCostSummary
  readonly warnings: readonly string[]
  // Undefined means "this run did not compute it", which is a different claim
  // from an empty array and must stay tellable apart all the way to the report.
  readonly resolvedBaselineEntries: readonly FindingFingerprint[] | undefined
} => {
  // No baseline fingerprints means there was nothing to resolve AGAINST — a
  // configured baseline file that does not exist yet (`run/baseline.ts` returns
  // undefined on ENOENT), or no baseline at all. `?? []` turned that absence into
  // a comparison against an empty set, and an empty set resolves nothing, so the
  // report carried a COMPUTED zero. The pull-request digest reads a computed
  // empty array as a real zero deliberately, so the comment stated that zero
  // previously-flagged findings failed to come back — from a run that compared
  // against nothing, and which said so everywhere else (`baselineStatus:
  // unknown`, warning `baseline-missing`).
  //
  // A baseline that EXISTS and resolves nothing still returns `[]`, because that
  // one is a measurement.
  const resolvedBaselineEntries =
    input.config.baseline.includeResolvedInReport &&
    input.baselineFingerprints !== undefined
      ? resolveBaselineFingerprints(
          input.baselineFingerprints,
          input.admittedFindings
        )
      : undefined
  const runCost = summarizeRunCost({
    providerConfigured: input.config.provider !== undefined,
    ...(input.config.provider === undefined
      ? {}
      : {
          providerId: input.config.provider.id,
          modelName: input.config.provider.model
        }),
    prices: input.config.costs,
    ...(input.providerUsage === undefined ? {} : { usage: input.providerUsage })
  })
  const warnings = [
    ...(input.configWarnings ?? []),
    ...driftWarningsFor(input.driftFindings),
    ...input.admissionWarnings,
    ...(input.contextIngestionWarnings ?? []),
    ...(input.contextRedactionWarnings ?? []),
    ...(input.referencedDefinitionWarnings ?? []),
    ...runCost.warnings
  ]

  return {
    runCost,
    warnings,
    resolvedBaselineEntries
  }
}
