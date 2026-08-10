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

// Every changed FILE's content is redacted before it reaches a packet. The diff
// was not — so a credential committed inside a changed hunk went to the provider
// verbatim in the "What this change modified" section, while the identical string
// in the surrounding file body came out `[REDACTED]`. Two paths carrying the same
// bytes to the same model, one of them redacting.
describe('the reviewed diff is redacted before it can reach a model', () => {
  test('a secret inside a diff hunk does not survive intake', async () => {
    const repositoryRoot = await createTempDir()
    const config = CodeReviewerConfigSchema.parse({})
    const leakedDiff = [
      'diff --git a/src/app.ts b/src/app.ts',
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -1,1 +1,1 @@',
      '-const token = process.env.TOKEN',
      '+const token = "ghp_0123456789abcdefghijklmnopqrstuvwxyzAB"'
    ].join('\n')

    try {
      const state = await collectReviewRunnerRepositoryIntake({
        repositoryRoot,
        config,
        explicitFiles: ['src/app.ts'],
        reviewRawDiff: leakedDiff
      })

      expect(state.effectiveRawDiff).not.toContain(
        'ghp_0123456789abcdefghijklmnopqrstuvwxyzAB'
      )
      expect(state.effectiveRawDiff).toContain('[REDACTED]')
      // The rest of the hunk must survive: redaction removes the secret, not the
      // change the reviewer is there to read.
      expect(state.effectiveRawDiff).toContain('diff --git a/src/app.ts')
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true })
    }
  })
})
