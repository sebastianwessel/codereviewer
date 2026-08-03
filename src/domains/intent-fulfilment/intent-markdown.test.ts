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

import { describe, expect, test } from 'vitest'
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
    readonly changedLinesTruncated?: boolean
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
      changedLinesTruncated: overrides.changedLinesTruncated ?? false,
      intentOrigins: ['pull-request'],
      intentTruncated: overrides.intentTruncated ?? false
    },
    summary: {
      intentFragmentCount: 1,
      obligationCount: obligations.length,
      evidencedCount: count('evidenced'),
      notEvidencedStatusCount: count('not-evidenced'),
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

  test('bounds that bound are disclosed', () => {
    const markdown = renderIntentFulfilmentMarkdown(
      report([obligation({ id: 'obl_1' })], {
        changedLinesTruncated: true,
        intentTruncated: true
      })
    )

    expect(markdown).toContain('maxChangeLines')
    expect(markdown).toContain('maxIntentBytes')
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
  })

  // The 1-in-29 and 1-in-10 rates above the table were measured on one model.
  // Printed without it, a reader on another model reads them as their own.
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
})
