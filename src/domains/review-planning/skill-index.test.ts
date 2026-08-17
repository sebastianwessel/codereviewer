import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'vitest'
import { createSkillIndex } from './skill-index.js'

const createTempDir = async (): Promise<string> => {
  const directory = join(tmpdir(), `codereviewer-skills-${crypto.randomUUID()}`)
  await mkdir(directory, { recursive: true })
  return directory
}

describe('skill index', () => {
  test('indexes nested skills without exposing raw content', async () => {
    const root = await createTempDir()

    try {
      await mkdir(join(root, '.codereviewer/skills/react/hooks'), { recursive: true })
      await writeFile(
        join(root, '.codereviewer/skills/react/SKILL.md'),
        [
          '---',
          'name: react',
          'description: Use project React conventions.',
          '---',
          '',
          '# React',
          'Use project conventions.'
        ].join('\n')
      )
      await writeFile(
        join(root, '.codereviewer/skills/react/hooks/SKILL.md'),
        [
          '---',
          'name: react-hooks',
          'description: Review React hooks.',
          '---',
          '',
          '# Hooks',
          'Never hide stale closures.'
        ].join('\n')
      )

      const index = await createSkillIndex({
        repositoryRoot: root,
        directories: ['.codereviewer/skills']
      })

      expect(index.skills).toEqual([
        expect.objectContaining({
          id: 'react',
          path: '.codereviewer/skills/react/SKILL.md',
          directory: '.codereviewer/skills/react',
          absoluteDirectory: join(root, '.codereviewer/skills/react'),
          description: 'Use project React conventions.',
          contentHash: expect.stringMatching(/^[a-f0-9]{64}$/)
        }),
        expect.objectContaining({
          id: 'react-hooks',
          path: '.codereviewer/skills/react/hooks/SKILL.md',
          directory: '.codereviewer/skills/react/hooks',
          absoluteDirectory: join(root, '.codereviewer/skills/react/hooks'),
          description: 'Review React hooks.',
          contentHash: expect.stringMatching(/^[a-f0-9]{64}$/)
        })
      ])
      expect(JSON.stringify(index)).not.toContain('Never hide stale closures')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  // THE LAYOUT THAT USED TO CRASH. An operator who points `skills.directories`
  // at a folder and puts `SKILL.md` in it is doing something spec 04 (*Skills*)
  // permits, and it threw `TypeError: Path value must not be empty.` — a message
  // naming neither the file nor a cause — because the configured directory and
  // the skill's own directory were the same path, and the relative path between
  // two equal paths is the empty string.
  //
  // A sibling nested skill is indexed in the same run on purpose: the root skill
  // must not swallow, shadow or rename it.
  test('indexes a SKILL.md placed directly in a configured skills directory', async () => {
    const root = await createTempDir()

    try {
      await mkdir(join(root, '.codereviewer/skills/react'), { recursive: true })
      await writeFile(
        join(root, '.codereviewer/skills/SKILL.md'),
        [
          '---',
          'name: house-rules',
          'description: Repository-wide review rules.',
          '---',
          '',
          '# House rules'
        ].join('\n')
      )
      await writeFile(
        join(root, '.codereviewer/skills/react/SKILL.md'),
        [
          '---',
          'name: react',
          'description: Use project React conventions.',
          '---',
          '',
          '# React'
        ].join('\n')
      )

      const index = await createSkillIndex({
        repositoryRoot: root,
        directories: ['.codereviewer/skills']
      })

      expect(index.skills).toEqual([
        expect.objectContaining({
          id: 'house-rules',
          path: '.codereviewer/skills/SKILL.md',
          directory: '.codereviewer/skills',
          absoluteDirectory: join(root, '.codereviewer/skills')
        }),
        expect.objectContaining({
          id: 'react',
          path: '.codereviewer/skills/react/SKILL.md',
          directory: '.codereviewer/skills/react',
          absoluteDirectory: join(root, '.codereviewer/skills/react')
        })
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  // The same defect one level further out: with the repository root itself
  // configured, the skill's directory equals the REPOSITORY root rather than the
  // configured root, and the second relative-path computation threw for the same
  // reason. `.` is the conventional spelling of the repository root here, the one
  // `normalizeRepositoryRelativePath` already uses.
  test('indexes a SKILL.md at the repository root when the root is the configured directory', async () => {
    const root = await createTempDir()

    try {
      await writeFile(
        join(root, 'SKILL.md'),
        [
          '---',
          'name: house-rules',
          'description: Repository-wide review rules.',
          '---',
          '',
          '# House rules'
        ].join('\n')
      )

      const index = await createSkillIndex({
        repositoryRoot: root,
        directories: ['.']
      })

      expect(index.skills).toEqual([
        expect.objectContaining({
          id: 'house-rules',
          path: 'SKILL.md',
          directory: '.',
          absoluteDirectory: root
        })
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('rejects skill directories outside the repository root', async () => {
    const root = await createTempDir()

    try {
      await expect(
        createSkillIndex({
          repositoryRoot: root,
          directories: ['../skills']
        })
      ).rejects.toThrow(TypeError)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('rejects malformed skill files before harness construction', async () => {
    const root = await createTempDir()

    try {
      await mkdir(join(root, '.codereviewer/skills/react'), { recursive: true })
      await writeFile(join(root, '.codereviewer/skills/react/SKILL.md'), '# React')

      await expect(
        createSkillIndex({
          repositoryRoot: root,
          directories: ['.codereviewer/skills']
        })
      ).rejects.toThrow(/frontmatter/u)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
