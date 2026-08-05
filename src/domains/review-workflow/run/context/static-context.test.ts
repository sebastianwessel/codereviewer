import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'vitest'
import { CodeReviewerConfigSchema } from '../../../../shared/contracts/index.js'
import {
  instructionAppliesToFiles,
  loadStaticReviewContext,
  selectInstructionsForFiles
} from './static-context.js'

const createTempDir = async (): Promise<string> => {
  const directory = join(tmpdir(), `codereviewer-static-context-${crypto.randomUUID()}`)
  await mkdir(directory, { recursive: true })
  return directory
}

describe('review runner static context', () => {
  test('loads instruction and skill contexts with ledger entries and harness definitions', async () => {
    const root = await createTempDir()

    try {
      await mkdir(join(root, '.codereviewer/skills/security'), {
        recursive: true
      })
      await writeFile(join(root, 'AGENTS.md'), 'Follow project rules.')
      await writeFile(
        join(root, '.codereviewer/skills/security/SKILL.md'),
        [
          '---',
          'name: security',
          'description: Review security-sensitive changes.',
          '---',
          '',
          '# Security',
          'Inspect auth and data boundaries.'
        ].join('\n')
      )
      const config = CodeReviewerConfigSchema.parse({
        instructions: {
          files: [{ path: 'AGENTS.md' }],
          inline: 'Inline review guidance'
        },
        skills: {
          enabled: true,
          directories: ['.codereviewer/skills']
        }
      })

      const result = await loadStaticReviewContext({
        repositoryRoot: root,
        config
      })

      expect(result.instructions.map((instruction) => instruction.path)).toEqual([
        'AGENTS.md',
        '.codereviewer/inline-instructions'
      ])
      expect(result.skills).toEqual([
        expect.objectContaining({
          name: 'security',
          path: '.codereviewer/skills/security/SKILL.md',
          directory: '.codereviewer/skills/security',
          allowed: true
        })
      ])
      expect(result.skillIds).toEqual(['security'])
      expect(result.skillDefinitions.security).toEqual({
        directory: join(root, '.codereviewer/skills/security'),
        validationMode: 'strict',
        trust: 'project',
        source: 'repository'
      })
      expect(result.contextLedger.map((entry) => entry.kind)).toEqual([
        'instruction',
        'instruction',
        'skill'
      ])
      expect(result.contextLedger.map((entry) => entry.reason)).toEqual([
        'instruction-context',
        'instruction-context',
        'skill-context'
      ])
      // Neither instruction is scoped, so there is nothing to disclose: an
      // unscoped run produces the same, empty `instructionScopes` it always
      // produced before scoping existed.
      expect(result.instructionScopes).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('a missing configured instruction file still fails the run', async () => {
    const root = await createTempDir()

    try {
      const config = CodeReviewerConfigSchema.parse({
        instructions: { files: [{ path: 'missing.md' }] }
      })

      await expect(
        loadStaticReviewContext({ repositoryRoot: root, config })
      ).rejects.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('an invalid scope glob fails the run at load time, not silently at match time', async () => {
    const root = await createTempDir()

    try {
      await writeFile(join(root, 'AGENTS.md'), 'Follow project rules.')
      const config = CodeReviewerConfigSchema.parse({
        instructions: {
          files: [{ path: 'AGENTS.md', scope: ['x'.repeat(5000)] }]
        }
      })

      await expect(
        loadStaticReviewContext({ repositoryRoot: root, config })
      ).rejects.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('carries a scoped instruction file\'s scope alongside its document', async () => {
    const root = await createTempDir()

    try {
      await mkdir(join(root, 'backend'), { recursive: true })
      await writeFile(join(root, 'backend/AGENTS.md'), 'Backend-only guidance.')
      await writeFile(join(root, 'AGENTS.md'), 'Repo-wide guidance.')
      const config = CodeReviewerConfigSchema.parse({
        instructions: {
          files: [
            { path: 'backend/AGENTS.md', scope: ['backend/**'] },
            { path: 'AGENTS.md' }
          ],
          inline: 'Inline, always applies'
        }
      })

      const result = await loadStaticReviewContext({ repositoryRoot: root, config })

      expect(result.instructionScopes).toEqual([
        { path: 'backend/AGENTS.md', scope: ['backend/**'] }
      ])

      // A packet reviewing only frontend files never sees the backend-scoped
      // instruction, but keeps both the repo-wide file and the inline text.
      const frontendSelection = selectInstructionsForFiles(
        result.instructions,
        result.instructionScopes,
        ['frontend/app.ts']
      )

      expect(frontendSelection.included.map((doc) => doc.path)).toEqual([
        'AGENTS.md',
        '.codereviewer/inline-instructions'
      ])
      expect(frontendSelection.skipped).toEqual([
        { path: 'backend/AGENTS.md', scope: ['backend/**'] }
      ])

      // A multi-file packet that mixes ONE backend file with unrelated files
      // still includes the backend-scoped instruction: the "any file
      // matches" rule fails safe toward including guidance, never toward
      // silently withholding it because clustering happened to combine
      // files.
      const mixedSelection = selectInstructionsForFiles(
        result.instructions,
        result.instructionScopes,
        ['frontend/app.ts', 'backend/api.ts']
      )

      expect(mixedSelection.included.map((doc) => doc.path)).toEqual([
        'backend/AGENTS.md',
        'AGENTS.md',
        '.codereviewer/inline-instructions'
      ])
      expect(mixedSelection.skipped).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('instructionAppliesToFiles', () => {
  test('an unscoped instruction applies regardless of files, including none', () => {
    expect(instructionAppliesToFiles(undefined, [])).toBe(true)
    expect(instructionAppliesToFiles(undefined, ['anything.ts'])).toBe(true)
  })

  test('a scoped instruction applies when ANY reviewed file matches ANY pattern', () => {
    expect(
      instructionAppliesToFiles(['backend/**'], ['frontend/app.ts', 'backend/api.ts'])
    ).toBe(true)
  })

  test('a scoped instruction does not apply when no reviewed file matches', () => {
    expect(instructionAppliesToFiles(['backend/**'], ['frontend/app.ts'])).toBe(false)
    expect(instructionAppliesToFiles(['backend/**'], [])).toBe(false)
  })

  test('scope patterns match portable repository-relative paths regardless of authoring style', () => {
    // Patterns may be authored with backslashes on Windows; the shared glob
    // matcher normalizes them the same way `paths.include`/`paths.exclude` do.
    expect(
      instructionAppliesToFiles(['backend\\**'], ['backend/api.ts'])
    ).toBe(true)
  })
})
