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
  fingerprints: z
    .array(z.object({ value: z.string() }))
    .nullish()
})

const ReviewReportSchema = z.object({
  run: z.object({
    runId: z.string(),
    costUsd: z.number().nullish(),
    warnings: z.array(z.string()).nullish()
  }),
  coverage: z.object({ status: z.string() }).nullish(),
  admittedFindings: z.array(AdmittedFindingSchema).nullish(),
  skippedFiles: z.array(z.unknown()).nullish(),
  qualityGate: z
    .object({
      passed: z.boolean(),
      failingFindingIds: z.array(z.string()).nullish()
    })
    .nullish(),
  providerIssues: z
    .array(z.object({ code: z.string(), message: z.string().nullish() }))
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
  const findings: readonly FindingDigest[] = (report.admittedFindings ?? []).map(
    (finding) => {
      const fingerprint = finding.fingerprints?.[0]?.value

      return {
        id: finding.id,
        severity: finding.severity,
        category: finding.category,
        title: finding.title,
        description: finding.description ?? '',
        path: finding.location.path,
        startLine: finding.location.startLine,
        baselineStatus: finding.baselineStatus ?? 'unknown',
        ...(fingerprint === undefined ? {} : { fingerprint })
      }
    }
  )

  return {
    runId: report.run.runId,
    qualityGatePassed: report.qualityGate?.passed ?? true,
    qualityGateEvaluated: report.qualityGate !== undefined && report.qualityGate !== null,
    failingFindingIds: report.qualityGate?.failingFindingIds ?? [],
    findings,
    severityCounts: countBySeverity(findings),
    coverageStatus: report.coverage?.status ?? 'unknown',
    skippedFileCount: report.skippedFiles?.length ?? 0,
    warnings: report.run.warnings ?? [],
    providerIssues: (report.providerIssues ?? []).map((issue) =>
      issue.message === undefined || issue.message === null
        ? issue.code
        : `${issue.code}: ${issue.message}`
    ),
    ...(report.run.costUsd === undefined || report.run.costUsd === null
      ? {}
      : { costUsd: report.run.costUsd })
  }
}

const IntentReportSchema = z.object({
  status: z.string(),
  summary: z
    .object({
      obligationCount: z.number().int().nullish(),
      evidencedCount: z.number().int().nullish(),
      notEvidencedCount: z.number().int().nullish(),
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
    undeterminedCount: report.summary?.undeterminedCount ?? 0,
    extraScopeFileCount: report.summary?.extraScopeFileCount ?? 0,
    unevidenced: obligations
      .filter((obligation) => obligation.status !== 'evidenced')
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

