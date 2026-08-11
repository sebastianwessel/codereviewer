// Platform-neutral review-comment drafts (spec 13). This layer owns every safety
// guard once — inline eligibility, new-side only, redaction, Markdown escaping,
// suggestion eligibility, and the apply-check below — so the per-platform
// renderers stay pure and inherit the guards. The neutral draft carries a
// STRUCTURED suggestion (the replacement text + target range), never a
// pre-rendered fenced block.
//
// The apply-check is here, on the neutral draft, and not in a renderer, because a
// renderer that forgot it would offer a human a one-click apply of an edit no code
// had checked. A guard a renderer can skip is a guard that will be skipped: this
// layer is the only place all four platforms pass through.
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
import { applyFixEdits } from '../../shared/text/apply-fix-edits.js'
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

// The edit a suggestion would carry, with the replacement text it would render.
type EligibleSuggestion = {
  readonly edit: FixEdit
  readonly replacement: string
}

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
//
// Deliberately NOT the apply-check either: this is a question about the edit's
// SHAPE, answerable from the report alone, while the apply-check is a question
// about the FILE. Keeping them apart is what lets a caller with no file bytes
// still tell "there was never a suggestion here" from "there was one and it could
// not be checked".
const eligibleSuggestion = (
  finding: AdmittedFinding,
  targetRange: ReviewCommentTargetRange
): EligibleSuggestion | undefined => {
  const edits = finding.fixProposal?.edits ?? []
  const edit = edits[0]

  if (
    finding.fixProposal?.safety !== 'manual-review' ||
    edits.length !== 1 ||
    edit === undefined ||
    !editMatchesTargetRange(edit, finding, targetRange)
  ) {
    return undefined
  }

  const replacement = normalizedReplacement(edit)

  return replacement.includes(CODE_FENCE) ? undefined : { edit, replacement }
}

/**
 * Reads the CURRENT bytes of one repository file, or resolves `undefined` when
 * they cannot be read. Injected rather than imported so this layer stays pure and
 * platform-free; the CLI supplies the real filesystem reader.
 *
 * The bytes are used for the apply-check ONLY. Nothing read here reaches a
 * rendered comment — the suggestion a comment carries is the model's replacement
 * text, redacted on its own way in.
 */
export type ReviewCommentFileReader = (
  path: string
) => Promise<string | undefined>

// Why a finding is, or is not, offered a one-click apply.
//
// `unchecked` and `stale` are separate states on purpose, and the distinction is
// the point of this whole mechanism: `stale` means the edits were re-applied to
// the file's current bytes and did not fit, `unchecked` means those bytes never
// arrived so NOTHING was verified. Both withhold the suggestion — absence of a
// check is not a passing check — but they are different facts, and the reader is
// told which one happened.
// `none` means the finding carried NO replacement, so nothing was lost.
// `not-representable` means it carried one and this comment cannot render it —
// the two used to be one value, and the second is the common case, not the
// exotic one: discovery never sets `endLine`, so a comment's target range is
// always a single line, while both producers of `fixProposal.edits` (the
// refuter, and the fix lane) attach edits with whatever span the model proposed.
// A concrete, computed replacement was therefore dropped in silence under a body
// that still read "Suggested fix: <summary>".
type SuggestionOutcome =
  | { readonly kind: 'none' }
  | { readonly kind: 'not-representable' }
  | { readonly kind: 'unchecked' }
  | { readonly kind: 'stale' }
  | { readonly kind: 'applies'; readonly replacement: string }

// Re-applies the finding's own edit to the file as it is now. The fix lane runs
// the identical check before it enriches a `fixProposal` (spec 12), but that lane
// is optional and this surface is not: whatever produced the edits — the fix lane,
// or the refuter on a run with the lane off — a block GitHub renders with an
// Apply button is checked here before a human is offered the click.
const suggestionOutcomeFor = async (
  finding: AdmittedFinding,
  targetRange: ReviewCommentTargetRange,
  readCurrentFile: ReviewCommentFileReader | undefined
): Promise<SuggestionOutcome> => {
  const eligible = eligibleSuggestion(finding, targetRange)

  if (eligible === undefined) {
    // Which of the two absences this is decides whether the reader is owed a
    // note. Asked of the edits themselves, not of `eligible`, because every
    // reason `eligibleSuggestion` refuses — several edits, a span wider than the
    // comment's line, a replacement carrying a fence — leaves the replacement
    // sitting in the report where the reader can still use it.
    return (finding.fixProposal?.edits ?? []).length === 0
      ? { kind: 'none' }
      : { kind: 'not-representable' }
  }

  if (readCurrentFile === undefined) {
    return { kind: 'unchecked' }
  }

  // A reader that throws is a reader that could not answer, which is exactly the
  // `undefined` case; it must not take the whole report down with it.
  const content = await readCurrentFile(finding.location.path).catch(
    () => undefined
  )

  if (content === undefined) {
    return { kind: 'unchecked' }
  }

  return applyFixEdits(content, [eligible.edit]).ok
    ? { kind: 'applies', replacement: eligible.replacement }
    : { kind: 'stale' }
}

// What appending the canonical (```suggestion) block costs a body. Measured
// against the canonical fence because that is what the neutral draft promises;
// a platform whose own fence is longer makes its own room (see
// `review-comment-renderers.ts`).
const fencedBlockCost = (replacement: string): number =>
  `\n\n${renderFencedBlock(`${CODE_FENCE}suggestion`, replacement)}`.length

// Where a withheld replacement can still be read, said the same way whatever
// withheld it. The pointer is `report.json`, not `review-comments.json`: when this
// layer drops the suggestion the neutral artifact has no `suggestion` field
// either, so the only place the replacement survives is the finding's
// `fixProposal.edits`.
const WITHHELD_RECORDED_IN_REPORT =
  'It is recorded in full in `report.json` under this finding\'s `fixProposal.edits`.'

// One sentence per reason, because they ask different things of the reader. A
// replacement that does not fit is still known-good and worth copying by hand; one
// that no longer applies is known-stale and must not be; one that could not be
// checked is unknown, and saying so is what stops it from being read as either of
// the other two.
const SUGGESTION_WITHHELD_TOO_LARGE = `A concrete apply-ready replacement was computed for this finding but does not fit a review comment. ${WITHHELD_RECORDED_IN_REPORT}`
const SUGGESTION_WITHHELD_STALE = `A concrete replacement was computed for this finding but no longer applies to the file's current contents, so it is not offered as a one-click apply. ${WITHHELD_RECORDED_IN_REPORT}`
const SUGGESTION_WITHHELD_UNCHECKED = `A concrete replacement was computed for this finding but could not be checked against the file's current contents, so it is not offered as a one-click apply. ${WITHHELD_RECORDED_IN_REPORT}`
// The fourth reason, and the one that fires most: the replacement does not have
// the shape a review comment can carry (more than one edit, or a span other than
// the single line this comment is anchored to). Worded as "cannot be offered
// here" rather than as a doubt about the edit, because unlike `stale` and
// `unchecked` nothing is known to be wrong with it — it was simply never checked,
// so the sentence must not imply it was.
const SUGGESTION_WITHHELD_NOT_REPRESENTABLE = `A concrete replacement was computed for this finding but does not have the shape a review comment can carry — it spans lines other than this comment's, or is more than one edit — so it is not offered as a one-click apply and was not checked against the file. ${WITHHELD_RECORDED_IN_REPORT}`

// What the body says about a replacement it is not carrying. `none` says nothing:
// a note that fires when nothing was lost is a note readers learn to skip.
// `applies` is only ever passed here after the fit check has already failed.
const withheldNoteFor = (outcome: SuggestionOutcome): string | undefined => {
  switch (outcome.kind) {
    case 'none':
      return undefined
    case 'not-representable':
      return SUGGESTION_WITHHELD_NOT_REPRESENTABLE
    case 'unchecked':
      return SUGGESTION_WITHHELD_UNCHECKED
    case 'stale':
      return SUGGESTION_WITHHELD_STALE
    case 'applies':
      return SUGGESTION_WITHHELD_TOO_LARGE
  }
}

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
  // WORDED FOR THE PERSON READING A PULL REQUEST, which is a different audience
  // from `report.md`. That file is the audit trail and keeps the engine's own
  // vocabulary ("survived refutation"); this comment is a note left on someone's
  // change, and a human reviewer writes "here is why this holds", not the name of
  // the stage that decided it. The SUBSTANCE is identical -- the same verdict
  // summary and the same cited evidence -- so this is the wording differing by
  // audience, not the two surfaces claiming different things.
  //
  // The verdict name is shown only when it is NOT `proved`. An inline comment is
  // posted for a finding that cleared refutation and the severity threshold, so
  // `proved` is the ordinary case and naming it adds a word that means nothing to
  // the reader; anything else is a qualification they need.
  return [
    refutation === undefined
      ? `- **Why this holds:** ${NO_REFUTATION_VERDICT}`
      : `- **Why this holds:**${
          refutation.verdict === 'proved'
            ? ''
            : ` (${safeText(refutation.verdict)})`
        } ${clampRendered(refutation.summary, PROOF_SUMMARY_MAX)}`,
    `- **Based on:** ${citedEvidence(finding, input.evidenceById)}`
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
    readonly withheldNote: string | undefined
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
      ...(input.withheldNote === undefined ? [] : ['', input.withheldNote]),
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
const draftFor = async (
  finding: AdmittedFinding,
  input: {
    readonly evidenceById: ReadonlyMap<string, EvidenceRecord>
    readonly refutationById: ReadonlyMap<string, RefutationResult>
    readonly readCurrentFile: ReviewCommentFileReader | undefined
  }
): Promise<ReviewCommentDraft | undefined> => {
  if (
    finding.reporterEligibility !== 'inline' ||
    finding.location.side === 'old'
  ) {
    return undefined
  }

  const targetRange = targetRangeFor(finding)
  const outcome = await suggestionOutcomeFor(
    finding,
    targetRange,
    input.readCurrentFile
  )
  const replacement =
    outcome.kind === 'applies' ? outcome.replacement : undefined
  const reservedForSuggestion =
    replacement === undefined ? 0 : fencedBlockCost(replacement)
  const reservedBody = bodyFor(finding, {
    ...input,
    reservedForSuggestion,
    withheldNote: undefined
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
        // `applies` reaches here only when the fit check above failed, so each
        // outcome maps to the one thing that actually happened to this finding's
        // replacement.
        withheldNote: withheldNoteFor(outcome)
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

/**
 * Builds the neutral drafts for a report.
 *
 * `readCurrentFile` is a REQUIRED property whose value may be `undefined`, so a
 * caller has to state what it has rather than inherit a default. Passing
 * `undefined` is a legitimate answer — a caller holding a report and no working
 * tree cannot check anything — and it costs exactly what it should: every
 * suggestion is withheld, and each affected comment says why.
 */
export const buildReviewCommentDrafts = async (
  input: unknown,
  options: {
    readonly readCurrentFile: ReviewCommentFileReader | undefined
  }
): Promise<readonly ReviewCommentDraft[]> => {
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

  // Each finding's draft depends only on that finding and the file it names, so
  // the per-finding reads are issued together and `Promise.all` keeps the drafts
  // in admitted-finding order.
  const drafts = await Promise.all(
    report.admittedFindings.map(async (finding) =>
      draftFor(finding, {
        evidenceById,
        refutationById,
        readCurrentFile: options.readCurrentFile
      })
    )
  )

  return drafts.filter((draft): draft is ReviewCommentDraft => draft !== undefined)
}
