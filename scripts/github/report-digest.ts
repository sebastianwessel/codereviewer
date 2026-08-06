// Reduces the engine's four report shapes to exactly what the pull-request
// comment renders.
//
// The schemas below are DELIBERATELY loose, and deliberately not the engine's
// own strict contracts. Two reasons:
//
//   - A report gains a field far more often than it loses one. Parsing with the
//     engine's strict schemas would make every additive contract change break
//     the integration, and the failure would land on the comment — the one
//     surface whose job is to still say something useful when a stage went
//     wrong.
//   - This integration must also work against an installed build of the engine,
//     which may be a different version than the workflow it runs from.
//
// So each digest reads the fields it renders, tolerates their absence, and
// returns `undefined` only when the document is not the report it claims to be.
import { z } from 'zod'

const SeveritySchema = z.enum(['critical', 'high', 'medium', 'low', 'info'])

export type Severity = z.infer<typeof SeveritySchema>

/** Most severe first. Shared by the counters and the comment's ordering. */
export const severityOrder: readonly Severity[] = [
  'critical',
  'high',
  'medium',
  'low',
  'info'
]

const LocationSchema = z.object({
  path: z.string(),
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1).nullish()
})

const AdmittedFindingSchema = z.object({
  id: z.string(),
  severity: SeveritySchema,
  category: z.string(),
  title: z.string(),
  description: z.string().nullish(),
  location: LocationSchema,
  baselineStatus: z.string().nullish(),
  reporterEligibility: z.string().nullish(),
  // The link into `refutationResults`. Without it the comment can state that a
  // finding exists but not what was tried against it, which is the difference
  // between a claim a reviewer can check and one they must take on faith.
  refutationId: z.string().nullish(),
  fingerprints: z
    .array(z.object({ value: z.string() }))
    .nullish()
})

const RefutationResultSchema = z.object({
  id: z.string(),
  verdict: z.string(),
  summary: z.string()
})

const ReviewReportSchema = z.object({
  run: z.object({
    runId: z.string(),
    costUsd: z.number().nullish(),
    warnings: z.array(z.string()).nullish()
  }),
  coverage: z.object({ status: z.string() }).nullish(),
  admittedFindings: z.array(AdmittedFindingSchema).nullish(),
  // Every candidate refutation or the deterministic admission gate killed. Not
  // `AdmittedFinding`s — they never reached admission — so only the count is
  // parsed; the digest states how many were thrown out, not why, and points the
  // reader at the run artifact for the reasons.
  rejectedFindings: z.array(z.unknown()).nullish(),
  refutationResults: z.array(RefutationResultSchema).nullish(),
  skippedFiles: z.array(z.unknown()).nullish(),
  qualityGate: z
    .object({
      passed: z.boolean(),
      failingFindingIds: z.array(z.string()).nullish()
    })
    .nullish(),
  providerIssues: z
    .array(z.object({ code: z.string(), message: z.string().nullish() }))
    .nullish(),
  // Baseline fingerprints that no longer match any current finding — i.e. fixed
  // since the baseline was recorded. Present (possibly empty) only when
  // `baseline.includeResolvedInReport` was enabled for the run; absent means the
  // count was never computed, which is a different fact from a computed zero and
  // must not collapse into it.
  resolvedBaselineEntries: z.array(z.unknown()).nullish(),
  // Spec 27 discovery telemetry. Optional: a deterministic-only run issues no
  // discovery call and has none to report. Only the one counter this digest
  // renders is parsed.
  discovery: z
    .object({
      totals: z
        .object({ mergedAwayCount: z.number().int().min(0).nullish() })
        .nullish()
    })
    .nullish()
})

export type FindingDigest = {
  readonly id: string
  readonly severity: Severity
  readonly category: string
  readonly title: string
  readonly description: string
  readonly path: string
  readonly startLine: number
  readonly baselineStatus: string
  /**
   * `inline` | `summary-only` | `artifact-only`, carried verbatim from
   * admission. `artifact-only` marks a finding refutation could neither prove
   * nor disprove (`needs-more-evidence`): a real suspicion kept as a question
   * for a human rather than dropped. It is excluded from the quality gate, from
   * inline comments, and — by the renderer, not this type — from the actionable
   * findings list. Defaults to `'unknown'` when a report omits the field, which
   * renders as actionable rather than guessing it away as unresolved.
   */
  readonly reporterEligibility: string
  /**
   * What refutation tried against this finding and could not do, in the
   * refuter's own words. Absent when no verdict was recorded against it.
   */
  readonly whySurvived?: string
  /**
   * The finding's stable, content-anchored fingerprint. Used as the identity of
   * an inline comment across runs: finding ids are generated per run, so they
   * cannot tell a re-reported defect from a new one.
   */
  readonly fingerprint?: string
}

export type ReviewDigest = {
  readonly runId: string
  readonly qualityGatePassed: boolean
  readonly qualityGateEvaluated: boolean
  readonly failingFindingIds: readonly string[]
  readonly findings: readonly FindingDigest[]
  readonly severityCounts: Readonly<Record<Severity, number>>
  readonly coverageStatus: string
  readonly skippedFileCount: number
  readonly warnings: readonly string[]
  readonly providerIssues: readonly string[]
  readonly costUsd?: number
  /**
   * Every candidate that reached refutation or the deterministic admission gate
   * and was thrown out — killed by refutation or the gate, not merged away as a
   * duplicate. Always a count, defaulting to 0 like `skippedFileCount`: the
   * engine's own report always carries this array, possibly empty.
   */
  readonly rejectedFindingCount: number
  /**
   * Candidates the semantic merge folded into another as a duplicate before
   * refutation ever saw them. Undefined — not 0 — when the report carries no
   * `discovery` telemetry at all (a deterministic-only run issued no discovery
   * call), so silence about merging is never confused with a computed zero.
   */
  readonly mergedAwayCount?: number
  /**
   * Baseline fingerprints resolved since the baseline was recorded (fixed since
   * then). Undefined — not 0 — when the run never computed this at all
   * (`baseline.includeResolvedInReport` was off); a computed zero is a fact
   * worth stating, an uncomputed one is not. The baseline stores fingerprints
   * only, so a count is genuinely everything this can say — never which defect
   * it was.
   */
  readonly resolvedBaselineEntryCount?: number
}

const parseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return undefined
  }
}

const countBySeverity = (
  findings: readonly FindingDigest[]
): Readonly<Record<Severity, number>> => {
  const counts: Record<Severity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0
  }

  for (const finding of findings) {
    counts[finding.severity] += 1
  }

  return counts
}

export const digestReviewReport = (raw: string): ReviewDigest | undefined => {
  const parsed = ReviewReportSchema.safeParse(parseJson(raw))

  if (!parsed.success) {
    return undefined
  }

  const report = parsed.data
  const refutationById = new Map(
    (report.refutationResults ?? []).map((refutation) => [
      refutation.id,
      refutation
    ])
  )
  const findings: readonly FindingDigest[] = (report.admittedFindings ?? []).map(
    (finding) => {
      const fingerprint = finding.fingerprints?.[0]?.value
      const refutation =
        finding.refutationId === undefined || finding.refutationId === null
          ? undefined
          : refutationById.get(finding.refutationId)

      return {
        id: finding.id,
        severity: finding.severity,
        category: finding.category,
        title: finding.title,
        description: finding.description ?? '',
        path: finding.location.path,
        startLine: finding.location.startLine,
        baselineStatus: finding.baselineStatus ?? 'unknown',
        reporterEligibility: finding.reporterEligibility ?? 'unknown',
        ...(refutation === undefined
          ? {}
          : { whySurvived: `${refutation.verdict}: ${refutation.summary}` }),
        ...(fingerprint === undefined ? {} : { fingerprint })
      }
    }
  )

  // Severity counts describe what a reader needs to act on, so — like the
  // rendered findings list itself — they exclude `artifact-only` findings.
  // Otherwise the "N high, M medium" line would count suspicions the run could
  // neither prove nor disprove alongside proved defects, with no way to tell
  // them apart.
  const actionableFindings = findings.filter(
    (finding) => finding.reporterEligibility !== 'artifact-only'
  )
  const resolvedBaselineEntries = report.resolvedBaselineEntries
  const mergedAwayCount = report.discovery?.totals?.mergedAwayCount

  return {
    runId: report.run.runId,
    qualityGatePassed: report.qualityGate?.passed ?? true,
    qualityGateEvaluated: report.qualityGate !== undefined && report.qualityGate !== null,
    failingFindingIds: report.qualityGate?.failingFindingIds ?? [],
    findings,
    severityCounts: countBySeverity(actionableFindings),
    coverageStatus: report.coverage?.status ?? 'unknown',
    skippedFileCount: report.skippedFiles?.length ?? 0,
    warnings: report.run.warnings ?? [],
    providerIssues: (report.providerIssues ?? []).map((issue) =>
      issue.message === undefined || issue.message === null
        ? issue.code
        : `${issue.code}: ${issue.message}`
    ),
    rejectedFindingCount: report.rejectedFindings?.length ?? 0,
    ...(report.run.costUsd === undefined || report.run.costUsd === null
      ? {}
      : { costUsd: report.run.costUsd }),
    ...(mergedAwayCount === undefined || mergedAwayCount === null
      ? {}
      : { mergedAwayCount }),
    ...(resolvedBaselineEntries === undefined || resolvedBaselineEntries === null
      ? {}
      : { resolvedBaselineEntryCount: resolvedBaselineEntries.length })
  }
}

const IntentReportSchema = z.object({
  status: z.string(),
  summary: z
    .object({
      obligationCount: z.number().int().nullish(),
      evidencedCount: z.number().int().nullish(),
      notEvidencedCount: z.number().int().nullish(),
      notContradictedCount: z.number().int().nullish(),
      undeterminedCount: z.number().int().nullish(),
      extraScopeFileCount: z.number().int().nullish()
    })
    .nullish(),
  obligations: z
    .array(
      z.object({
        statement: z.string(),
        status: z.string(),
        source: z.object({ text: z.string().nullish() }).nullish()
      })
    )
    .nullish(),
  explanation: z.string().nullish(),
  warnings: z.array(z.string()).nullish()
})

export type IntentObligationDigest = {
  readonly statement: string
  readonly status: string
}

export type IntentDigest = {
  readonly status: string
  readonly obligationCount: number
  readonly evidencedCount: number
  readonly notEvidencedCount: number
  readonly notContradictedCount: number
  readonly undeterminedCount: number
  readonly extraScopeFileCount: number
  readonly unevidenced: readonly IntentObligationDigest[]
  readonly explanation?: string
  readonly warnings: readonly string[]
}

export const digestIntentReport = (raw: string): IntentDigest | undefined => {
  const parsed = IntentReportSchema.safeParse(parseJson(raw))

  if (!parsed.success) {
    return undefined
  }

  const report = parsed.data
  const obligations = report.obligations ?? []

  return {
    status: report.status,
    obligationCount: report.summary?.obligationCount ?? obligations.length,
    evidencedCount: report.summary?.evidencedCount ?? 0,
    notEvidencedCount: report.summary?.notEvidencedCount ?? 0,
    notContradictedCount: report.summary?.notContradictedCount ?? 0,
    undeterminedCount: report.summary?.undeterminedCount ?? 0,
    extraScopeFileCount: report.summary?.extraScopeFileCount ?? 0,
    // `not-contradicted` is excluded as deliberately as `evidenced` is. It is the
    // engine's answer for an obligation asking that something NOT be done, which
    // this change does not do — it produces no citation by its nature, so listing it
    // under "nothing evidences these" would put an obligation nobody can act on in
    // front of a reviewer on every run. That was 39.8% of the lane's classified
    // false positives before the status existed; recreating it here would move the
    // defect from the report to the comment.
    unevidenced: obligations
      .filter(
        (obligation) =>
          obligation.status !== 'evidenced' &&
          obligation.status !== 'not-contradicted'
      )
      .map((obligation) => ({
        statement: obligation.statement,
        status: obligation.status
      })),
    ...(report.explanation === undefined || report.explanation === null
      ? {}
      : { explanation: report.explanation }),
    warnings: report.warnings ?? []
  }
}

const ImpactReportSchema = z.object({
  status: z.string(),
  summary: z
    .object({
      changedSymbolCount: z.number().int().nullish(),
      referencedSymbolCount: z.number().int().nullish(),
      referenceCount: z.number().int().nullish(),
      testReferenceCount: z.number().int().nullish()
    })
    .nullish(),
  symbols: z
    .array(
      z.object({
        name: z.string(),
        definitionPath: z.string(),
        changeKind: z.string().nullish(),
        references: z.array(z.unknown()).nullish(),
        testReferences: z.array(z.unknown()).nullish()
      })
    )
    .nullish(),
  warnings: z.array(z.string()).nullish()
})

export type ImpactSymbolDigest = {
  readonly name: string
  readonly definitionPath: string
  readonly changeKind: string
  readonly referenceCount: number
  readonly testReferenceCount: number
}

export type ImpactDigest = {
  readonly status: string
  readonly changedSymbolCount: number
  readonly referenceCount: number
  readonly testReferenceCount: number
  readonly symbols: readonly ImpactSymbolDigest[]
  readonly warnings: readonly string[]
}

export const digestImpactReport = (raw: string): ImpactDigest | undefined => {
  const parsed = ImpactReportSchema.safeParse(parseJson(raw))

  if (!parsed.success) {
    return undefined
  }

  const report = parsed.data

  return {
    status: report.status,
    changedSymbolCount: report.summary?.changedSymbolCount ?? 0,
    referenceCount: report.summary?.referenceCount ?? 0,
    testReferenceCount: report.summary?.testReferenceCount ?? 0,
    symbols: (report.symbols ?? [])
      .map((symbol) => ({
        name: symbol.name,
        definitionPath: symbol.definitionPath,
        changeKind: symbol.changeKind ?? 'modified',
        referenceCount: symbol.references?.length ?? 0,
        testReferenceCount: symbol.testReferences?.length ?? 0
      }))
      .filter(
        (symbol) => symbol.referenceCount > 0 || symbol.testReferenceCount > 0
      ),
    warnings: report.warnings ?? []
  }
}

