import { describe, expect, test } from 'vitest'
import {
  removedProseCommentsIn,
  resolveRemovedCommentDisclosures
} from './real-repo-diff-comment-disclosure.js'

const diffOf = (...bodyLines: readonly string[]): string =>
  [
    'diff --git a/lib/handler.js b/lib/handler.js',
    '--- a/lib/handler.js',
    '+++ b/lib/handler.js',
    '@@ -1,6 +1,4 @@',
    ...bodyLines,
    ''
  ].join('\n')

describe('removed prose comments in a reversed corpus diff', () => {
  // The corpus reviews base = fixCommit, head = parentCommit, so a comment the
  // upstream fix ADDED is a REMOVED line here, and the reviewer is handed the
  // expectation in English. This is the case the advisory scan cannot see: there
  // is no advisory id, no "vulnerability", no "exploit" — just an engineer
  // explaining the defect.
  test('flags a removed comment that explains the defect in prose', () => {
    expect(
      removedProseCommentsIn(
        diffOf(
          '-        // This must be an assignment, not |=: xlen starts at the -1',
          '-        // sentinel, so the extra field is never skipped.',
          '-        xlen = xlen2 << 8 | xlen1;',
          '+        xlen |= xlen1 << 8 | xlen2;'
        )
      )
    ).toEqual([
      '// This must be an assignment, not |=: xlen starts at the -1',
      '// sentinel, so the extra field is never skipped.'
    ])
  })

  test('reads a removed line whose own content starts with a comment marker', () => {
    // `-- comment` in Lua or SQL becomes `--- comment` as a diff line, which a
    // rule that skipped lines starting with `---` would drop as a file header.
    expect(
      removedProseCommentsIn(
        diffOf(
          '--- no labels to map: just drop client-supplied copies of the headers',
          '-local labels = ctx.consumer and ctx.consumer.labels'
        )
      )
    ).toEqual([
      '-- no labels to map: just drop client-supplied copies of the headers'
    ])
  })

  test('ignores added comments, context comments, and short marker lines', () => {
    expect(
      removedProseCommentsIn(
        diffOf(
          '+// The fix added this comment, so it is on the new side and the',
          '+// reviewer reads it as part of the code under review.',
          ' // Context lines are neither added nor removed by this change.',
          '-*/',
          '-# noqa',
          '-const value = decode(input)'
        )
      )
    ).toEqual([])
  })

  test('reports each distinct comment once however often it was removed', () => {
    expect(
      removedProseCommentsIn(
        diffOf(
          '-      // Coerce primitives and reject unsafe coercions such as functions.',
          '-      throw new InvalidArgumentError(`invalid ${key} header`)',
          '@@ -20,4 +18,2 @@',
          '-  // Coerce primitives and reject unsafe coercions such as functions.',
          '-  throw new InvalidArgumentError(`invalid ${key} header`)'
        )
      )
    ).toHaveLength(1)
  })

  // The rule cannot tell disclosure from boilerplate, and this is the exact
  // reason it produces a curator warning instead of a hard failure: a licence
  // header is prose in a comment and is flagged like any other, while a hard
  // failure on it would invite whoever hit it to weaken the rule until the
  // corpus passed again.
  test('flags a licence header, which a curator then resolves rather than the rule excusing', () => {
    const copyrightHeader =
      '* Copyright 2014-2026 JetBrains s.r.o and contributors. Use of this source code is governed by the Apache 2.0 license.'

    expect(removedProseCommentsIn(diffOf(`-${copyrightHeader}`))).toEqual([
      copyrightHeader
    ])
    expect(
      resolveRemovedCommentDisclosures({
        flaggedComments: [copyrightHeader],
        acknowledgedComments: [copyrightHeader]
      })
    ).toEqual({ unresolvedComments: [], staleAcknowledgements: [] })
  })
})

describe('removed comment disclosure resolution', () => {
  test('reports a flagged comment no curator acknowledged', () => {
    expect(
      resolveRemovedCommentDisclosures({
        flaggedComments: ['// judged already', '// nobody has read this one'],
        acknowledgedComments: ['// judged already']
      }).unresolvedComments
    ).toEqual(['// nobody has read this one'])
  })

  // An acknowledgement that outlives the comment it described is a blanket
  // approval waiting to cover the next disclosure a re-capture introduces.
  test('reports an acknowledgement the diff no longer removes', () => {
    expect(
      resolveRemovedCommentDisclosures({
        flaggedComments: [],
        acknowledgedComments: ['// removed by a narrower reviewedPaths set']
      }).staleAcknowledgements
    ).toEqual(['// removed by a narrower reviewedPaths set'])
  })
})
