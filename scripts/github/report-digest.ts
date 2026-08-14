// Reduces the engine's report artifacts to exactly what the pull-request comment
// renders.
//
// A SHAPE THIS FILE CANNOT READ THROWS. That is a reversal, and the reasoning it
// replaced is worth writing down because it was half right.
//
// These schemas used to be deliberately loose — every field nullish, every
// absence rendering as an empty section — for two stated reasons. The first: a
// report gains a field far more often than it loses one, and strict parsing would
// break the comment on every additive change. True, and still respected below;
// these object schemas ignore keys they do not know, so a report that GAINS a
// field is read exactly as before. The second: this integration might read an
// artifact some other, older build of the engine wrote. That one was never true
// here. `pipeline.ts` reads the artifacts of the run IT JUST SPAWNED, out of that
// run's own artifact directory, and `main.ts` spawns the CLI from this same
// checkout (`dist/cli/main.js`, or `src/cli/main.ts` through tsx); the workflow
// `npm ci`s this repository and runs `scripts/github/main.ts` out of it. Producer
// and consumer are one commit. There is no rolling-upgrade window and no archived
// artifact — unlike `eval compare` and `eval recall-report`, which genuinely do
// read finished runs and are tolerant for a reason they state
// (`src/domains/evaluation/report/eval-recall-view.ts`).
//
// Unearned tolerance cost months. `changedSymbols`/`impactedFiles` replaced
// `symbols` at impact schema 2.0; this file read only `symbols`, parsed every
// report successfully, joined nothing, and rendered no Impact section in any
// pull-request comment from 434473a until it was found by an end-to-end test. No
// log line, no warning, no failing check: a tolerant reader has no failure mode,
// and an empty section is indistinguishable from a change that affects nothing.
//
// THE BOUND ON STRICTNESS, the same one the recall view draws: a field is
// required here exactly when the producer's own contract always writes it, and
// optional here exactly when the producer makes it optional. This refuses a report
// shaped differently from the one this build writes; it never refuses one that is
// merely newer in an additive way.
//
// `schemaVersion` is pinned to each producer's literal for the same reason. The
// producers bump it deliberately, for changes they document as breaking, and
// pinning turns that bump into a red unit test in the commit that makes it —
// which is the cheapest place this defect class can possibly be caught, and about
// as far as it is possible to get from a silent empty section on somebody's pull
// request.
//
// Severity is imported rather than restated: it is a CLOSED five-value
// vocabulary, not a field that gains members the way a report object gains keys,
// and a local copy would be a second place to edit.
import { z } from 'zod'
import { SeveritySchema, type Severity } from '../../src/shared/contracts/index.js'

export type { Severity }

/**
 * A report artifact this build wrote and this build cannot read.
 *
 * The message is the whole point, and it is written for whoever reads the pull
 * request rather than for a log: it names the report, says what is missing from
 * the comment because of it, and says where the disagreement lives. `pipeline.ts`
 * renders it verbatim as an operational note — the mechanism the comment already
 * has for "here is why you are seeing less than you expected".
 *
 * It THROWS rather than returning `undefined` because `undefined` is what the
 * caller already means by "this lane did not run, render nothing" — the two are
 * one value, and collapsing an integration defect into the ordinary absent case
 * is precisely how the Impact section stayed missing for months.
 */
export class ReportShapeError extends Error {
  /** Human name of the report, e.g. `impact report`. */
  readonly report: string

  constructor(report: ReportKind, detail: string) {
    super(
      `The ${report.label} this run produced could not be read (${detail}), so ${report.consequence}. The engine and this comment's digest ship in one commit, so the two disagree about a report shape — see scripts/github/report-digest.ts. The report itself is in the run artifacts.`
    )
    this.name = 'ReportShapeError'
    this.report = report.label
  }
}

type ReportKind = {
  readonly label: string
  /** What the reader loses from the comment, in the comment's own vocabulary. */
  readonly consequence: string
}

const reviewReportKind: ReportKind = {
  label: 'review report',
  consequence: 'no findings from it are shown here'
}

const intentReportKind: ReportKind = {
  label: 'intent report',
  consequence: 'the Intent section is missing'
}

const impactReportKind: ReportKind = {
  label: 'impact report',
  consequence: 'the Impact section is missing'
}

// Two issues, not all of them: a schema change usually trips many at once, and the
// note this lands in is one line in a pull-request comment. The first two name the
// field that moved, which is what makes the mismatch findable.
const describeIssues = (error: z.ZodError): string =>
  error.issues
    .slice(0, 2)
    .map((issue) =>
      issue.path.length === 0
        ? issue.message
        : `${issue.path.join('.')}: ${issue.message}`
    )
    .join('; ')

/**
 * Parses one report artifact, or throws `ReportShapeError` describing what it
 * could not read. Never returns a partial digest: half a section is a claim about
 * the change that nothing produced.
 */
const parseReport = <T>(
  schema: z.ZodType<T>,
  raw: string,
  kind: ReportKind
): T => {
  let document: unknown

  try {
    document = JSON.parse(raw) as unknown
  } catch {
    // An artifact that is not JSON at all — truncated by a killed process, or
    // half-written — is as unreadable as one whose shape moved, and is worth
    // saying out loud for the same reason. Named separately because the remedy is
    // not the same one: nothing about this file will fix it.
    throw new ReportShapeError(kind, 'it is not valid JSON')
  }

  const parsed = schema.safeParse(document)

  if (!parsed.success) {
    throw new ReportShapeError(kind, describeIssues(parsed.error))
  }

  return parsed.data
}

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
  startLine: z.number().int().min(1)
})

const AdmittedFindingSchema = z.object({
  id: z.string(),
  severity: SeveritySchema,
  category: z.string(),
  title: z.string(),
  description: z.string(),
  location: LocationSchema,
  baselineStatus: z.string(),
  reporterEligibility: z.string(),
  // The link into `refutationResults`. Without it the comment can state that a
  // finding exists but not what was tried against it, which is the difference
  // between a claim a reviewer can check and one they must take on faith.
  //
  // The one optional field on a finding, because it is the one the engine's own
  // contract makes optional: a finding admitted by the deterministic gate never
  // reached refutation and has no verdict to link to.
  refutationId: z.string().nullish(),
  // Required, `min(1)` like the contract: a finding with no fingerprint gets no
  // stable identity across runs, so it can never become or update an inline
  // comment — it would simply be listed in the summary and silently never land
  // beside the code, which is this defect class one level down.
  fingerprints: z.array(z.object({ value: z.string() })).min(1)
})

const RefutationResultSchema = z.object({
  id: z.string(),
  verdict: z.string(),
  summary: z.string()
})

const ReviewReportSchema = z.object({
  schemaVersion: z.literal('1.0'),
  run: z.object({
    runId: z.string(),
    costUsd: z.number().nullish(),
    // Whether a model actually searched the change. Optional in the engine's
    // contract too, for reports written before the field existed — and saying
    // nothing is not the same as saying a search ran, so only the explicit
    // 'not-performed' changes what this comment claims.
    modelSearch: z.string().nullish(),
    warnings: z.array(z.string())
  }),
  coverage: z.object({ status: z.string() }),
  admittedFindings: z.array(AdmittedFindingSchema),
  // Every candidate refutation or the deterministic admission gate killed. Not
  // `AdmittedFinding`s — they never reached admission — so only the count is
  // parsed; the digest states how many were thrown out, not why, and points the
  // reader at the run artifact for the reasons.
  rejectedFindings: z.array(z.unknown()),
  refutationResults: z.array(RefutationResultSchema),
  skippedFiles: z.array(z.unknown()),
  // Optional in the engine's contract: a run configured with no thresholds
  // evaluates no gate. The digest records the difference rather than reading an
  // absent gate as a passed one.
  qualityGate: z
    .object({
      passed: z.boolean(),
      failingFindingIds: z.array(z.string())
    })
    .nullish(),
  providerIssues: z.array(
    z.object({ code: z.string(), message: z.string().nullish() })
  ),
  // Baseline fingerprints that no longer match any current finding — i.e. fixed
  // since the baseline was recorded. Present (possibly empty) only when
  // `baseline.includeResolvedInReport` was enabled for the run; absent means the
  // count was never computed, which is a different fact from a computed zero and
  // must not collapse into it.
  resolvedBaselineEntries: z.array(z.unknown()).nullish(),
  // Spec 27 discovery telemetry. Optional: a deterministic-only run issues no
  // discovery call and has none to report. Only the one counter this digest
  // renders is parsed — and once the block is there, that counter is required,
  // because the engine's contract writes every one of them together. Telemetry
  // that arrived with the count missing would render as no merge line at all,
  // which reads as a run that merged nothing.
  discovery: z
    .object({
      totals: z.object({ mergedAwayCount: z.number().int().min(0) })
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
   * findings list.
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
   * duplicate. Always a count: the engine's own report always carries this array,
   * possibly empty, so this is never a default standing in for a missing one.
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
   * Baseline fingerprints that are no longer reported.
   *
   * NOT "fixed", though this field once said so: nothing here can separate a
   * repair from a miss, and with in-diff recall around two thirds and no two runs
   * over one commit agreeing, a fingerprint that disappears may simply not have
   * been found this time. See `baseline-matcher.ts`.
   *
   * Undefined — not 0 — when the run never computed this at all
   * (`baseline.includeResolvedInReport` was off); a computed zero is a fact
   * worth stating, an uncomputed one is not. The baseline stores fingerprints
   * only, so a count is genuinely everything this can say — never which defect
   * it was.
   */
  readonly resolvedBaselineEntryCount?: number
  /**
   * `'performed'` or `'not-performed'`: whether a model searched this change at
   * all. Undefined when the report does not say, which is a case the engine's own
   * contract still allows and the renderer must treat as "no claim", never as a
   * search having run.
   *
   * It is carried because a run with `aiReview.enabled: false` reports zero
   * findings and passes its gate, and this comment used to hand a reviewer the
   * measured rates of a diff-scoped model search over exactly that.
   */
  readonly modelSearch?: string
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

/** @throws {ReportShapeError} when the document is not a report this build wrote. */
export const digestReviewReport = (raw: string): ReviewDigest => {
  const report = parseReport(ReviewReportSchema, raw, reviewReportKind)
  const refutationById = new Map(
    report.refutationResults.map((refutation) => [refutation.id, refutation])
  )
  const findings: readonly FindingDigest[] = report.admittedFindings.map(
    (finding) => {
      const fingerprint = finding.fingerprints[0]?.value
      const refutation =
        finding.refutationId === undefined || finding.refutationId === null
          ? undefined
          : refutationById.get(finding.refutationId)

      return {
        id: finding.id,
        severity: finding.severity,
        category: finding.category,
        title: finding.title,
        description: finding.description,
        path: finding.location.path,
        startLine: finding.location.startLine,
        baselineStatus: finding.baselineStatus,
        reporterEligibility: finding.reporterEligibility,
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
  const mergedAwayCount = report.discovery?.totals.mergedAwayCount

  return {
    runId: report.run.runId,
    qualityGatePassed: report.qualityGate?.passed ?? true,
    qualityGateEvaluated: report.qualityGate !== undefined && report.qualityGate !== null,
    failingFindingIds: report.qualityGate?.failingFindingIds ?? [],
    findings,
    severityCounts: countBySeverity(actionableFindings),
    coverageStatus: report.coverage.status,
    skippedFileCount: report.skippedFiles.length,
    warnings: report.run.warnings,
    providerIssues: report.providerIssues.map((issue) =>
      issue.message === undefined || issue.message === null
        ? issue.code
        : `${issue.code}: ${issue.message}`
    ),
    rejectedFindingCount: report.rejectedFindings.length,
    ...(report.run.costUsd === undefined || report.run.costUsd === null
      ? {}
      : { costUsd: report.run.costUsd }),
    ...(report.run.modelSearch === undefined || report.run.modelSearch === null
      ? {}
      : { modelSearch: report.run.modelSearch }),
    ...(mergedAwayCount === undefined || mergedAwayCount === null
      ? {}
      : { mergedAwayCount }),
    ...(resolvedBaselineEntries === undefined || resolvedBaselineEntries === null
      ? {}
      : { resolvedBaselineEntryCount: resolvedBaselineEntries.length })
  }
}

const IntentReportSchema = z.object({
  schemaVersion: z.literal('1.0'),
  // Left a plain string where the two report shapes above pin an enum, and the
  // difference is the CONSEQUENCE, not the field: `intentSection` renders a status
  // it does not recognise as `Status: <it>`, in front of the reader. An added
  // status is therefore visible on its own, which is all a refusal would buy.
  status: z.string(),
  // Every counter is required. The engine writes all six on every report,
  // including `no-intent` and `disabled` ones, and a summary the digest could not
  // read used to render as six zeroes — "0 obligations read from the description"
  // over a change whose description stated several.
  summary: z.object({
    obligationCount: z.number().int(),
    evidencedCount: z.number().int(),
    notEvidencedCount: z.number().int(),
    notContradictedCount: z.number().int(),
    undeterminedCount: z.number().int(),
    extraScopeFileCount: z.number().int()
  }),
  obligations: z.array(
    z.object({
      statement: z.string(),
      status: z.string()
    })
  ),
  // The one optional field, because the engine's contract makes it optional: the
  // explanation is written by a separate call that may not have run.
  explanation: z.string().nullish(),
  warnings: z.array(z.string())
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

/** @throws {ReportShapeError} when the document is not a report this build wrote. */
export const digestIntentReport = (raw: string): IntentDigest => {
  const report = parseReport(IntentReportSchema, raw, intentReportKind)
  const obligations = report.obligations

  return {
    status: report.status,
    obligationCount: report.summary.obligationCount,
    evidencedCount: report.summary.evidencedCount,
    notEvidencedCount: report.summary.notEvidencedCount,
    notContradictedCount: report.summary.notContradictedCount,
    undeterminedCount: report.summary.undeterminedCount,
    extraScopeFileCount: report.summary.extraScopeFileCount,
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
    warnings: report.warnings
  }
}

// One destination file: the changed symbols that reach it, each with the sites
// they reach it at. `min(1)` on both lists mirrors the contract — a file with no
// symbol reaching it is not an impacted file, and a symbol with no site is not a
// reference — so a report that carried either would be describing something the
// engine has no way to mean.
const ImpactedFileSchema = z.object({
  path: z.string(),
  symbols: z
    .array(
      z.object({
        name: z.string(),
        definitionPath: z.string(),
        definitionLine: z.number().int(),
        sites: z.array(z.unknown()).min(1)
      })
    )
    .min(1)
})

const ImpactReportSchema = z.object({
  schemaVersion: z.literal('1.0'),
  // Pinned to the closed vocabulary, unlike the intent report's status, because
  // here an unrecognised value is SILENT: `impactSection` renders nothing for any
  // status but `completed`, so a sixth value would remove the section without
  // anybody being told. `disabled` renders nothing too — but that is a decision
  // taken about a value this digest knows.
  status: z.enum(['completed', 'disabled']),
  summary: z.object({
    changedSymbolCount: z.number().int(),
    referenceCount: z.number().int(),
    testReferenceCount: z.number().int()
  }),
  // Schema 2.0 replaced the single `symbols` list — changed symbols each carrying
  // their own references — with this normalized pair: what changed, and which FILES
  // it reaches. THE OLD SPELLING IS NOT READ, and deliberately is not: nothing can
  // still write it (the producer pins `schemaVersion` at the literal above, and
  // this workflow runs the CLI out of its own checkout), so carrying it would be a
  // compatibility branch with no caller — and a branch no caller reaches is exactly
  // what let a real shape change go unnoticed for months.
  changedSymbols: z.array(
    z.object({
      name: z.string(),
      definitionPath: z.string(),
      definitionLine: z.number().int(),
      changeKind: z.string()
    })
  ),
  impactedFiles: z.array(ImpactedFileSchema),
  impactedTestFiles: z.array(ImpactedFileSchema),
  warnings: z.array(z.string())
})

type ImpactedFile = z.infer<typeof ImpactedFileSchema>

// A character no path, identifier or number can contain, so two different triples
// can never format to one key. Written as an escape rather than as a literal:
// `grep` silently skips a source file carrying a raw NUL, which is how a live
// capability in this repository was once nearly deleted as dead code.
const SYMBOL_KEY_SEPARATOR = '\u0000'

// The join key `impact-report.ts` prescribes: two symbols can share a name in one
// file, and two files can each declare the same name, so nothing narrower is an
// identity. All three parts are required, as they are on both sides of the join in
// the contract — a key built from a missing line would silently match the wrong
// symbol, which is the failure the full triple exists to prevent.
const changedSymbolKey = (symbol: {
  readonly name: string
  readonly definitionPath: string
  readonly definitionLine: number
}): string =>
  [symbol.name, symbol.definitionPath, symbol.definitionLine].join(
    SYMBOL_KEY_SEPARATOR
  )

/** Reference SITES per changed symbol across one destination-file list. */
const siteCountsBySymbol = (
  files: readonly ImpactedFile[]
): ReadonlyMap<string, number> => {
  const counts = new Map<string, number>()

  for (const file of files) {
    for (const symbol of file.symbols) {
      const key = changedSymbolKey(symbol)

      counts.set(key, (counts.get(key) ?? 0) + symbol.sites.length)
    }
  }

  return counts
}

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

/** @throws {ReportShapeError} when the document is not a report this build wrote. */
export const digestImpactReport = (raw: string): ImpactDigest => {
  const report = parseReport(ImpactReportSchema, raw, impactReportKind)
  // The report keeps the changed symbols and the files they reach in two
  // normalized lists, so the per-symbol counts this comment renders are rebuilt by
  // joining them on the triple.
  const productionSites = siteCountsBySymbol(report.impactedFiles)
  const testSites = siteCountsBySymbol(report.impactedTestFiles)
  const symbols = report.changedSymbols.map((symbol) => ({
    name: symbol.name,
    definitionPath: symbol.definitionPath,
    changeKind: symbol.changeKind,
    referenceCount: productionSites.get(changedSymbolKey(symbol)) ?? 0,
    testReferenceCount: testSites.get(changedSymbolKey(symbol)) ?? 0
  }))

  return {
    status: report.status,
    changedSymbolCount: report.summary.changedSymbolCount,
    referenceCount: report.summary.referenceCount,
    testReferenceCount: report.summary.testReferenceCount,
    // A symbol nothing references is dropped: the table answers "what else does
    // this change reach", and a row with two zeroes answers nothing.
    symbols: symbols.filter(
      (symbol) => symbol.referenceCount > 0 || symbol.testReferenceCount > 0
    ),
    warnings: report.warnings
  }
}

