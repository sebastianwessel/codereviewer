import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  resolveExistingPathInsideRoot,
  toPortableRelativePath
} from '../../platform/path-service.js'
import { normalizeRepositoryRelativePath } from '../../platform/repository-path.js'
import { sha256 } from '../../shared/hash/hash.js'

type SkillIndexEntry = {
  readonly id: string
  readonly path: string
  readonly directory: string
  readonly absoluteDirectory: string
  readonly contentHash: string
  readonly description: string
}

type SkillIndex = {
  readonly skills: readonly SkillIndexEntry[]
}

type CreateSkillIndexOptions = {
  readonly repositoryRoot: string
  readonly directories: readonly string[]
}

const skillFileName = 'SKILL.md'
const skillNamePattern = /^(?!-)(?!.*--)[a-z0-9-]{1,64}(?<!-)$/u

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
      // BOTH REPOSITORY-RELATIVE STRINGS ARE DERIVED FROM THE SKILL FILE, NEVER
      // FROM ITS DIRECTORY, and that is the fix rather than a stylistic choice.
      //
      // `toPortableRelativePath` composes `path.relative` — which answers `''`
      // for two equal paths — with `normalizeFileSystemPath`, whose emptiness
      // check rejects `''`. So asking it for the path from a configured skills
      // directory to a skill's directory threw `TypeError: Path value must not
      // be empty.` for the one layout where those are the SAME directory: a
      // `SKILL.md` placed directly in a configured skills directory, which spec
      // 04 (*Skills*) states is a legal skill. The same throw hit
      // `directories: ["."]` with a `SKILL.md` at the repository root, where the
      // skill's directory equals the repository root. A `'.'` branch used to
      // stand below to absorb exactly this case; it could never run, because the
      // expression producing its input threw first.
      //
      // A skill FILE is never equal to a directory containing it, so the empty
      // relative path is now unreachable by construction rather than
      // special-cased — and the directory is recovered from the file's relative
      // path, where `path.posix.dirname` already spells the repository root as
      // the conventional `.`.
      //
      // The shared helper is deliberately NOT taught to answer `.` for equal
      // paths. `eval-slice-manifest.ts` folds its result into the sha256 slice
      // digest that decides whether two eval runs may be pooled; widening that
      // contract to serve this caller would put a published digest at risk for
      // no gain here. (Equal paths cannot occur there — it only ever asks for
      // the path from the slice root to a FILE beneath it — but "cannot occur
      // today" is not a reason to move a hashed helper's boundary.)
      //
      // Joining the configured `directory` back on is likewise gone: it
      // recomputed, from a second base, a path the repository-relative form
      // already states, and that redundancy is where the unreachable branch grew.
      const relativeSkillFile = normalizeRepositoryRelativePath(
        toPortableRelativePath(options.repositoryRoot, skillFile)
      )
      const relativeSkillDirectoryFromRepositoryRoot = normalizeRepositoryRelativePath(
        path.posix.dirname(relativeSkillFile)
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
