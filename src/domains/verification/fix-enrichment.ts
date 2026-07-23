// Pure fix-lane enrichment (spec 12 "Effect On Findings, Severity, And The Gate").
// Given the run's admitted findings, the `current-finding` outcomes the
// investigation agent produced, and a reader for the current file bytes, this maps
// each outcome back to its finding and, for a `real` finding whose proposed edits
// pass the deterministic apply-check, ENRICHES that finding's `fixProposal` with
// the apply-checked edits (`safety: 'manual-review'`).
//
// It is strictly ADVISORY: it only ever rewrites advisory `fixProposal` metadata.
// It never touches a finding's category, severity, admission, reporter
// eligibility, fingerprints, or the quality gate, and a `false-positive` judgment
// does NOT remove the finding — it is surfaced only as a boolean signal in the
// returned `fixOutcomes`. Every enriched finding is re-validated through
// `AdmittedFindingSchema`, so a malformed enrichment can never corrupt the report.

import {
  AdmittedFindingSchema,
  FixProposalSchema,
  type AdmittedFinding
} from '../../shared/contracts/findings/finding.schema.js'
import type { Verdict } from '../../shared/contracts/verification/verification.schema.js'
import { createRedactor } from '../../shared/redaction/redactor.js'
import { truncateForContract } from '../../shared/text/truncate.js'
import { currentFindingClaimId } from './current-findings-provider.js'
import { applyFixEdits } from './apply-check.js'
import type {
  ApplyCheckOutcome,
  ClaimObservation,
  FixOutcome
} from './verification-report.js'

const FIX_PROPOSAL_SUMMARY_MAX = 1200

// Reads the current bytes of a repository file the agent already investigated.
// Returns `undefined` when the file cannot be read (deleted, ineligible), which
// makes the apply-check fail closed and the fix not produced.
export type CurrentFileReader = (
  repositoryRelativePath: string
) => Promise<string | undefined>

export type FixEnrichmentResult = {
  readonly findings: readonly AdmittedFinding[]
  readonly fixOutcomes: readonly FixOutcome[]
  // The input observations, augmented with the per-claim fix outcome so the flow
  // report records whether a fix was produced and the apply-check result.
  readonly observations: readonly ClaimObservation[]
}

type PerClaimOutcome = {
  readonly findingId: string
  readonly enrichedFinding?: AdmittedFinding
  readonly fixOutcome: FixOutcome
}

const enrichedFixProposal = (
  finding: AdmittedFinding,
  verdict: Verdict,
  redact: (value: string) => string
) => {
  // The proposal cites the finding's own admission evidence only: the contract
  // requires `fixProposal.evidenceIds` to be a subset of the finding's evidence,
  // and those ids resolve in `report.json`'s `evidence[]`. The agent's own read
  // evidence is recorded separately in the fix report, so it never becomes a
  // dangling reference here.
  const evidenceIds = [...new Set(finding.evidenceIds)]

  return FixProposalSchema.parse({
    summary: truncateForContract(redact(verdict.rationale), FIX_PROPOSAL_SUMMARY_MAX),
    evidenceIds,
    safety: 'manual-review',
    edits: verdict.fixEdits
  })
}

const outcomeForFinding = async (input: {
  readonly finding: AdmittedFinding
  readonly verdict: Verdict
  readonly readFile: CurrentFileReader
  readonly redact: (value: string) => string
}): Promise<PerClaimOutcome> => {
  const { finding, verdict } = input
  const base = {
    findingId: finding.id,
    ...(verdict.findingJudgment === undefined
      ? {}
      : { findingJudgment: verdict.findingJudgment })
  }

  const isReal = verdict.findingJudgment === 'real'
  const edits = verdict.fixEdits ?? []
  const editsTargetFinding =
    edits.length > 0 &&
    edits.every((edit) => edit.path === finding.location.path)

  if (!isReal || !editsTargetFinding) {
    // Not a real finding, or no scoped single-file fix to check.
    const applyCheck: ApplyCheckOutcome = 'not-attempted'
    return { findingId: finding.id, fixOutcome: { ...base, fixProduced: false, applyCheck } }
  }

  const content = await input.readFile(finding.location.path)
  if (content === undefined) {
    return {
      findingId: finding.id,
      fixOutcome: { ...base, fixProduced: false, applyCheck: 'failed' }
    }
  }

  const applied = applyFixEdits(content, edits)
  if (!applied.ok) {
    // A hallucinated line number or stale location: drop the fix (spec 12).
    return {
      findingId: finding.id,
      fixOutcome: { ...base, fixProduced: false, applyCheck: 'failed' }
    }
  }

  const enrichedFinding = AdmittedFindingSchema.parse({
    ...finding,
    fixProposal: enrichedFixProposal(finding, verdict, input.redact)
  })

  return {
    findingId: finding.id,
    enrichedFinding,
    fixOutcome: { ...base, fixProduced: true, applyCheck: 'passed' }
  }
}

export const enrichFindingsWithFixes = async (input: {
  readonly findings: readonly AdmittedFinding[]
  readonly verdicts: readonly Verdict[]
  readonly observations: readonly ClaimObservation[]
  readonly readFile: CurrentFileReader
}): Promise<FixEnrichmentResult> => {
  const redactor = createRedactor()
  const verdictByClaimId = new Map(
    input.verdicts.map((verdict) => [verdict.claimId, verdict])
  )

  const outcomesByFindingId = new Map<string, PerClaimOutcome>()
  const enrichedByFindingId = new Map<string, AdmittedFinding>()

  for (const finding of input.findings) {
    const verdict = verdictByClaimId.get(currentFindingClaimId(finding.id))
    // Only current-finding claims that actually produced a judgment participate;
    // a finding the agent could not judge is left exactly as admitted.
    if (verdict === undefined || verdict.findingJudgment === undefined) {
      continue
    }

    const outcome = await outcomeForFinding({
      finding,
      verdict,
      readFile: input.readFile,
      redact: redactor.redact
    })
    outcomesByFindingId.set(finding.id, outcome)
    if (outcome.enrichedFinding !== undefined) {
      enrichedByFindingId.set(finding.id, outcome.enrichedFinding)
    }
  }

  const findings = input.findings.map(
    (finding) => enrichedByFindingId.get(finding.id) ?? finding
  )
  const fixOutcomes = [...outcomesByFindingId.values()].map(
    (outcome) => outcome.fixOutcome
  )

  // Augment each observation with the per-claim fix outcome (keyed by claim id
  // derived from the finding id).
  const outcomeByClaimId = new Map<string, FixOutcome>(
    [...outcomesByFindingId.values()].map((outcome) => [
      currentFindingClaimId(outcome.findingId),
      outcome.fixOutcome
    ])
  )
  const observations = input.observations.map((observation) => {
    const outcome = outcomeByClaimId.get(observation.claimId)
    if (outcome === undefined) {
      return observation
    }

    return {
      ...observation,
      fixProduced: outcome.fixProduced,
      applyCheck: outcome.applyCheck
    }
  })

  return { findings, fixOutcomes, observations }
}
