import { describe, expect, test } from 'vitest'
import type { SupportSignalFact } from '../../../deterministic-signals/index.js'
import { findPromptGenericityViolations } from '../../../../shared/testing/prompt-genericity-guard.js'
import { collectGuardedRegionContext } from './guarded-region-context.js'

const declarationFact = (
  path: string,
  name: string,
  line: number
): SupportSignalFact => ({
  id: `fact_${path}_${name}_${line}`,
  language: 'typescript',
  kind: 'declaration',
  path,
  name,
  line,
  summary: `declaration ${name}`,
  contentHash: 'a'.repeat(64)
})

const handlerSource = [
  'export const exportUsers = (request) => {', // 1
  '  if (request.role) {', //                    2
  '    return dump(loadUsers())', //             3
  '  }', //                                      4
  '  return deny()', //                          5
  '}' //                                         6
].join('\n')

describe('collectGuardedRegionContext', () => {
  test('describes the changed conditional, its extent, and what it calls', () => {
    const result = collectGuardedRegionContext({
      sourceFiles: [{ path: 'src/handler.ts', content: handlerSource }],
      facts: [declarationFact('src/handler.ts', 'exportUsers', 1)],
      reviewedDiffRanges: [
        { path: 'src/handler.ts', startLine: 2, endLine: 2 }
      ],
      taskPaths: ['src/handler.ts']
    })

    expect(result.regionCount).toBe(1)
    expect(result.sectionText).toContain('src/handler.ts:2')
    expect(result.sectionText).toContain('`exportUsers`')
    expect(result.sectionText).toContain('precedes lines 3-5')
    expect(result.sectionText).toContain('dump, loadUsers, deny')
    expect(result.priorityCalleeNames).toEqual(['dump', 'loadUsers', 'deny'])
  })

  test('the section tells the reviewer it is not evidence of a defect', () => {
    // The whole basis for this section being safe to add is that it asserts
    // structure and nothing else. A neutral "did this weaken security?" framing is
    // measured to clear already-patched clean files only 3.2-11.8% of the time, so
    // the disclaimer is load-bearing rather than decorative and is asserted here.
    const result = collectGuardedRegionContext({
      sourceFiles: [{ path: 'src/handler.ts', content: handlerSource }],
      facts: [declarationFact('src/handler.ts', 'exportUsers', 1)],
      reviewedDiffRanges: [
        { path: 'src/handler.ts', startLine: 2, endLine: 2 }
      ],
      taskPaths: ['src/handler.ts']
    })

    expect(result.sectionText).toContain('does NOT claim')
    expect(result.sectionText).toContain('deliberate change will appear here')
    expect(result.sectionText).not.toMatch(/vulnerab|insecure|exploit|unsafe code/iu)
  })

  test('the section is language-neutral (spec 15 Non-Negotiable)', () => {
    const result = collectGuardedRegionContext({
      sourceFiles: [{ path: 'src/handler.ts', content: handlerSource }],
      facts: [declarationFact('src/handler.ts', 'exportUsers', 1)],
      reviewedDiffRanges: [
        { path: 'src/handler.ts', startLine: 2, endLine: 2 }
      ],
      taskPaths: ['src/handler.ts']
    })

    expect(
      findPromptGenericityViolations({
        promptName: 'guarded-region',
        prompt: result.sectionText
      })
    ).toEqual([])
  })

  test('yields nothing when the diff did not touch a conditional', () => {
    const result = collectGuardedRegionContext({
      sourceFiles: [{ path: 'src/handler.ts', content: handlerSource }],
      facts: [declarationFact('src/handler.ts', 'exportUsers', 1)],
      // Line 5 changed; the conditional on line 2 did not.
      reviewedDiffRanges: [
        { path: 'src/handler.ts', startLine: 5, endLine: 5 }
      ],
      taskPaths: ['src/handler.ts']
    })

    expect(result).toEqual({
      sectionText: '',
      priorityCalleeNames: [],
      regionCount: 0
    })
  })

  test('yields nothing for a file outside the task', () => {
    const result = collectGuardedRegionContext({
      sourceFiles: [{ path: 'src/handler.ts', content: handlerSource }],
      facts: [declarationFact('src/handler.ts', 'exportUsers', 1)],
      reviewedDiffRanges: [
        { path: 'src/handler.ts', startLine: 2, endLine: 2 }
      ],
      taskPaths: ['src/other.ts']
    })

    expect(result.regionCount).toBe(0)
    expect(result.sectionText).toBe('')
  })

  test('yields nothing with no diff ranges at all', () => {
    // An explicit-file run has no diff. The trigger is a CHANGED conditional, so
    // it must stay silent rather than describing every conditional in the file.
    const result = collectGuardedRegionContext({
      sourceFiles: [{ path: 'src/handler.ts', content: handlerSource }],
      facts: [declarationFact('src/handler.ts', 'exportUsers', 1)],
      reviewedDiffRanges: [],
      taskPaths: ['src/handler.ts']
    })

    expect(result.sectionText).toBe('')
  })

  test('caps the listed regions and says how many it withheld', () => {
    const lines = ['export const wide = (input) => {']
    for (let index = 0; index < 20; index += 1) {
      lines.push(`  if (input.flag${index}) {`, `    return handle${index}()`, '  }')
    }
    lines.push('  return fallback()', '}')

    const result = collectGuardedRegionContext({
      sourceFiles: [{ path: 'src/wide.ts', content: lines.join('\n') }],
      facts: [declarationFact('src/wide.ts', 'wide', 1)],
      reviewedDiffRanges: [
        { path: 'src/wide.ts', startLine: 1, endLine: lines.length }
      ],
      taskPaths: ['src/wide.ts']
    })

    expect(result.regionCount).toBe(20)
    expect(result.sectionText.split('\n- ')).toHaveLength(13)
    expect(result.sectionText).toContain('8 further changed conditionals not listed')
  })
})
