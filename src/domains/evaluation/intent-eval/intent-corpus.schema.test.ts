import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  countOutstandingExpectationsByArm,
  intentArms,
  parseIntentCorpusManifest,
  parseIntentCorpusManifestJson,
  type IntentCorpusCase
} from './intent-corpus.schema.js'

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..'
)

const committedManifestPath = path.join(
  repositoryRoot,
  'eval',
  'corpora',
  'intent-fulfilment',
  'manifest.json'
)

const expectation = {
  id: 'out-1',
  statement: 'the three arms are never run, so nothing is measured at head',
  intentLineRanges: [[74, 75]] as [number, number][],
  rationale:
    'The clause names three paired arms and the change runs none of them.',
  provenance: 'Fixed human enumeration, transcribed verbatim.'
}

const baseCase = {
  id: 'pw01-example',
  arm: 'prewritten' as const,
  split: 'dev' as const,
  mismatchOrigin: 'natural' as const,
  source: 'repository-spec-slice',
  capturedAt: '2026-08-01',
  intent: {
    kind: 'document-slice' as const,
    commit: 'a'.repeat(40),
    path: 'specs/20-discovery-posture.md',
    title: 'Spec 20 — measurement',
    lineRanges: [[1, 5], [72, 108]] as [number, number][]
  },
  change: { baseCommit: 'b'.repeat(40), headCommit: 'c'.repeat(40) },
  maxObligations: 40,
  humanObligationCount: 11,
  outstandingExpectations: [expectation]
}

const manifestWith = (
  cases: readonly Record<string, unknown>[]
): Record<string, unknown> => ({
  schemaVersion: '1.0',
  datasetId: 'intent-fulfilment-prewritten',
  description: 'A corpus fixture.',
  cases
})

describe('intent corpus schema', () => {
  test('accepts a well-formed manifest', () => {
    const manifest = parseIntentCorpusManifest(manifestWith([baseCase]))

    expect(manifest.cases).toHaveLength(1)
    expect(manifest.cases[0]?.outstandingExpectations[0]?.id).toBe('out-1')
  })

  test('refuses a duplicate case id', () => {
    expect(() =>
      parseIntentCorpusManifest(manifestWith([baseCase, baseCase]))
    ).toThrow(/Duplicate intent case id/u)
  })

  test('refuses a duplicate expectation id inside one case', () => {
    expect(() =>
      parseIntentCorpusManifest(
        manifestWith([
          {
            ...baseCase,
            outstandingExpectations: [
              expectation,
              { ...expectation, intentLineRanges: [[80, 81]] }
            ]
          }
        ])
      )
    ).toThrow(/declares expectation id "out-1" twice/u)
  })

  // The join has to be a FUNCTION. Two expectations sharing a source line would
  // both claim the same reported obligation, so one wrong `evidenced` would be
  // counted as two false-satisfied claims.
  test('refuses two expectations anchored at the same line', () => {
    expect(() =>
      parseIntentCorpusManifest(
        manifestWith([
          {
            ...baseCase,
            outstandingExpectations: [
              expectation,
              { ...expectation, id: 'out-2', intentLineRanges: [[75, 76]] }
            ]
          }
        ])
      )
    ).toThrow(/anchors both "out-1" and "out-2" at line 75/u)
  })

  test('refuses an anchor outside the intent excerpt', () => {
    expect(() =>
      parseIntentCorpusManifest(
        manifestWith([
          {
            ...baseCase,
            outstandingExpectations: [
              { ...expectation, intentLineRanges: [[200, 201]] }
            ]
          }
        ])
      )
    ).toThrow(/which the intent excerpt does not include/u)
  })

  test('refuses an intent sliced at the head commit', () => {
    expect(() =>
      parseIntentCorpusManifest(
        manifestWith([
          {
            ...baseCase,
            intent: { ...baseCase.intent, commit: baseCase.change.headCommit }
          }
        ])
      )
    ).toThrow(/the intent is not pre-written/u)
  })

  test('refuses a pre-written case whose intent is a commit message', () => {
    expect(() =>
      parseIntentCorpusManifest(
        manifestWith([
          {
            ...baseCase,
            id: 'pw02-example',
            intent: { kind: 'commit-message', commit: 'd'.repeat(40) },
            outstandingExpectations: []
          },
          baseCase
        ])
      )
    ).toThrow(/takes its intent from a commit message/u)
  })

  test('refuses a post-hoc case whose intent is a document slice', () => {
    expect(() =>
      parseIntentCorpusManifest(
        manifestWith([{ ...baseCase, arm: 'posthoc' }])
      )
    ).toThrow(/does not take its intent from a commit message/u)
  })

  test('refuses more outstanding obligations than a human read', () => {
    expect(() =>
      parseIntentCorpusManifest(
        manifestWith([{ ...baseCase, humanObligationCount: 0 }])
      )
    ).toThrow(/the outstanding set is a subset/u)
  })

  test('refuses the same base and head commit', () => {
    expect(() =>
      parseIntentCorpusManifest(
        manifestWith([
          {
            ...baseCase,
            change: {
              baseCommit: baseCase.change.headCommit,
              headCommit: baseCase.change.headCommit
            }
          }
        ])
      )
    ).toThrow(/there is no change to check the intent against/u)
  })

  // A corpus with no outstanding obligation anywhere reports a false-satisfied
  // numerator of zero without having looked at anything.
  test('refuses a corpus that enumerates nothing outstanding', () => {
    expect(() =>
      parseIntentCorpusManifest(
        manifestWith([{ ...baseCase, outstandingExpectations: [] }])
      )
    ).toThrow(/no false-satisfied claim could ever be detected/u)
  })

  test('counts outstanding expectations per arm', () => {
    const counts = countOutstandingExpectationsByArm([
      baseCase as unknown as IntentCorpusCase,
      {
        ...baseCase,
        id: 'ph01-example',
        arm: 'posthoc',
        intent: { kind: 'commit-message', commit: 'e'.repeat(40) },
        outstandingExpectations: []
      } as unknown as IntentCorpusCase
    ])

    expect(counts).toEqual({ prewritten: 1, posthoc: 0 })
  })
})

// THE INCIDENT THIS TEST EXISTS FOR: this repository has shipped a corpus manifest
// that failed its own schema with a green suite and a green drift check, and only
// hydration caught it. A committed manifest is validated by the suite from now on.
describe('the committed intent corpus manifest', () => {
  test('parses against its own schema, including the cross-case rules', async () => {
    const manifest = parseIntentCorpusManifestJson(
      await readFile(committedManifestPath, 'utf8')
    )

    expect(manifest.datasetId).toBe('intent-fulfilment-prewritten')
    expect(manifest.cases.length).toBeGreaterThan(0)

    for (const arm of intentArms) {
      expect(
        manifest.cases.some((corpusCase) => corpusCase.arm === arm)
      ).toBe(true)
    }
  })

  // Spec 23 permits synthetic mismatches but requires them to be marked and
  // reported apart. Nothing in this corpus is synthetic, and the assertion is here
  // so that adding one silently is a test failure rather than a footnote.
  test('contains no synthetic case', async () => {
    const manifest = parseIntentCorpusManifestJson(
      await readFile(committedManifestPath, 'utf8')
    )

    expect(
      manifest.cases.filter(
        (corpusCase) => corpusCase.mismatchOrigin === 'synthetic'
      )
    ).toEqual([])
  })

  // The post-hoc arm is a CONTROL, not a source of outstanding obligations: a
  // commit message is written after the work, so obligations read out of one are
  // addressed by construction. Its enumeration being empty is a property of the
  // corpus, and a row appearing there needs a decision rather than a commit.
  test('enumerates outstanding obligations only in the pre-written arm', async () => {
    const manifest = parseIntentCorpusManifestJson(
      await readFile(committedManifestPath, 'utf8')
    )
    const counts = countOutstandingExpectationsByArm(manifest.cases)

    expect(counts.posthoc).toBe(0)
    expect(counts.prewritten).toBeGreaterThan(0)
  })
})
