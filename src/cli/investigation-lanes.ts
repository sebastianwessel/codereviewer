// The two post-review investigation lanes (spec 12) as the `review` command
// drives them. Both run through the same agent with the same wiring, so they
// share one input shape and one context builder.
import {
  corroborateFindings,
  runFixRun,
  runVerificationRun,
  type InvestigationRunContext,
  type VerificationReport
} from '../domains/verification/index.js'
import type { Logger } from '../domains/observability/index.js'
import type {
  AdmittedFinding,
  CodeReviewerConfig
} from '../shared/contracts/index.js'
import type { CliRunOptions } from './cli-contract.js'

// Everything both post-review investigation lanes (spec 12) take from the CLI
// run.
export type InvestigationLaneInput = {
  readonly options: CliRunOptions
  readonly config: CodeReviewerConfig
  readonly environment: Readonly<Record<string, string | undefined>>
  readonly admittedFindings: readonly AdmittedFinding[]
  readonly logger: Logger
}

// Both lanes run through the same agent with the same wiring, so the context is
// built once here rather than assembled per lane.
const investigationContextFor = (
  input: InvestigationLaneInput
): InvestigationRunContext => ({
  config: input.config,
  repositoryRoot: input.options.cwd,
  environment: input.environment,
  logger: input.logger,
  ...(input.options.providerImport === undefined
    ? {}
    : { providerImport: input.options.providerImport })
})

// Runs the agentic verification flow after the general review when it is enabled
// (spec 12). It is a separate lane: with verification disabled this returns
// `undefined` and the general review is byte-for-byte unchanged. The flow is
// non-fatal by construction — a missing provider or a failed claim provider
// yields a report (empty, or carrying warnings) rather than throwing.
export const runVerificationForReview = async (
  input: InvestigationLaneInput
): Promise<VerificationReport | undefined> => {
  if (!input.config.verification.enabled) {
    return undefined
  }

  const { report, claims } = await runVerificationRun(
    investigationContextFor(input)
  )

  // Cross-witness: a confirmed verdict that lands on a general-review finding
  // raises that finding's confidence (never its severity). Surfaced in the
  // verification report so the "strong finding" signal is visible in output.
  const corroborations = corroborateFindings({
    findings: input.admittedFindings,
    verdicts: report.verdicts,
    claims
  })

  return { ...report, corroborations: [...corroborations] }
}

// Runs the agentic finding investigation-and-fix lane after the general review
// when it is enabled (spec 12). It reuses the same investigation agent as
// verification. With the lane disabled (or no eligible finding / unresolved
// provider) it returns the findings unchanged and no report. It is advisory: it
// only enriches advisory `fixProposal` metadata on `real` findings whose
// apply-check passes, and never changes category, severity, admission, or the gate.
export const runFixForReview = async (
  input: InvestigationLaneInput
): Promise<{
  readonly report: VerificationReport | undefined
  readonly findings: readonly AdmittedFinding[]
}> => {
  if (!input.config.fix.enabled) {
    return { report: undefined, findings: input.admittedFindings }
  }

  const { report, findings } = await runFixRun({
    ...investigationContextFor(input),
    admittedFindings: input.admittedFindings
  })

  return { report, findings }
}
