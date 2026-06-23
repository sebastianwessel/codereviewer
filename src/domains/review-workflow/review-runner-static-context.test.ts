import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'vitest'
import { CodeReviewerConfigSchema } from '../../shared/contracts/index.js'
import { loadStaticReviewContext } from './review-runner-static-context.js'

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
          files: ['AGENTS.md'],
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
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
