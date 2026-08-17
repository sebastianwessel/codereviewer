import type { ModelAlias } from '@purista/harness'
import { describe, expect, test, vi } from 'vitest'
import type { ContextFragment } from './contracts.js'
import { createDigestSummarizer } from './digest-summarizer.js'
import { packFragments } from './fragment-packer.js'
import { createModelSummarizer } from './model-summarizer.js'

const fragmentWith = (
  origin: string,
  body: string,
  overrides: Partial<ContextFragment> = {}
): ContextFragment => ({
  origin,
  kind: 'inbox',
  title: origin,
  body,
  metadata: {},
  ...overrides
})

const plainSection = (fragment: ContextFragment): string =>
  `## ${fragment.title ?? fragment.origin}\n${fragment.body.trim()}`

describe('fragment packer', () => {
  test('keeps every fragment whole when the budget allows', () => {
    const packed = packFragments({
      fragments: [fragmentWith('a', 'alpha'), fragmentWith('b', 'beta')],
      budgetBytes: 4000,
      renderSection: plainSection
    })

    expect(packed.text).toBe('## a\nalpha\n\n## b\nbeta')
    expect(packed.origins).toEqual(['a', 'b'])
    expect(packed.truncated).toBe(false)
    expect(packed.cutBySummaryCap).toBe(false)
  })

  test('truncates the first overflowing fragment and drops the rest', () => {
    const packed = packFragments({
      fragments: [
        fragmentWith('a', 'x'.repeat(500)),
        fragmentWith('b', 'this one never gets packed')
      ],
      budgetBytes: 40,
      renderSection: plainSection
    })

    expect(Buffer.byteLength(packed.text, 'utf8')).toBeLessThanOrEqual(40)
    // Only what survived is named. Naming `b` would claim provenance the text does
    // not have.
    expect(packed.origins).toEqual(['a'])
    expect(packed.truncated).toBe(true)
    expect(packed.cutBySummaryCap).toBe(true)
  })

  // THE DISTINCTION THIS PACKER EXISTS TO KEEP. A body the provider already cut at
  // its own `maxFileBytes` arrives short enough to fit any budget here, so it must
  // be reported as truncated — but NOT as cut by the summary cap, which did not
  // bind and which is what the run warning names. Collapsing the two would put a
  // `maxFileBytes` cut under a warning telling the reader to raise `maxBytes`.
  test('a fragment the provider already cut is truncated but not cut by this budget', () => {
    const packed = packFragments({
      fragments: [fragmentWith('a', 'alpha', { truncated: true })],
      budgetBytes: 4000,
      renderSection: plainSection
    })

    expect(packed.truncated).toBe(true)
    expect(packed.cutBySummaryCap).toBe(false)
    expect(packed.origins).toEqual(['a'])
  })

  test('reports an exhausted budget with nothing packed', () => {
    const packed = packFragments({
      fragments: [fragmentWith('a', 'alpha')],
      budgetBytes: 0,
      renderSection: plainSection
    })

    expect(packed.text).toBe('')
    expect(packed.origins).toEqual([])
    expect(packed.truncated).toBe(true)
    expect(packed.cutBySummaryCap).toBe(true)
  })

  // The other way a fragment can fail to fit: the budget is positive but not one
  // whole character of the section fits it. A multi-byte first character is the
  // only way to reach this branch, and it must not emit an empty section that then
  // counts as a packed origin.
  test('packs nothing when the budget cannot hold one character', () => {
    const packed = packFragments({
      fragments: [fragmentWith('a', 'alpha'), fragmentWith('b', 'beta')],
      budgetBytes: 1,
      renderSection: (fragment) => `€ ${fragment.origin}`
    })

    expect(packed.text).toBe('')
    expect(packed.origins).toEqual([])
    expect(packed.truncated).toBe(true)
    expect(packed.cutBySummaryCap).toBe(true)
  })

  test('renders sections through the caller-supplied renderer', () => {
    const packed = packFragments({
      fragments: [fragmentWith('a', 'alpha', { kind: 'changed-file' })],
      budgetBytes: 4000,
      renderSection: (fragment) => `${fragment.origin} (${fragment.kind})`
    })

    expect(packed.text).toBe('a (changed-file)')
  })
})

// Both summarizers pack through the one function above, so the two causes of
// truncation must read the same way whichever one produced the brief. This does not
// fail against the two hand-copied loops it replaced — they agreed — which is the
// point: it is the guard that they cannot silently stop agreeing.
describe('both summarizers report the two truncation causes the same way', () => {
  const modelSummarizer = () =>
    createModelSummarizer({
      modelAlias: {
        model: 'gpt-x',
        provider: {
          id: 'stub',
          genAiSystem: 'stub',
          object: vi.fn(async () => ({
            object: { brief: 'Intent: alpha.' },
            usage: { inputTokens: 5, outputTokens: 3 }
          }))
        }
      } as unknown as ModelAlias
    })

  test('a provider-cut fragment that fits leaves the summary cap unset', async () => {
    const fragments = [fragmentWith('a', 'alpha', { truncated: true })]

    for (const summarizer of [createDigestSummarizer(), modelSummarizer()]) {
      const brief = await summarizer.summarize(fragments, { maxBytes: 4000 })

      expect(brief.truncated).toBe(true)
      expect(brief.cutBySummaryCap).toBeUndefined()
    }
  })

  test('a fragment cut to fit the budget sets the summary cap', async () => {
    const fragments = [
      fragmentWith('a', 'x'.repeat(5000)),
      fragmentWith('b', 'beta')
    ]

    for (const summarizer of [createDigestSummarizer(), modelSummarizer()]) {
      const brief = await summarizer.summarize(fragments, { maxBytes: 40 })

      expect(brief.truncated).toBe(true)
      expect(brief.cutBySummaryCap).toBe(true)
      expect(brief.origins).toEqual(['a'])
    }
  })
})
