// Spec 23's verification-matrix row "Every satisfied obligation cites path and
// line", and the failure mode the spec singles out:
//
//   "The dangerous output is not 'missed an obligation'. It is confidently
//    asserting an obligation is satisfied when it is not, because that stops a
//    human looking."
//
// Both halves are tested: the normalizer, which refuses an `evidenced` answer that
// carries no citation at all, and `verifyJudgement`, which refuses one whose
// citations do not land on a line the change actually touched. The second is the
// one that matters — a model asked for evidence will produce a plausible-looking
// path and line whether or not one exists.

import { describe, expect, test } from 'vitest'
import { collectChangeSurface } from './change-surface.js'
import { normalizeFulfilmentJudgement, verifyJudgement } from './judgement.js'

const surface = collectChangeSurface({
  files: [
    {
      path: 'src/token.ts',
      content: ['const a = 1', 'const expired = check()', '', 'const b = 2'].join(
        '\n'
      ),
      hunks: [{ oldStartLine: 2, oldLineCount: 1, newStartLine: 2, newLineCount: 2 }],
      isNewFile: false
    }
  ],
  maxChangeLines: 100
})

describe('normalizeFulfilmentJudgement', () => {
  test('accepts the three answers, tolerating casing and a trailing stop', () => {
    expect(
      normalizeFulfilmentJudgement({
        status: 'Evidenced.',
        evidence: [{ path: 'src/token.ts', line: 2 }]
      })
    ).toEqual({
      status: 'evidenced',
      evidence: [{ path: 'src/token.ts', line: 2 }]
    })
    expect(normalizeFulfilmentJudgement({ status: 'NOT-EVIDENCED' })).toEqual({
      status: 'not-evidenced'
    })
    expect(normalizeFulfilmentJudgement({ status: 'undetermined' })).toEqual({
      status: 'undetermined'
    })
  })

  test('coerces a line a model spelled as a string', () => {
    // The model-bound schema is loose on purpose: a provider-side rejection here
    // would lose a real judgement, and rich model-bound schemas took this engine's
    // provider error rate from 0% to 28.8%.
    expect(
      normalizeFulfilmentJudgement({
        status: 'evidenced',
        evidence: [{ path: 'src/token.ts', line: '2' }]
      })
    ).toEqual({
      status: 'evidenced',
      evidence: [{ path: 'src/token.ts', line: 2 }]
    })
  })

  test.each([
    ['evidenced with no evidence field', { status: 'evidenced' }],
    ['evidenced with an empty evidence list', { status: 'evidenced', evidence: [] }],
    [
      'evidenced citing an empty path',
      { status: 'evidenced', evidence: [{ path: '  ', line: 3 }] }
    ],
    ['a paraphrased verdict', { status: 'it is covered' }],
    ['a missing status', { evidence: [] }],
    ['a malformed answer', 'evidenced'],
    ['a null answer', null]
  ])('resolves %s to undetermined rather than to evidenced', (_name, value) => {
    // Every failure of this layer resolves AWAY from a satisfaction claim, and to
    // `undetermined` rather than `not-evidenced`: a malformed answer did not
    // establish that the change carries no evidence either.
    expect(normalizeFulfilmentJudgement(value)).toEqual({ status: 'undetermined' })
  })
})

describe('verifyJudgement', () => {
  test('keeps a citation that lands on a line the change touched, with the change’s own text', () => {
    expect(
      verifyJudgement(
        {
          status: 'evidenced',
          // The text is never taken from the answer, so a report cannot quote a
          // line the change does not contain.
          evidence: [{ path: 'src/token.ts', line: 2 }]
        },
        surface
      )
    ).toEqual({
      status: 'evidenced',
      evidence: [
        { path: 'src/token.ts', line: 2, side: 'added', text: 'const expired = check()' }
      ]
    })
  })

  test.each([
    ['a file the change did not touch', 'src/other.ts', 2],
    ['a line outside the changed hunks', 'src/token.ts', 1],
    ['a line past the end of the file', 'src/token.ts', 99],
    // Line 3 is blank, so it is not part of the citable surface: an "evidenced"
    // verdict must not be able to rest on whitespace.
    ['a blank changed line', 'src/token.ts', 3]
  ])(
    'downgrades an evidenced verdict citing %s to undetermined',
    (_name, path, line) => {
      expect(
        verifyJudgement({ status: 'evidenced', evidence: [{ path, line }] }, surface)
      ).toEqual({ status: 'undetermined' })
    }
  )

  test('keeps the valid citations of a partly wrong answer and drops duplicates', () => {
    const verified = verifyJudgement(
      {
        status: 'evidenced',
        evidence: [
          { path: 'src/token.ts', line: 2 },
          { path: 'src/token.ts', line: 2 },
          { path: 'src/nowhere.ts', line: 1 }
        ]
      },
      surface
    )

    expect(verified).toEqual({
      status: 'evidenced',
      evidence: [
        { path: 'src/token.ts', line: 2, side: 'added', text: 'const expired = check()' }
      ]
    })
  })

  test('leaves not-evidenced and undetermined verdicts alone', () => {
    expect(verifyJudgement({ status: 'not-evidenced' }, surface)).toEqual({
      status: 'not-evidenced'
    })
    expect(verifyJudgement({ status: 'undetermined' }, surface)).toEqual({
      status: 'undetermined'
    })
  })
})

describe('collectChangeSurface', () => {
  test('offers only the lines the diff added or modified', () => {
    // A citation into an untouched line is not evidence that the change does what
    // an obligation asks, so untouched lines are not offered to the judgement at
    // all.
    expect(surface.files).toEqual([
      {
        path: 'src/token.ts',
        changedLines: [{ line: 2, side: 'added', text: 'const expired = check()' }]
      }
    ])
    expect(surface.changedLineCount).toBe(1)
    expect(surface.truncated).toBe(false)
  })

  test('offers every line of a new file', () => {
    const added = collectChangeSurface({
      files: [
        {
          path: 'src/new.ts',
          content: 'const a = 1\nconst b = 2\n',
          hunks: [],
          isNewFile: true
        }
      ],
      maxChangeLines: 100
    })

    expect(added.files[0]?.changedLines.map((line) => line.line)).toEqual([1, 2])
  })

  test('stops at the configured bound and reports the truncation', () => {
    const bounded = collectChangeSurface({
      files: [
        {
          path: 'src/new.ts',
          content: 'a\nb\nc\n',
          hunks: [],
          isNewFile: true
        },
        {
          path: 'src/other.ts',
          content: 'd\n',
          hunks: [],
          isNewFile: true
        }
      ],
      maxChangeLines: 2
    })

    expect(bounded.truncated).toBe(true)
    expect(bounded.changedLineCount).toBe(2)
    expect(bounded.files.map((file) => file.path)).toEqual(['src/new.ts'])
  })
})

describe('removed lines as evidence (spec 23, 2026-07-30 amendment)', () => {
  const removalSurface = collectChangeSurface({
    files: [
      {
        path: 'src/cache.ts',
        // The head side kept one line; the change deleted two others.
        content: 'export const keep = 1\n',
        hunks: [{ oldStartLine: 1, oldLineCount: 3, newStartLine: 1, newLineCount: 1 }],
        isNewFile: false,
        removedLines: [
          { line: 2, text: 'const legacyCache = new Map()' },
          { line: 3, text: '  legacyCache.set(key, value)' }
        ]
      }
    ],
    maxChangeLines: 50
  })

  test('a deleted line reaches the surface and is marked removed', () => {
    // Before the amendment a pure deletion contributed nothing, so "remove the
    // old caching layer" was unprovable however completely it was done.
    expect(removalSurface.files[0]?.changedLines).toEqual([
      { line: 1, side: 'added', text: 'export const keep = 1' },
      { line: 2, side: 'removed', text: 'const legacyCache = new Map()' },
      { line: 3, side: 'removed', text: '  legacyCache.set(key, value)' }
    ])
  })

  test('an obligation can be evidenced by citing a removed line', () => {
    expect(
      verifyJudgement(
        { status: 'evidenced', evidence: [{ path: 'src/cache.ts', line: 2 }] },
        removalSurface
      )
    ).toEqual({
      status: 'evidenced',
      evidence: [
        {
          path: 'src/cache.ts',
          line: 2,
          side: 'removed',
          text: 'const legacyCache = new Map()'
        }
      ]
    })
  })

  test('the side is still verified, not taken from the answer', () => {
    // An answer claiming a line was ADDED when the surface says it was removed is
    // corrected to what the change actually did. Spec 23 requires the report to
    // disclose the side, so the disclosure has to come from the change.
    const verified = verifyJudgement(
      {
        status: 'evidenced',
        evidence: [{ path: 'src/cache.ts', line: 2, side: 'added' }]
      },
      removalSurface
    )

    expect(verified.status === 'evidenced' && verified.evidence[0]?.side).toBe(
      'removed'
    )
  })

  test('a line the change never touched is still rejected', () => {
    // The safety property is unchanged: widening what may be cited must not
    // widen it to lines outside the change.
    expect(
      verifyJudgement(
        { status: 'evidenced', evidence: [{ path: 'src/cache.ts', line: 99 }] },
        removalSurface
      )
    ).toEqual({ status: 'undetermined' })
  })
})
