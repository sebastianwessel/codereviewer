// The "What this change modified" section is assembled by splitting the raw diff
// on its `diff --git` headers and keeping the segments whose path the task is
// reviewing. Both sides of that comparison read the SAME header text, so both
// must read it with the same parser: intake derives `task.paths` through
// `parseGitDiffNewPath`, which decodes git's C-quoted octal escapes and
// normalizes separators. A private copy that keeps the header bytes verbatim
// agrees with it for ASCII paths and disagrees for every path git had to quote —
// and the disagreement is silent, because a segment that matches nothing is
// simply not emitted.

import { describe, expect, test } from 'vitest'
import { parseGitDiffNewPath } from '../../../../shared/diff/git-diff-header.js'
import { TaskReviewInputSchema } from '../agent-contracts.js'
import { buildContextSections } from './review-packet.js'

// Git C-quotes and octal-escapes any path with a non-ASCII byte (`core.quotePath`
// is on by default), so this is the header a changed `café.ts` really produces.
const quotedHeader = 'diff --git "a/src/caf\\303\\251.ts" "b/src/caf\\303\\251.ts"'
const plainHeader = 'diff --git a/src/plain.ts b/src/plain.ts'

// Exactly what intake stores as the changed path. Derived here rather than
// written out, because the claim under test is that the two sides agree by
// construction — a literal would only prove they agree with a literal.
const quotedPath = parseGitDiffNewPath(quotedHeader)

const rawDiff = [
  plainHeader,
  'index 1111111..2222222 100644',
  '--- a/src/plain.ts',
  '+++ b/src/plain.ts',
  '@@ -1,1 +1,1 @@',
  '-export const plain = 0',
  '+export const plain = 1',
  quotedHeader,
  'index 3333333..4444444 100644',
  '--- a/src/caf\\303\\251.ts',
  '+++ b/src/caf\\303\\251.ts',
  '@@ -1,1 +1,1 @@',
  '-export const accented = 0',
  '+export const accented = 1'
].join('\n')

const taskInputFor = (paths: readonly string[]) =>
  TaskReviewInputSchema.parse({
    task: {
      id: 'task_packet',
      kind: 'file',
      round: 1,
      paths: [...paths],
      factIds: [],
      evidenceIds: [],
      candidateIds: [],
      contextEntryIds: [],
      priority: 1,
      instructions: [],
      // Deliberately not the diff's own text: the packet also renders every
      // reviewed file in full, so content shared with the diff would let an
      // assertion about the change section pass on the file section instead.
      reviewContext: paths.map((path) => ({
        kind: 'file',
        path,
        content: 'export const unrelated = 1\n',
        ledgerEntryId: 'ctx_aaaaaaaaaaaaaaaaaaaaaaaa'
      }))
    },
    reviewedDiffRanges: paths.map((path) => ({
      path,
      startLine: 1,
      endLine: 1
    })),
    evidence: [],
    candidates: [],
    skills: [],
    sharedDigest: 'digest',
    provenance: {
      reviewer: 'review-agent',
      modelProvider: 'openai',
      modelName: 'packet-test',
      signalVersions: {},
      configHash:
        '5555555555555555555555555555555555555555555555555555555555555555'
    }
  })

// The diff section alone. The packet also renders every reviewed file in full,
// and asserting over the whole packet would let a diff-section claim pass on the
// file section.
const changeSectionOf = (paths: readonly string[]): string =>
  buildContextSections(taskInputFor(paths), rawDiff).find((section) =>
    section.includes('## What this change modified')
  ) ?? ''

describe('the change section of the discovery packet', () => {
  test('shows the hunk of a changed file whose name git had to quote', () => {
    expect(quotedPath).toBeDefined()

    const section = changeSectionOf([quotedPath ?? '', 'src/plain.ts'])

    // The section is headed "What this change modified" and is read as a
    // statement about the whole change. A file whose hunk is missing is not
    // reported as missing — it simply is not there, so the reviewer reads a
    // complete-looking account of a change it was shown only part of.
    expect(section).toContain('export const accented = 1')
    expect(section).toContain('export const plain = 1')
  })

  test('still keeps a segment out when the task is not reviewing that file', () => {
    const section = changeSectionOf(['src/plain.ts'])

    expect(section).toContain('export const plain = 1')
    expect(section).not.toContain('export const accented = 1')
  })
})
