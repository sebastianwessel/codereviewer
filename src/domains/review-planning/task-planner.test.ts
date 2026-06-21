import { describe, expect, test } from 'vitest'
import { planReviewTasks } from './task-planner.js'

const contentHash =
  '1111111111111111111111111111111111111111111111111111111111111111'

describe('review task planner', () => {
  test('fast depth creates one review task per changed file', () => {
    const tasks = planReviewTasks({
      depth: 'fast',
      files: [{ path: 'src/app.ts' }, { path: 'src/util.ts' }],
      facts: [],
      evidence: [],
      candidates: []
    })

    expect(tasks).toEqual([
      expect.objectContaining({
        kind: 'file',
        paths: ['src/app.ts'],
        priority: 0,
        round: 1
      }),
      expect.objectContaining({
        kind: 'file',
        paths: ['src/util.ts'],
        priority: 1,
        round: 1
      })
    ])
  })

  test('balanced depth clusters files connected by relative imports', () => {
    const tasks = planReviewTasks({
      depth: 'balanced',
      files: [
        { path: 'src/app.ts' },
        { path: 'src/util.ts' },
        { path: 'src/isolated.ts' }
      ],
      facts: [
        {
          id: 'fact_import',
          language: 'typescript',
          kind: 'import',
          path: 'src/app.ts',
          name: 'util',
          moduleSpecifier: './util.js',
          line: 1,
          summary: 'Imports util.',
          contentHash
        }
      ],
      evidence: [],
      candidates: []
    })

    expect(tasks).toEqual([
      expect.objectContaining({
        kind: 'dependency-cluster',
        paths: ['src/app.ts', 'src/util.ts']
      }),
      expect.objectContaining({
        kind: 'dependency-cluster',
        paths: ['src/isolated.ts']
      })
    ])
  })

  test('balanced depth packs disconnected singleton files into bounded clusters', () => {
    const tasks = planReviewTasks({
      depth: 'balanced',
      files: Array.from({ length: 10 }, (_, index) => ({
        path: `docs/page-${index}.md`
      })),
      facts: [],
      evidence: [],
      candidates: []
    })

    expect(tasks.map((task) => task.paths.length)).toEqual([8, 2])
  })

  test('balanced depth splits large connected dependency clusters into bounded packets', () => {
    const files = Array.from({ length: 10 }, (_, index) => ({
      path: `src/file-${index}.ts`
    }))
    const facts = files.slice(0, -1).map((file, index) => ({
      id: `fact_import_${index}`,
      language: 'typescript' as const,
      kind: 'import' as const,
      path: file.path,
      name: `file-${index + 1}`,
      moduleSpecifier: `./file-${index + 1}.js`,
      line: 1,
      summary: 'Imports next file.',
      contentHash
    }))
    const tasks = planReviewTasks({
      depth: 'balanced',
      files,
      facts,
      evidence: [],
      candidates: []
    })

    expect(tasks.map((task) => task.paths.length)).toEqual([8, 2])
  })

  test('thorough depth adds a policy task after dependency clusters', () => {
    const tasks = planReviewTasks({
      depth: 'thorough',
      files: [{ path: 'src/app.ts' }],
      facts: [],
      evidence: [],
      candidates: []
    })

    expect(tasks).toEqual([
      expect.objectContaining({
        kind: 'dependency-cluster',
        paths: ['src/app.ts'],
        round: 1
      }),
      expect.objectContaining({
        kind: 'policy',
        paths: ['src/app.ts'],
        round: 2
      })
    ])
  })

  test('thorough depth keeps policy tasks bounded by cluster packets', () => {
    const tasks = planReviewTasks({
      depth: 'thorough',
      files: Array.from({ length: 10 }, (_, index) => ({
        path: `src/file-${index}.ts`
      })),
      facts: [],
      evidence: [],
      candidates: []
    })

    const policyTasks = tasks.filter((task) => task.kind === 'policy')

    expect(policyTasks.map((task) => task.paths.length)).toEqual([8, 2])
    expect(policyTasks.every((task) => task.round === 2)).toBe(true)
  })
})
