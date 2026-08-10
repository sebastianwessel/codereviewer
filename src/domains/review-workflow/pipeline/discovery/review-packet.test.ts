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

// The deterministic signal facts are extracted on EVERY run and were shown only
// to refutation: the holistic packet is one rendered `reviewText`, and nothing
// rendered this document into it. Closing that gap is a prompt change, so it is
// off by default and the disabled path must be byte-for-byte what it was before
// the section existed — the same guarantee the security pass carries.
describe('the deterministic signal facts section', () => {
  const withFacts = TaskReviewInputSchema.parse({
    ...taskInputFor(['src/plain.ts']),
    task: {
      ...taskInputFor(['src/plain.ts']).task,
      reviewContext: [
        {
          kind: 'file',
          path: 'src/plain.ts',
          content: 'export const unrelated = 1\n',
          ledgerEntryId: 'ctx_aaaaaaaaaaaaaaaaaaaaaaaa'
        },
        {
          kind: 'support-signal-output',
          content: '{"facts":[{"name":"plain","line":1}],"testMappings":[]}',
          ledgerEntryId: 'ctx_bbbbbbbbbbbbbbbbbbbbbbbb'
        }
      ]
    }
  })

  test('is absent, byte for byte, when the flag is off', () => {
    expect(buildContextSections(withFacts, rawDiff)).toEqual(
      buildContextSections(withFacts, rawDiff, false)
    )
    expect(buildContextSections(withFacts, rawDiff).join('\n')).not.toContain(
      'Declared symbols in the changed files'
    )
  })

  test('carries the facts, and says they are incomplete, when the flag is on', () => {
    const section = buildContextSections(withFacts, rawDiff, true)
      .find((entry) => entry.includes('Declared symbols in the changed files'))

    expect(section).toBeDefined()
    expect(section).toContain('"name":"plain"')
    // A reviewer that reads an extractor's output as exhaustive concludes a
    // symbol has no caller. The framing has to say otherwise.
    expect(section).toContain('INCOMPLETE by construction')
  })

  // Nothing to frame means no heading: an empty section would spend prompt on a
  // promise of facts that are not there.
  test('renders nothing when the task carries no facts', () => {
    expect(
      buildContextSections(taskInputFor(['src/plain.ts']), rawDiff, true).join('\n')
    ).not.toContain('Declared symbols in the changed files')
  })
})

// Spec 05's `citation` evidence kind. Off by default: the disabled path must be
// byte-for-byte what it was before this section existed, the same guarantee the
// signal-facts and security-pass sections carry.
describe('the citation instructions section', () => {
  const input = taskInputFor(['src/plain.ts'])

  test('is absent, byte for byte, when the flag is off', () => {
    expect(buildContextSections(input, rawDiff)).toEqual(
      buildContextSections(input, rawDiff, false, false)
    )
    expect(buildContextSections(input, rawDiff).join('\n')).not.toContain(
      '## Citing your evidence'
    )
  })

  test('is present when the flag is on, and asks for a line number and a quote', () => {
    const text = buildContextSections(input, rawDiff, false, true).join('\n')

    expect(text).toContain('## Citing your evidence')
    expect(text).toContain('startLine')
    expect(text).toContain('quote')
  })
})

// A reactive split (spec 26) halves ONE file into two tasks that keep the same
// path. Diff selection was by path alone, so each half rendered the file's whole
// diff — the split halved the source and not the diff, and each half was told
// about changes at lines it was not given.
describe('the change section of a split task', () => {
  const splitDiff = [
    'diff --git a/src/big.ts b/src/big.ts',
    'index 1111111..2222222 100644',
    '--- a/src/big.ts',
    '+++ b/src/big.ts',
    '@@ -5,1 +5,1 @@',
    '-export const nearTheTop = 0',
    '+export const nearTheTop = 1',
    '@@ -900,1 +900,1 @@',
    '-export const nearTheBottom = 0',
    '+export const nearTheBottom = 1'
  ].join('\n')

  const halfSection = (startLine: number, endLine: number): string => {
    const taskInput = TaskReviewInputSchema.parse({
      ...taskInputFor(['src/big.ts']),
      task: {
        ...taskInputFor(['src/big.ts']).task,
        reviewContext: [
          {
            kind: 'file',
            path: 'src/big.ts',
            content: 'export const unrelated = 1\n',
            startLine,
            endLine,
            ledgerEntryId: 'ctx_aaaaaaaaaaaaaaaaaaaaaaaa'
          }
        ]
      }
    })

    return (
      buildContextSections(taskInput, splitDiff).find((section) =>
        section.includes('## What this change modified')
      ) ?? ''
    )
  }

  test('shows each half only the hunks inside its own chunk', () => {
    const first = halfSection(1, 500)
    const second = halfSection(501, 1000)

    expect(first).toContain('nearTheTop = 1')
    expect(first).not.toContain('nearTheBottom = 1')
    expect(second).toContain('nearTheBottom = 1')
    expect(second).not.toContain('nearTheTop = 1')
  })

  // The whole-file case is the one every unsplit run takes, and it must be
  // untouched: a document spanning the file overlaps every hunk.
  test('leaves an unsplit whole-file task with the complete diff', () => {
    const whole = halfSection(1, 1000)

    expect(whole).toContain('nearTheTop = 1')
    expect(whole).toContain('nearTheBottom = 1')
  })
})
