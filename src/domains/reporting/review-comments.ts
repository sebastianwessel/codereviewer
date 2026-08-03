// Platform-neutral review-comment drafts (spec 13). This layer owns every safety
// guard once — inline eligibility, new-side only, redaction, Markdown escaping,
// and suggestion eligibility — so the per-platform renderers stay pure and
// inherit the guards. The neutral draft carries a STRUCTURED suggestion (the
// replacement text + target range), never a pre-rendered fenced block.
//
// It also owns the PROOF join. A finding names its refutation and its evidence by
// id; the records live on the report. Resolving them here, once, is what lets
// every platform's comment say what the finding survived without a renderer
// inventing content or a reader opening the JSON.
import {
  REVIEW_COMMENT_BODY_MAX,
  ReviewCommentDraftSchema,
  type AdmittedFinding,
  type EvidenceRecord,
  type FixEdit,
  type RefutationResult,
  type ReviewCommentDraft,
  type ReviewCommentTargetRange,
  type ReviewReport
} from '../../shared/contracts/index.js'
import { redactText } from '../../shared/redaction/redactor.js'
import {
  inlineCode,
  NO_REFUTATION_VERDICT,
  safeText,
  validateReviewReport
} from './reporting-utils.js'

// A suggestion block must use exactly a triple-backtick fence. Declared once here
// so the breakout guard below and every platform renderer agree on what a fence
// is.
export const CODE_FENCE = '```'

// Render a fenced block from an opening fence line (which may carry a platform's
// suggestion syntax) and an already fence-free replacement.
export const renderFencedBlock = (
  openingFence: string,
  replacement: string
): string => [openingFence, replacement, CODE_FENCE].join('\n')

const targetRangeFor = (finding: AdmittedFinding): ReviewCommentTargetRange => ({
  startLine: finding.location.startLine,
  endLine: finding.location.endLine ?? finding.location.startLine
})

// Redacted, LF-normalized replacement used both for the structural fence guard
// and as the emitted suggestion replacement.
const normalizedReplacement = (edit: FixEdit): string =>
  redactText(edit.replacement).replace(/\r\n/gu, '\n')

const editMatchesTargetRange = (
  edit: FixEdit,
  finding: AdmittedFinding,
  targetRange: ReviewCommentTargetRange
): boolean =>
  edit.path === finding.location.path &&
  edit.startLine === targetRange.startLine &&
  edit.endLine === targetRange.endLine &&
  edit.endLine >= edit.startLine

// Whether a finding's fix can be represented as a structured suggestion AT ALL:
// a single admitted edit mapping exactly to the comment range, manual-review
// safety, and a redacted replacement carrying no triple-backtick fence (which
// would break out of the block).
//
// Deliberately NOT a fit check. Whether the rendered block fits the body cap is a
// budgeting question, and answering it here is what made the suggestion the thing
// that lost: `bodyFor` gave the description every byte left over, so the body
// landed AT the cap and no block could ever be appended. A finding with a long
// description silently lost its apply-ready fix on every platform, while the body
// still read "Suggested fix: <summary>".
const eligibleReplacement = (
  finding: AdmittedFinding,
  targetRange: ReviewCommentTargetRange
): string | undefined => {
  const edits = finding.fixProposal?.edits ?? []

  if (
    finding.fixProposal?.safety !== 'manual-review' ||
    edits.length !== 1 ||
    !editMatchesTargetRange(edits[0]!, finding, targetRange)
  ) {
    return undefined
  }

  const replacement = normalizedReplacement(edits[0]!)

  return replacement.includes(CODE_FENCE) ? undefined : replacement
}

// What appending the canonical (```suggestion) block costs a body. Measured
// against the canonical fence because that is what the neutral draft promises;
// a platform whose own fence is longer makes its own room (see
// `review-comment-renderers.ts`).
const fencedBlockCost = (replacement: string): number =>
  `\n\n${renderFencedBlock(`${CODE_FENCE}suggestion`, replacement)}`.length

// Said in the body when a replacement WAS computed and could not be carried. The
// pointer is `report.json`, not `review-comments.json`: when this layer drops the
// suggestion the neutral artifact has no `suggestion` field either, so the only
// place the replacement survives is the finding's `fixProposal.edits`.
const SUGGESTION_WITHHELD_NOTE =
  'A concrete apply-ready replacement was computed for this finding but does not fit a review comment. It is recorded in full in `report.json` under this finding\'s `fixProposal.edits`.'

// Rendered-length caps for the prose this body carries. They are stated in the
// RENDERED domain — escaping can grow a string severalfold, so a cap applied to
// the raw field would not bound what the reader actually gets — and they exist so
// the proof below can never be squeezed out by a long description. See `bodyFor`.
const TITLE_MAX = 200
const PROOF_SUMMARY_MAX = 400
const FIX_SUMMARY_MAX = 400
const EVIDENCE_SUMMARY_MAX = 120
// An inline comment has no room for a citation list. Three addresses answer
// "what is this anchored to"; the rest are one click away in the run report,
// which is named rather than implied.
const CITED_EVIDENCE_MAX = 3
const TRUNCATION_MARK = '…'

// Cut ALREADY-ESCAPED Markdown to `max` rendered characters, marking the cut. The
// cut is pulled back off a trailing escape: half of `&amp;` renders as literal
// `&amp` and a dangling `\` escapes whatever follows it, which here is the newline
// separating this line from the next one.
//
// Exported because the platform renderers have to make room in a finished body
// (see `review-comment-renderers.ts`), and a second copy of an escape-aware cut is
// a second place for it to drift into producing a dangling backslash.
export const clampEscaped = (text: string, max: number): string => {
  if (text.length <= max) {
    return text
  }

  const cut = text
    .slice(0, Math.max(max - TRUNCATION_MARK.length, 0))
    .replace(/&[A-Za-z#][A-Za-z0-9]*$/u, '')
    .replace(/\\+$/u, '')
    .trimEnd()

  return `${cut}${TRUNCATION_MARK}`
}

// Escape first, then cut, so `max` bounds the rendered text rather than the raw
// field.
const clampRendered = (value: string, max: number): string =>
  clampEscaped(safeText(value), max)

// The addresses the finding is anchored to. An evidence record's own summary is
// only rendered when it has no location: with one, the ADDRESS is the checkable
// part and the summary would repeat the description in a surface with no room
// for it.
const citedEvidence = (
  finding: AdmittedFinding,
  evidenceById: ReadonlyMap<string, EvidenceRecord>
): string => {
  const shown = finding.evidenceIds.slice(0, CITED_EVIDENCE_MAX)
  const cited = shown.map((evidenceId) => {
    const record = evidenceById.get(evidenceId)

    if (record === undefined) {
      // Named rather than dropped, exactly as `report.md` names it: an evidence
      // id with no record is a hole in the audit trail, and a hole a reader can
      // see beats one they cannot.
      return `${inlineCode(evidenceId)} (no evidence record for this id is in the report)`
    }

    return record.location === undefined
      ? `${safeText(record.kind)}: ${clampRendered(record.summary, EVIDENCE_SUMMARY_MAX)}`
      : `${safeText(record.kind)} at ${inlineCode(`${record.location.path}:${record.location.startLine}`)}`
  })
  const remaining = finding.evidenceIds.length - shown.length

  return [
    ...cited,
    ...(remaining === 0 ? [] : [`and ${remaining} more in the run report`])
  ].join('; ')
}

// The answer to "why should I believe this?", compressed to what fits beside the
// code. `report.md` prints the whole ledger — every check, every evidence record
// with its summary — because a reader who opened it came to audit. A reader
// meeting this comment in a diff has a line or two of attention, so this is the
// verdict, the refuter's one-sentence reason, and the addresses the claim rests
// on. Nothing here is invented: both halves are records the report already
// carries, and the platform renderers only re-fence the suggestion.
//
// A finding with no recorded verdict SAYS SO. Omitting the line would leave the
// two cases — refuted-and-survived, and never adjudicated — rendering
// identically, which is the failure this surface is being fixed for.
const proofLines = (
  finding: AdmittedFinding,
  input: {
    readonly evidenceById: ReadonlyMap<string, EvidenceRecord>
    readonly refutationById: ReadonlyMap<string, RefutationResult>
  }
): readonly string[] => {
  const refutation =
    finding.refutationId === undefined
      ? undefined
      : input.refutationById.get(finding.refutationId)

  // A two-item list, not two bare lines. GitHub renders a single newline inside a
  // comment as a line break; a strict CommonMark renderer joins the two into one
  // paragraph. The list reads the same on every platform this spec targets.
  return [
    refutation === undefined
      ? `- **Survived refutation:** ${NO_REFUTATION_VERDICT}`
      : `- **Survived refutation** (${safeText(refutation.verdict)}): ${clampRendered(refutation.summary, PROOF_SUMMARY_MAX)}`,
    `- **Rests on:** ${citedEvidence(finding, input.evidenceById)}`
  ]
}

// Redacted, Markdown-escaped prose body: severity, category, title, description,
// the proof (refutation verdict and cited evidence), the fix summary when
// present, and the finding id. Never carries raw source.
//
// NO RELIABILITY PARAGRAPH, deliberately. The measured rates on `report.md` and
// on the pull-request comment are mostly about what SILENCE means — recall — and
// a comment that exists raises no question about silence. The one rate that bears
// on a finding in hand is precision, and this body carries something strictly
// better: the verdict and the evidence for THIS finding, which a reader can check
// instead of applying a base rate to it. Restating "about 99 in 100 hold up" on
// every comment would also read as a per-comment probability, which is not what
// an aggregate says. It is stated once, in the summary comment on the same pull
// request.
//
// The description is the only elastic part: everything else is capped, and the
// description gets whatever budget is left. Ordering plus that budget is what
// keeps the promise — a long description now costs itself, not the proof, and
// the previous blind `slice(0, REVIEW_COMMENT_BODY_MAX)` would have cut from the
// end, dropping the proof off findings with the most to say.
// The description is the only elastic part, and it is sized LAST — after the
// title, the proof, the fix summary, any withheld-suggestion note, and the room a
// suggestion block will need. Everything else is fixed-cost and reserved, so a
// long description costs itself and nothing else.
//
// `reservedForSuggestion` is what makes that true of the suggestion too. Without
// it the description absorbed the whole remaining budget, the body landed at the
// cap, and the block that was supposed to follow had nowhere to go.
const bodyFor = (
  finding: AdmittedFinding,
  input: {
    readonly evidenceById: ReadonlyMap<string, EvidenceRecord>
    readonly refutationById: ReadonlyMap<string, RefutationResult>
    readonly reservedForSuggestion: number
    readonly suggestionWithheld: boolean
  }
): string => {
  const assemble = (description: string): string =>
    [
      `**${safeText(finding.severity.toUpperCase())} ${safeText(finding.category)}:** ${clampRendered(finding.title, TITLE_MAX)}`,
      '',
      description,
      '',
      ...proofLines(finding, input),
      ...(finding.fixProposal === undefined
        ? []
        : [
            '',
            `Suggested fix: ${clampRendered(finding.fixProposal.summary, FIX_SUMMARY_MAX)}`
          ]),
      // Assembled with the body, so its cost is reserved like every other fixed
      // part. Added as a note rather than left out: "Suggested fix: <summary>"
      // above it otherwise tells the reader a fix exists and never tells them a
      // concrete one was computed and dropped.
      ...(input.suggestionWithheld ? ['', SUGGESTION_WITHHELD_NOTE] : []),
      '',
      `Finding: ${safeText(finding.id)}`
    ].join('\n')

  return assemble(
    clampRendered(
      finding.description,
      REVIEW_COMMENT_BODY_MAX -
        assemble('').length -
        input.reservedForSuggestion
    )
  )
}

// Inline eligibility is decided once, in admission, which is the only stage that
// holds the reviewed diff ranges. This layer used to additionally require
// `side === 'new'`; combined with discovery stamping every model-origin finding
// `side: 'file'`, that second gate meant no model finding could ever become a
// draft and the surface produced nothing on real runs. What remains here is the
// one claim this layer can check on its own: an old-side location names a line
// that no longer exists on the new side, so it can never be anchored.
const draftFor = (
  finding: AdmittedFinding,
  input: {
    readonly evidenceById: ReadonlyMap<string, EvidenceRecord>
    readonly refutationById: ReadonlyMap<string, RefutationResult>
  }
): ReviewCommentDraft | undefined => {
  if (
    finding.reporterEligibility !== 'inline' ||
    finding.location.side === 'old'
  ) {
    return undefined
  }

  const targetRange = targetRangeFor(finding)
  const replacement = eligibleReplacement(finding, targetRange)
  const reservedForSuggestion =
    replacement === undefined ? 0 : fencedBlockCost(replacement)
  const reservedBody = bodyFor(finding, {
    ...input,
    reservedForSuggestion,
    suggestionWithheld: false
  })
  // Even with the reservation a replacement can be too large to carry — the cap
  // bounds the whole comment, and a very long replacement exceeds it on its own.
  // Then the fix is withheld and the body SAYS so, rather than the reader being
  // told a fix exists with no way to reach it.
  const fits =
    replacement !== undefined &&
    reservedBody.length + reservedForSuggestion <= REVIEW_COMMENT_BODY_MAX
  const body = fits
    ? reservedBody
    : bodyFor(finding, {
        ...input,
        reservedForSuggestion: 0,
        suggestionWithheld: replacement !== undefined
      })

  return ReviewCommentDraftSchema.parse({
    path: finding.location.path,
    targetRange,
    body,
    ...(fits ? { suggestion: { replacement } } : {}),
    findingId: finding.id,
    severity: finding.severity,
    category: finding.category
  })
}

export const buildReviewCommentDrafts = (
  input: unknown
): readonly ReviewCommentDraft[] => {
  const report: ReviewReport = validateReviewReport(input)
  // The proof a comment cites lives in the report, not on the finding: the
  // finding carries ids into `evidence` and `refutationResults`. Resolving them
  // here is what lets a draft state what a finding survived without a reader
  // opening the JSON to perform the join by hand.
  const evidenceById = new Map(
    report.evidence.map((record) => [record.id, record])
  )
  const refutationById = new Map(
    report.refutationResults.map((refutation) => [refutation.id, refutation])
  )

  return report.admittedFindings
    .map((finding) => draftFor(finding, { evidenceById, refutationById }))
    .filter((draft): draft is ReviewCommentDraft => draft !== undefined)
}
