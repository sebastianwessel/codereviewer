// Spec 25 Arm A at the packet boundary.
//
// The decisive test here is the OFF control. Spec 25's decision rule compares
// three arms against a recorded baseline, and that comparison is only meaningful
// if the arm, switched off, leaves the packet byte-for-byte as it was. A section
// that leaked in when disabled would not fail loudly — it would quietly move the
// baseline and make every later number describe a different pipeline.

import { describe, expect, test } from 'vitest'
import {
  TaskReviewInputSchema,
  type WorkflowReviewTask
} from '../agent-contracts.js'
import { buildReviewText } from './review-packet.js'

const provenance = {
  reviewer: 'review-agent',
  modelProvider: 'openai',
  modelName: 'guarded-region-test',
  signalVersions: { typescript: '6.0.3' },
  configHash: '4'.repeat(64)
}

const GUARDED_REGION_SECTION =
  '\n## Changed conditionals (deterministic, structural)\n' +
  'It does NOT claim any of these is wrong.\n' +
  '- src/app.ts:2 — a conditional in `isAdmin` changed; it precedes lines 3-4.'

const task = (withGuardedRegion: boolean): WorkflowReviewTask => ({
  id: 'task_guarded',
  kind: 'file',
  round: 1,
  paths: ['src/app.ts'],
  factIds: [],
  evidenceIds: [],
  candidateIds: [],
  contextEntryIds: [],
  priority: 1,
  reviewContext: [
    {
      kind: 'file',
      path: 'src/app.ts',
      content: 'export const isAdmin = (role) => {\n  if (role) {\n    return grant()\n  }\n}\n',
      ledgerEntryId: 'ctx_aaaaaaaaaaaaaaaaaaaaaaaa'
    },
    ...(withGuardedRegion
      ? ([
          {
            kind: 'guarded-region' as const,
            content: GUARDED_REGION_SECTION,
            ledgerEntryId: 'ctx_cccccccccccccccccccccccc'
          }
        ] as const)
      : [])
  ]
})

const reviewTextFor = (withGuardedRegion: boolean): string =>
  buildReviewText(
    TaskReviewInputSchema.parse({
      task: task(withGuardedRegion),
      reviewedDiffRanges: [{ path: 'src/app.ts', startLine: 2, endLine: 2 }],
      evidence: [],
      candidates: [],
      instructions: [],
      skills: [],
      sharedDigest: 'digest',
      provenance
    }),
    ''
  )

describe('guarded-region section in the discovery packet', () => {
  test('with the arm off, the packet is byte-for-byte the pre-spec-25 packet', () => {
    const packet = reviewTextFor(false)

    expect(packet).not.toContain('Changed conditionals')
    // No stray separator either: an empty section that still contributed a blank
    // line would change the prompt bytes and, with prompt caching keyed on a
    // leading-token prefix, could change cost as well as content.
    expect(packet).toBe(
      [
        'Review task task_guarded.',
        '',
        '## Reviewed diff ranges (what changed)',
        'src/app.ts lines 2-2',
        '',
        '## Changed files (full content, line-numbered, for context)',
        '### FILE: src/app.ts',
        '1: export const isAdmin = (role) => {',
        '2:   if (role) {',
        '3:     return grant()',
        '4:   }',
        '5: }',
        '6: ',
        '',
        '',
        ''
      ].join('\n')
    )
  })

  test('with the arm on, the section is delivered verbatim', () => {
    const packet = reviewTextFor(true)

    expect(packet).toContain('## Changed conditionals (deterministic, structural)')
    expect(packet).toContain('src/app.ts:2')
    expect(packet).toContain('It does NOT claim any of these is wrong.')
  })

  test('the section follows the source it points into, and precedes nothing that outranks it', () => {
    const packet = reviewTextFor(true)

    // It names line numbers, so the line-numbered source has to be on the page
    // above it or the reader cannot resolve the reference.
    expect(packet.indexOf('### FILE: src/app.ts')).toBeLessThan(
      packet.indexOf('## Changed conditionals')
    )
  })

  test('turning the arm on adds only the section', () => {
    // The arm must not perturb anything else in the packet. Removing exactly the
    // section from the on-packet must reproduce the off-packet.
    const off = reviewTextFor(false)
    const on = reviewTextFor(true)

    expect(on.replace(GUARDED_REGION_SECTION, '')).toBe(off)
  })
})
