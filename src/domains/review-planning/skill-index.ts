import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  resolveExistingPathInsideRoot,
  toPortablePath
} from '../../platform/path-service.js'
import { normalizeRepositoryRelativePath } from '../../platform/repository-path.js'
import { sha256 } from '../../shared/hash/hash.js'

export type SkillIndexEntry = {
  readonly id: string
  readonly path: string
  readonly directory: string
  readonly absoluteDirectory: string
  readonly contentHash: string
  readonly description: string
}

export type SkillIndex = {
  readonly skills: readonly SkillIndexEntry[]
}

export type CreateSkillIndexOptions = {
  readonly repositoryRoot: string
  readonly directories: readonly string[]
}

const skillFileName = 'SKILL.md'
const skillNamePattern = /^(?!-)(?!.*--)[a-z0-9-]{1,64}(?<!-)$/u

const portableRelativePath = (from: string, to: string): string =>
  toPortablePath(path.relative(from, to), { flavor: 'posix' })

const extractFrontmatter = (
  content: string,
  skillFile: string
): Readonly<Record<string, string>> => {
  if (!content.startsWith('---\n')) {
    throw new TypeError(`Skill file "${skillFile}" must start with YAML frontmatter.`)
  }

  const end = content.indexOf('\n---', 4)

  if (end < 0) {
    throw new TypeError(`Skill file "${skillFile}" frontmatter is not terminated.`)
  }

  const fields: Record<string, string> = {}

  for (const rawLine of content.slice(4, end).split(/\r?\n/u)) {
    const separator = rawLine.indexOf(':')

    if (separator <= 0) {
      continue
    }

    const key = rawLine.slice(0, separator).trim()
    const value = rawLine.slice(separator + 1).trim()

    fields[key] = value.replace(/^"|"$/gu, '').replace(/^'|'$/gu, '')
  }

  return fields
}

const parseSkillMetadata = (
  content: string,
  skillFile: string
): {
  readonly name: string
  readonly description: string
} => {
  const frontmatter = extractFrontmatter(content, skillFile)
  const name = frontmatter.name?.trim() ?? ''
  const description = frontmatter.description?.trim() ?? ''

  if (!skillNamePattern.test(name)) {
    throw new TypeError(
      `Skill file "${skillFile}" must define a valid harness skill name.`
    )
  }

  if (description.length < 1 || description.length > 1024) {
    throw new TypeError(
      `Skill file "${skillFile}" must define a description between 1 and 1024 characters.`
    )
  }

  return { name, description }
}

const findSkillFiles = async (directory: string): Promise<readonly string[]> => {
  const entries = await readdir(directory, { withFileTypes: true })
  const skillFiles: string[] = []

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      skillFiles.push(...(await findSkillFiles(entryPath)))
    } else if (entry.isFile() && entry.name === skillFileName) {
      skillFiles.push(entryPath)
    }
  }

  return skillFiles
}

export const createSkillIndex = async (
  options: CreateSkillIndexOptions
): Promise<SkillIndex> => {
  const skills: SkillIndexEntry[] = []

  for (const directory of options.directories) {
    const resolvedDirectory = await resolveExistingPathInsideRoot(
      options.repositoryRoot,
      directory
    )
    const skillFiles = await findSkillFiles(resolvedDirectory)

    for (const skillFile of skillFiles) {
      const content = await readFile(skillFile, 'utf8')
      const metadata = parseSkillMetadata(content, skillFile)
      const skillDirectory = path.dirname(skillFile)
      const relativeSkillDirectoryFromConfiguredRoot = portableRelativePath(
        resolvedDirectory,
        skillDirectory
      )
      const relativeSkillDirectoryFromRepositoryRoot = normalizeRepositoryRelativePath(
        portableRelativePath(options.repositoryRoot, skillDirectory)
      )
      const relativeSkillFile = normalizeRepositoryRelativePath(
        path.posix.join(
          normalizeRepositoryRelativePath(directory),
          relativeSkillDirectoryFromConfiguredRoot === '.'
            ? ''
            : relativeSkillDirectoryFromConfiguredRoot,
          skillFileName
        )
      )

      if (skills.some((skill) => skill.id === metadata.name)) {
        throw new TypeError(`Duplicate skill name "${metadata.name}".`)
      }

      skills.push({
        id: metadata.name,
        path: relativeSkillFile,
        directory: relativeSkillDirectoryFromRepositoryRoot,
        absoluteDirectory: skillDirectory,
        contentHash: sha256(content),
        description: metadata.description
      })
    }
  }

  return {
    skills: skills.sort((left, right) => left.id.localeCompare(right.id))
  }
}
