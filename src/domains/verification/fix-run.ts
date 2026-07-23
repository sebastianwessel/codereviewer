// Production composition of the agentic finding investigation-and-fix job
// (spec 12). When `fix.enabled`, it turns this run's admitted findings at or above
// the resolved `minSeverity` into `current-finding` claims, runs them through the
// SAME `investigate_claim` agent as verification (via `runInvestigationFlow` — no
// second agent loop), then deterministically apply-checks each produced fix and
// enriches the matching finding's `fixProposal`.
//
// It is advisory and non-fatal: with the job disabled, no eligible findings, or an
// unresolved provider, it returns the findings unchanged and an empty report. It
// never changes a finding's category, severity, admission, or the quality gate.

import { readFile } from 'node:fs/promises'
import type {
  CodeReviewerConfig,
  Severity
} from '../../shared/contracts/index.js'
import type { AdmittedFinding } from '../../shared/contracts/findings/finding.schema.js'
import type { RunTokenUsage } from '../costs/index.js'
import { resolveExistingPathInsideRoot } from '../../platform/path-service.js'
import {
  createCurrentFindingsProvider,
  eligibleCurrentFindings
} from './current-findings-provider.js'
import {
  enrichFindingsWithFixes,
  type CurrentFileReader
} from './fix-enrichment.js'
import {
  runInvestigationFlow,
  type InvestigationRunContext
} from './investigation-run.js'
import {
  emptyVerificationReport,
  VerificationReportSchema,
  type VerificationReport
} from './verification-report.js'

export type FixRunResult = {
  readonly report: VerificationReport
  // This run's admitted findings, with `fixProposal` enriched in place for any
  // `real` finding whose apply-check passed. Every other finding is byte-for-byte
  // as admitted.
  readonly findings: readonly AdmittedFinding[]
  readonly usage?: RunTokenUsage | undefined
}

/**
 * Resolves the fix lane's effective severity floor. `fix.minSeverity` tracks
 * `aiReview.actionableSeverityThreshold` (itself default `medium`) when unset, so
 * out of the box the lane runs on exactly the findings that can block the pipeline.
 */
export const resolveFixMinSeverity = (config: CodeReviewerConfig): Severity =>
  config.fix.minSeverity ?? config.aiReview.actionableSeverityThreshold

const currentFileReaderFor = (repositoryRoot: string): CurrentFileReader => async (
  repositoryRelativePath
) => {
  try {
    return await readFile(
      await resolveExistingPathInsideRoot(repositoryRoot, repositoryRelativePath),
      'utf8'
    )
  } catch {
    // A deleted or ineligible file makes the apply-check fail closed.
    return undefined
  }
}

export const runFixRun = async (
  input: InvestigationRunContext & {
    readonly admittedFindings: readonly AdmittedFinding[]
  }
): Promise<FixRunResult> => {
  if (!input.config.fix.enabled) {
    return { report: emptyVerificationReport(), findings: input.admittedFindings }
  }

  const minSeverity = resolveFixMinSeverity(input.config)

  // Early exit before any provider resolution when nothing is eligible.
  if (eligibleCurrentFindings(input.admittedFindings, minSeverity).length === 0) {
    return { report: emptyVerificationReport(), findings: input.admittedFindings }
  }

  const provider = createCurrentFindingsProvider({
    findings: input.admittedFindings,
    minSeverity
  })

  const { report, usage } = await runInvestigationFlow({
    ...input,
    providers: [provider]
  })

  const enrichment = await enrichFindingsWithFixes({
    findings: input.admittedFindings,
    verdicts: report.verdicts,
    observations: report.observations,
    readFile: currentFileReaderFor(input.repositoryRoot)
  })

  const fixReport = VerificationReportSchema.parse({
    ...report,
    observations: enrichment.observations,
    fixOutcomes: enrichment.fixOutcomes
  })

  return {
    report: fixReport,
    findings: enrichment.findings,
    ...(usage === undefined ? {} : { usage })
  }
}
