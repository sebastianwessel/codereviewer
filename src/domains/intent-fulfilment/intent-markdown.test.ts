// What the rendered mapping must communicate, asserted as behaviour rather than as
// a snapshot: a snapshot would pin the wording and let the MEANING drift with it,
// and the meaning is the whole deliverable here. Every test names the reader's
// question it protects.
//
// The first group is the load-bearing one. This lane's dominant measured error is a
// misread answer, not a wrong one — 54 of 83 false positives on the 2026-08-01
// corpus were `not-evidenced` read as "you did not do this" — so the tests that
// forbid completion language and require the search framing are protecting the
// reason the document exists, not its style.

import { intentSelfAgreementPercent } from '../reporting/measured-reliability.js'
import { describe, expect, test } from 'vitest'
import {
  falseSatisfiedOneIn,
  inDiffRecallInTen,
  measuredIntentReliability,
  measuredReliability,
  missedOutstandingOneIn
} from '../reporting/index.js'
import { renderIntentFulfilmentMarkdown } from './intent-markdown.js'
import {
  IntentFulfilmentReportSchema,
  type IntentFulfilmentReport,
  type Obligation
} from './intent-fulfilment-report.js'

const obligation = (
  overrides: Partial<Obligation> & { readonly id: string }
): Obligation =>
  ({
    source: { origin: 'pull-request', line: 3, text: 'The API must reject empty names.' },
    statement: 'Reject empty names at the API boundary.',
    status: 'not-evidenced',
    ...overrides
  }) as Obligation

// Built through the schema so a test can never assert over a report shape the
// command could not actually produce.
const report = (
  obligations: readonly Obligation[],
  overrides: {
    readonly status?: IntentFulfilmentReport['status']
    readonly warnings?: readonly string[]
    readonly explanation?: string
    readonly extraScope?: readonly { readonly path: string; readonly changedLineCount: number }[]
    readonly intentTruncated?: boolean
    readonly usage?: IntentFulfilmentReport['usage']
  } = {}
): IntentFulfilmentReport => {
  const count = (status: Obligation['status']): number =>
    obligations.filter((entry) => entry.status === status).length

  return IntentFulfilmentReportSchema.parse({
    schemaVersion: '1.0',
    status: overrides.status ?? 'completed',
    generatedAt: '2026-08-02T10:00:00.000Z',
    scope: {
      baseRef: 'main',
      headRef: 'HEAD',
      changedFileCount: 2,
      changedLineCount: 40,
      intentOrigins: ['pull-request'],
      intentTruncated: overrides.intentTruncated ?? false
    },
    summary: {
      intentFragmentCount: 1,
      obligationCount: obligations.length,
      evidencedCount: count('evidenced'),
      notEvidencedStatusCount: count('not-evidenced'),
      notContradictedCount: count('not-contradicted'),
      undeterminedCount: count('undetermined'),
      obligationsTruncated: false,
      uncitedObligationCount: 0,
      unverifiedEvidenceClaimCount: 0,
      notEvidencedCount: count('not-evidenced') + count('undetermined'),
      extraScopeFileCount: overrides.extraScope?.length ?? 0
    },
    obligations,
    extraScope: overrides.extraScope ?? [],
    ...(overrides.explanation === undefined ? {} : { explanation: overrides.explanation }),
    warnings: overrides.warnings ?? [],
    ...(overrides.usage === undefined ? {} : { usage: overrides.usage })
  })
}

describe('the question the document answers', () => {
  test('says up front that it maps evidence, not completeness', () => {
    const markdown = renderIntentFulfilmentMarkdown(report([obligation({ id: 'obl_1' })]))

    expect(markdown).toContain('do and do not SHOW')
    expect(markdown).toContain('not a completeness check')
  })

  // Spec 23: the output "MUST NOT certify completion", and "no part of the output
  // may be phrased so a reader could take it that way". An empty outstanding list is
  // where a renderer is most tempted to congratulate.
  test('an empty outstanding list is a fact about the search, never a certificate', () => {
    const markdown = renderIntentFulfilmentMarkdown(
      report([
        obligation({
          id: 'obl_1',
          status: 'evidenced',
          evidence: [{ path: 'src/api.ts', line: 12, side: 'added', text: 'assertName(name)' }]
        })
      ])
    )

    expect(markdown).toContain('Not evidenced by this change (0)')
    expect(markdown).toContain('That is a statement about this search, not a certificate')
    // The claims themselves, not the words. A blanket word ban would forbid the
    // sentence "this is not a completeness check", which is the one doing the work.
    expect(markdown).not.toMatch(
      /(change|it) is complete|fully (covers|implements)|all obligations (are|were)|nothing (is )?outstanding/iu
    )
  })

  // The measured misreading, guarded directly: nothing may phrase a missing piece of
  // evidence as a claim about what the author did or failed to do.
  test('the not-evidenced section names the search, not the author', () => {
    const markdown = renderIntentFulfilmentMarkdown(report([obligation({ id: 'obl_1' })]))

    expect(markdown).toContain('## Not evidenced by this change (1)')
    expect(markdown).toContain('an obligation an earlier change already satisfied leaves no evidence in this one')
    // Nothing may attribute the absence of evidence to the author. The banner is
    // allowed to say an obligation may be "genuinely missing" — that is the honest
    // enumeration of what a reader must decide between — but no heading or note may
    // assert it.
    expect(markdown).not.toMatch(
      /you (did not|failed|forgot)|(was|were|is|are) not (done|implemented|addressed)|left undone/iu
    )
  })

  // The largest measured false-positive mode, and the one a renderer is most tempted
  // to turn into a congratulation: an obligation asking that something NOT be done,
  // which this change does not do. It has no line to cite by its nature.
  test('a prohibition is rendered as a search that found nothing against it', () => {
    const markdown = renderIntentFulfilmentMarkdown(
      report([
        obligation({
          id: 'obl_1',
          status: 'not-contradicted',
          statement: 'Do not log token values.'
        })
      ])
    )

    // The empty-outstanding banner still fires here, and it must stay true when the
    // only obligations are ones kept by changing nothing: they were matched to no
    // line at all, so a banner saying every obligation was matched to lines in this
    // change would be a certificate printed where a reader is readiest to take one.
    expect(markdown).toContain('## Not evidenced by this change (0)')
    expect(markdown).not.toContain(
      'was matched to lines in this change. That is a statement'
    )
    expect(markdown).toContain(
      'an obligation kept by changing nothing has no line behind it to check'
    )
    expect(markdown).toContain('## Not contradicted by this change (1)')
    expect(markdown).toContain('- Not contradicted by this change: 1')
    // What it is NOT: a claim about head, and not a claim that the change put the
    // restriction in place.
    expect(markdown).toContain(
      'not as a check that the obligation holds in the rest of the repository'
    )
    expect(markdown).toContain('not as a claim that this change put it in place')
    // And it is not on the headline outstanding number, which is the whole
    // behavioural effect of the status existing.
    expect(markdown).toContain('- **Not evidenced by this change: 0**')
    // The absence of a citation is explained rather than left as a gap a reader
    // fills with "the tool could not find one".
    expect(markdown).toContain('There is no line to cite')
    // It must not be dressed up as satisfaction: no certificate, and no evidence
    // bullet under an obligation that has none.
    expect(markdown).not.toMatch(/^\s+- Read from[^\n]*\n\s+- `/mu)
  })

  test('carries no severity, no verdict and no score', () => {
    const markdown = renderIntentFulfilmentMarkdown(
      report([
        obligation({ id: 'obl_1' }),
        obligation({ id: 'obl_2', status: 'undetermined' })
      ])
    )

    // Asserted structurally. The banner says the report "carries no severity" and
    // "cannot fail a pipeline", so banning the words would ban the disclaimer; what
    // must not exist is a rating ATTACHED to an obligation or a summary line.
    expect(markdown).not.toMatch(
      /^\s*[-*]?\s*(severity|risk|priority|score|verdict|result)\s*:/imu
    )
    expect(markdown).not.toMatch(/\b(critical|high|medium|low)\b/iu)
  })
})

describe('what a reader can act on', () => {
  // Spec 23: an obligation the reviewer inferred rather than read is not an
  // obligation. Every entry must show the line of the stated intent behind it, so a
  // reader can reject the obligation itself.
  test('every obligation cites the line of the stated intent it was read from', () => {
    const markdown = renderIntentFulfilmentMarkdown(
      report([
        obligation({ id: 'obl_1' }),
        obligation({ id: 'obl_2', status: 'undetermined' }),
        obligation({
          id: 'obl_3',
          status: 'evidenced',
          evidence: [{ path: 'src/api.ts', line: 12, side: 'added', text: 'assertName(name)' }]
        })
      ])
    )

    expect([...markdown.matchAll(/Read from/gu)]).toHaveLength(3)
  })

  // Spec 23's 2026-07-30 amendment: a removed line is numbered on the PRE-change
  // side, so a citation without its side names two different lines at once.
  test('evidence carries path, line and side', () => {
    const markdown = renderIntentFulfilmentMarkdown(
      report([
        obligation({
          id: 'obl_1',
          status: 'evidenced',
          evidence: [
            { path: 'src/api.ts', line: 12, side: 'added', text: 'assertName(name)' },
            { path: 'src/legacy.ts', line: 88, side: 'removed', text: 'skipValidation()' }
          ]
        })
      ])
    )

    expect(markdown).toContain('`src/api.ts:12` (added)')
    expect(markdown).toContain('`src/legacy.ts:88` (removed)')
  })

  test('undetermined obligations are listed, and said to be on the headline list', () => {
    const markdown = renderIntentFulfilmentMarkdown(
      report([obligation({ id: 'obl_1', status: 'undetermined' })])
    )

    expect(markdown).toContain('## Could not be decided (1)')
    expect(markdown).toContain('counted with the not-evidenced obligations above')
    expect(markdown).toContain('- **Not evidenced by this change: 1**')
  })

  // Spec 23: "Extra scope is reported neutrally. A change doing more than the ticket
  // asked is a normal and often desirable event, not a defect."
  test('extra scope is reported neutrally', () => {
    const markdown = renderIntentFulfilmentMarkdown(
      report([obligation({ id: 'obl_1' })], {
        extraScope: [{ path: 'src/unrelated.ts', changedLineCount: 4 }]
      })
    )

    expect(markdown).toContain('normal and frequently deliberate')
    expect(markdown).not.toMatch(/scope creep|unnecessary|should not/iu)
  })

  // The mapping is the output; the prose is a convenience over it. A summary printed
  // first would be what a skimming reader takes away.
  test('the prose summary comes after the mapping and is marked as derived', () => {
    const markdown = renderIntentFulfilmentMarkdown(
      report([obligation({ id: 'obl_1' })], { explanation: 'One obligation has no evidence.' })
    )

    expect(markdown.indexOf('## Summary in prose')).toBeGreaterThan(
      markdown.indexOf('## Not evidenced by this change')
    )
    expect(markdown).toContain('could not change it')
  })

  test('bounds that bound are disclosed, each naming the cap that actually bound', () => {
    const markdown = renderIntentFulfilmentMarkdown(
      report([obligation({ id: 'obl_1' })], {
        intentTruncated: true
      })
    )

    // Only ONE bound can reach a report, and it is the provider's cut. Both of
    // this command's own caps — `maxIntentBytes` and `maxChangeLines` — REFUSE the
    // run when they bind, so a report exists only where neither did. Naming
    // either here sends a reader to raise a limit that was never reached; they
    // get the same report back and learn to discount the disclosure.
    expect(markdown).toContain('maxFileBytes')
    expect(markdown).not.toContain('maxIntentBytes')
    expect(markdown).not.toContain('maxChangeLines')
    // And it says what the cut costs the reader, not merely that it happened.
    expect(markdown).toContain('floor and not a total')
  })

  // The disclosure has to be where a human reads, above the list it qualifies —
  // a reader who reaches the obligations first has already drawn the conclusion.
  test('the cut intent is disclosed before the obligations it undercounts', () => {
    const markdown = renderIntentFulfilmentMarkdown(
      report([obligation({ id: 'obl_1' })], { intentTruncated: true })
    )

    expect(markdown.indexOf('## Bounds that bound')).toBeGreaterThan(-1)
    expect(markdown.indexOf('## Bounds that bound')).toBeLessThan(
      markdown.indexOf('## Not evidenced by this change')
    )
  })

  test('spend is money and tokens are broken out', () => {
    const markdown = renderIntentFulfilmentMarkdown(
      report([obligation({ id: 'obl_1' })], {
        usage: {
          inputTokens: 382_152,
          outputTokens: 2351,
          cachedInputTokens: 366_080,
          costUsd: 0.125_104
        }
      })
    )

    expect(markdown).toContain('- Cost: $0.1251')
    expect(markdown).toContain('- Input tokens: 382,152 (366,080 cached)')
    expect(markdown).toContain('- Output tokens: 2,351')
  })

  // The lane prices its own call, so it can fail to price it: no provider prices
  // configured leaves `costUsd` absent. The report then has to say the price is
  // unknown, because a section listing tokens and no money reads as a free run —
  // and the review report, which renders these lines from the same function, has
  // said so in words for as long as it has had them.
  test('a cost that could not be determined is stated, not omitted', () => {
    const markdown = renderIntentFulfilmentMarkdown(
      report([obligation({ id: 'obl_1' })], {
        usage: { inputTokens: 10, outputTokens: 4 }
      })
    )

    expect(markdown).toContain(
      '- Cost: unavailable (token counts or model prices were missing)'
    )
    expect(markdown).not.toContain('- Cost: $')
  })

  // The measured rates above the table were measured on one model. Printed without
  // it, a reader on another model reads them as their own.
  test('the rates name the model they were measured on, and the run names its own', () => {
    const markdown = renderIntentFulfilmentMarkdown(
      report([obligation({ id: 'obl_1' })], {
        usage: {
          providerId: 'anthropic',
          modelName: 'some-other-model',
          inputTokens: 10,
          outputTokens: 4
        }
      })
    )

    expect(markdown).toContain('openai/gpt-5.3-codex')
    expect(markdown).toContain('were not measured on it')
    expect(markdown).toContain('- Model: `anthropic/some-other-model`')
  })

  test('a lane that recorded no model says so rather than claiming a match', () => {
    const markdown = renderIntentFulfilmentMarkdown(
      report([obligation({ id: 'obl_1' })], {
        usage: { inputTokens: 10, outputTokens: 4 }
      })
    )

    expect(markdown).toContain('did not record which model produced it')
    expect(markdown).toContain('- Model: not recorded')
  })
})

// THE GUARD THIS GROUP EXISTS FOR. The paragraph above the mapping quotes two
// measured rates, and a rate written into prose is a rate nothing can update — the
// review report and the pull-request comment already drifted that way once, which
// is why `measured-reliability.ts` exists. The expected ratios below are computed
// from the round's transcribed counts INDEPENDENTLY of the renderer, so a
// re-baseline that moves the counts and leaves the sentence behind fails here.
describe('the measured rates the rows are weighed against', () => {
  const oneIn = (part: number, whole: number): number => Math.round(whole / part)

  test('both published ratios are computed from the round the module records', () => {
    const markdown = renderIntentFulfilmentMarkdown(
      report([obligation({ id: 'obl_1' })])
    )
    const falseSatisfied = oneIn(
      measuredIntentReliability.falseSatisfiedClaims,
      measuredIntentReliability.falseSatisfiedOpportunities
    )
    const missed = oneIn(
      measuredIntentReliability.outstandingTotal -
        measuredIntentReliability.outstandingDetected,
      measuredIntentReliability.outstandingTotal
    )

    expect(markdown).toContain(
      `about **1 in ${falseSatisfied}** obligations this stage calls evidenced`
    )
    expect(markdown).toContain(
      `about **1 in ${missed}** genuinely outstanding obligations`
    )
    expect(markdown).toContain(
      `over ${measuredIntentReliability.corpusCaseCount} real changes`
    )
    // The renderer must print the module's derived ratios, not fractions of its
    // own: identical arithmetic in two places is the drift being prevented.
    expect(falseSatisfiedOneIn).toBe(falseSatisfied)
    expect(missedOutstandingOneIn).toBe(missed)
  })

  // The intent round and the review corpus measure different questions against
  // different answer keys. A review rate printed here would describe nothing a
  // reader of this document could check, however fresh the number was.
  test('it never quotes stage 1 recall or precision', () => {
    const markdown = renderIntentFulfilmentMarkdown(
      report([obligation({ id: 'obl_1' })])
    )

    expect(markdown).not.toContain(String(measuredReliability.inDiffRecallPercent))
    expect(markdown).not.toContain(
      String(measuredReliability.adjustedPrecisionPercent)
    )
    expect(markdown).not.toContain(`${inDiffRecallInTen} in 10`)
  })
})

describe('the outcomes that map nothing', () => {
  // Spec 23 requires absent or unusable intent to be reported PLAINLY. An empty
  // document would read as a missing report rather than as an answer.
  test.each([
    ['disabled', 'is disabled'],
    ['no-intent', 'No stated intent was found'],
    ['unusable-intent', 'no checkable obligation could be read'],
    ['provider-unavailable', 'no model was available']
  ])('%s says so, and does not read as a clean bill of health', (status, expected) => {
    const markdown = renderIntentFulfilmentMarkdown(
      report([], { status: status as IntentFulfilmentReport['status'] })
    )

    expect(markdown).toContain('## Nothing was mapped')
    expect(markdown).toContain(expected)
    expect(markdown).not.toContain('## Not evidenced by this change (0)')
  })

  test('warnings are rendered', () => {
    const markdown = renderIntentFulfilmentMarkdown(
      report([], { status: 'provider-unavailable', warnings: ['no provider resolved'] })
    )

    expect(markdown).toContain('- no provider resolved')
  })
})

describe('untrusted text cannot break the document', () => {
  // Statements, intent lines and cited source are all attacker-influenced text.
  test('markdown structure in an obligation cannot escape its own bullet', () => {
    const markdown = renderIntentFulfilmentMarkdown(
      report([
        obligation({
          id: 'obl_1',
          statement: '# Injected heading\n- and a list',
          source: { origin: 'pull-request', line: 1, text: '## also injected' }
        })
      ])
    )

    // The `#` survives as escaped text; what must not survive is a LINE that
    // starts a heading, or a line that starts a list item the renderer did not
    // emit. Every heading in the document is one the renderer wrote.
    expect(markdown).not.toMatch(/^#+ Injected/mu)
    expect(markdown).not.toMatch(/^#+ also injected/mu)
    expect([...markdown.matchAll(/^#+ /gmu)]).toHaveLength(
      [...markdown.matchAll(/^(# Intent Fulfilment Report|## )/gmu)].length
    )
    // The statement and the intent line are single lines each: a newline inside
    // either would let the second half of it start a construct of its own.
    expect(markdown).toContain('\\# Injected heading - and a list')
  })

  test('a backtick run in cited code cannot break out of its span', () => {
    const markdown = renderIntentFulfilmentMarkdown(
      report([
        obligation({
          id: 'obl_1',
          status: 'evidenced',
          evidence: [
            { path: 'src/api.ts', line: 12, side: 'added', text: 'const md = ```x```' }
          ]
        })
      ])
    )

    // Four backticks, and one space of padding on each side because the text ends
    // with a backtick. CommonMark strips the padding again when rendering.
    expect(markdown).toContain('```` const md = ```x``` ````')
  })

  // The review report says two runs over one commit disagree; this one did not,
  // and intent's own self-agreement is LOWER than the review lane's stability.
  // A reader weighing a verdict has to know it is not reproducible.
  test('discloses that two runs over the same change disagree', () => {
    const markdown = renderIntentFulfilmentMarkdown(
      report([obligation({ id: 'obl_1' })])
    )

    expect(markdown).toContain(`${intentSelfAgreementPercent}%`)
    expect(markdown.toLowerCase()).toContain('same change')
  })
})
