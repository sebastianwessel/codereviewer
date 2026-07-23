import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { CodeReviewerConfigSchema } from '../../../../shared/contracts/index.js'
import {
  collectReviewRunnerRepositoryIntake,
  readReviewRunnerSourceInput
} from './repository-input.js'

const createTempDir = async (): Promise<string> => {
  const directory = join(tmpdir(), `codereviewer-runner-input-${crypto.randomUUID()}`)
  await mkdir(directory, { recursive: true })
  return directory
}

describe('review runner repository input', () => {
  test('collects explicit files, reads source, and applies review diff map override', async () => {
    const repositoryRoot = await createTempDir()

    try {
      await mkdir(join(repositoryRoot, 'src'), { recursive: true })
      await writeFile(join(repositoryRoot, 'src', 'app.ts'), 'one\ntwo\n')

      const diffMapOverride = {
        path: 'src/app.ts',
        changeKind: 'modified' as const,
        hunks: [
          {
            oldStartLine: 1,
            oldLineCount: 1,
            newStartLine: 2,
            newLineCount: 1
          }
        ]
      }

      const intakeState = await collectReviewRunnerRepositoryIntake({
        repositoryRoot,
        config: CodeReviewerConfigSchema.parse({}),
        explicitFiles: ['src/app.ts'],
        reviewDiffMaps: [diffMapOverride]
      })
      const sourceState = await readReviewRunnerSourceInput({
        repositoryRoot,
        intake: intakeState.intake
      })
      const result = { ...intakeState, ...sourceState }

      expect(result.intake.changedFiles.map((file) => file.path)).toEqual([
        'src/app.ts'
      ])
      expect(result.sourceFiles).toEqual([
        { path: 'src/app.ts', content: 'one\ntwo\n' }
      ])
      expect(result.effectiveDiffMaps).toEqual([diffMapOverride])
      expect(result.effectiveDiffRanges).toEqual([
        {
          path: 'src/app.ts',
          startLine: 2,
          endLine: 2,
          changeKind: 'modified'
        }
      ])
      expect(result.intakeMetrics).toEqual({
        changedFileCount: 1,
        skippedFileCount: 0
      })
      expect(result.sourceReadMetrics).toEqual({ fileCount: 1 })
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true })
    }
  })
})
