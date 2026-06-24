import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveExistingPathInsideRoot } from '../../../../platform/path-service.js'
import {
  extractDeterministicSignals,
  type DeterministicSignalExtraction,
  type SupportSignalFact
} from '../../../deterministic-signals/index.js'

// R4 — referenced-definition context bounds (token-conscious).
//
// Holistic discovery only sees the CHANGED files + diff. Bugs that hinge on the
// contract of a callee declared in an UNCHANGED file are invisible. To close that
// gap we inject a bounded digest of each directly-imported, unchanged dependency
// file as CONTEXT ONLY (never a review target). The caps keep the extra prompt
// payload small and predictable.

// Max distinct unchanged dependency files injected per task. Picked by import
// frequency (most-referenced first) so the highest-signal callees win the budget.
const MAX_REFERENCED_DEFINITION_FILES = 6

// Total UTF-8 byte budget for one task's referenced-definitions section. ~12KB
// keeps the section a small fraction of a typical changed-file packet. Once the
// budget is exhausted, remaining dependency files are skipped.
const REFERENCED_DEFINITIONS_TOTAL_BYTE_BUDGET = 12 * 1024

// Per-file digest cap so a single large dependency cannot consume the whole
// section budget.
const REFERENCED_DEFINITION_FILE_BYTE_BUDGET = 4 * 1024

// Filesystem-aware resolution candidates for a relative import specifier without
// an explicit extension (matches the planner's TS/JS-first ordering and adds
// `/index.*` for directory imports).
const RELATIVE_IMPORT_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mts',
  '.cts'
] as const

export type ReferencedDefinitionDigest = {
  readonly path: string
  readonly content: string
}

const bytesOf = (value: string): number => Buffer.byteLength(value)

const sliceUtf8 = (value: string, maxBytes: number): string =>
  Buffer.from(value).subarray(0, Math.max(0, maxBytes)).toString('utf8')

const isRelativeSpecifier = (moduleSpecifier: string): boolean =>
  moduleSpecifier.startsWith('./') || moduleSpecifier.startsWith('../')

// Candidate repo-relative paths for a relative import target, trying the literal
// specifier first, then each extension, then `/index.*` for directory imports.
const relativeImportCandidates = (
  fromPath: string,
  moduleSpecifier: string
): readonly string[] => {
  const baseDirectory = path.posix.dirname(fromPath)
  const target = path.posix.normalize(
    path.posix.join(baseDirectory, moduleSpecifier)
  )
  const extension = path.posix.extname(target)
  const candidates: string[] = []

  if (extension.length > 0) {
    // Literal specifier (e.g. './dep.ts').
    candidates.push(target)

    // TS ESM imports reference the emitted '.js' path while the source is '.ts'.
    // Try the same base name with each source extension so '.js'/'.mjs'/'.cjs'
    // specifiers resolve to their '.ts'/'.tsx'/... source files.
    const withoutExtension = target.slice(0, -extension.length)
    for (const sourceExtension of RELATIVE_IMPORT_EXTENSIONS) {
      candidates.push(`${withoutExtension}${sourceExtension}`)
    }
  }

  // Extensionless specifier (or directory import): try each extension, then the
  // directory's index file.
  for (const sourceExtension of RELATIVE_IMPORT_EXTENSIONS) {
    candidates.push(`${target}${sourceExtension}`)
    candidates.push(`${target}/index${sourceExtension}`)
  }

  return candidates
}

// Resolve a relative import to an existing repo file path, always going through
// resolveExistingPathInsideRoot for path-safety (never escapes the repo root).
// Returns the repo-relative path on success, undefined otherwise.
const resolveRelativeDependencyPath = async (
  input: {
    readonly repositoryRoot: string
    readonly fromPath: string
    readonly moduleSpecifier: string
  }
): Promise<string | undefined> => {
  for (const candidate of relativeImportCandidates(
    input.fromPath,
    input.moduleSpecifier
  )) {
    try {
      // resolveExistingPathInsideRoot throws when the path escapes the root or
      // does not exist; both mean "not a valid dependency target".
      await resolveExistingPathInsideRoot(input.repositoryRoot, candidate)
      return candidate
    } catch {
      // Try the next candidate; unresolvable imports are expected and skipped.
    }
  }

  return undefined
}

// Build a bounded digest for one unchanged dependency file: prefer its exported/
// public declaration lines (re-run the deterministic extractor on the file and
// keep a small window around each export/public-symbol/declaration line). Falls
// back to a head slice when no facts are available (non-TS/JS or extraction
// failure). Always line-numbered and capped to the per-file byte budget.
const buildDefinitionDigest = (
  dependencyPath: string,
  content: string
): string => {
  const lines = content.split('\n')
  const numbered = (index: number): string => `${index + 1}: ${lines[index]}`

  let facts: readonly SupportSignalFact[] = []

  try {
    const extraction: DeterministicSignalExtraction = extractDeterministicSignals(
      [{ path: dependencyPath, content }]
    )
    facts = extraction.facts
  } catch {
    facts = []
  }

  const relevantKinds = new Set<SupportSignalFact['kind']>([
    'export',
    'public-symbol',
    'declaration'
  ])
  const anchorLines = [
    ...new Set(
      facts
        .filter((fact) => relevantKinds.has(fact.kind))
        .map((fact) => fact.line)
        .filter((line) => line >= 1 && line <= lines.length)
    )
  ].sort((left, right) => left - right)

  const selected = new Set<number>()

  if (anchorLines.length > 0) {
    // Keep a 1-line window around each declaration anchor so the model sees the
    // signature plus minimal surrounding context.
    for (const anchor of anchorLines) {
      for (let offset = -1; offset <= 1; offset += 1) {
        const index = anchor - 1 + offset
        if (index >= 0 && index < lines.length) {
          selected.add(index)
        }
      }
    }
  } else {
    // No structural facts (e.g. unsupported language or empty file): fall back to
    // a head window so the digest still carries some contract context.
    for (let index = 0; index < Math.min(lines.length, 40); index += 1) {
      selected.add(index)
    }
  }

  const orderedIndexes = [...selected].sort((left, right) => left - right)
  const digestLines: string[] = []
  let previousIndex: number | undefined

  for (const index of orderedIndexes) {
    if (previousIndex !== undefined && index > previousIndex + 1) {
      digestLines.push('...')
    }
    digestLines.push(numbered(index))
    previousIndex = index
  }

  return sliceUtf8(
    digestLines.join('\n'),
    REFERENCED_DEFINITION_FILE_BYTE_BUDGET
  )
}

export type CollectReferencedDefinitionsInput = {
  readonly repositoryRoot: string
  readonly taskPaths: readonly string[]
  readonly facts: readonly SupportSignalFact[]
  // Repo-relative paths already in some task / reviewContext: these are changed
  // files and must never be injected as referenced definitions (they are reviewed
  // directly).
  readonly knownPaths: ReadonlySet<string>
  readonly readDependencyFile?: (absolutePath: string) => Promise<string>
}

// Collect bounded referenced-definition digests for a task: resolve each changed
// file's RELATIVE imports to existing unchanged repo files, rank by import
// frequency, and read + digest the top-N within the section byte budget.
//
// These are CONTEXT ONLY — they are intentionally outside task.paths and must not
// be added to it. Package/bare imports and anything resolving outside the root or
// to a changed/known file are skipped.
export const collectReferencedDefinitions = async (
  input: CollectReferencedDefinitionsInput
): Promise<readonly ReferencedDefinitionDigest[]> => {
  const taskPathSet = new Set(input.taskPaths)
  const readDependencyFile =
    input.readDependencyFile ??
    (async (absolutePath: string): Promise<string> =>
      readFile(absolutePath, 'utf8'))

  // Count import references per resolved unchanged dependency path so the most
  // frequently imported callees win the bounded budget.
  const referenceCounts = new Map<string, number>()

  for (const fact of input.facts) {
    if (
      fact.kind !== 'import' ||
      fact.moduleSpecifier === undefined ||
      !taskPathSet.has(fact.path) ||
      !isRelativeSpecifier(fact.moduleSpecifier)
    ) {
      continue
    }

    const resolved = await resolveRelativeDependencyPath({
      repositoryRoot: input.repositoryRoot,
      fromPath: fact.path,
      moduleSpecifier: fact.moduleSpecifier
    })

    if (
      resolved === undefined ||
      taskPathSet.has(resolved) ||
      input.knownPaths.has(resolved)
    ) {
      // Skip unresolvable, changed, or already-known files.
      continue
    }

    referenceCounts.set(resolved, (referenceCounts.get(resolved) ?? 0) + 1)
  }

  const rankedPaths = [...referenceCounts.entries()]
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1]
      }
      return left[0].localeCompare(right[0])
    })
    .map(([dependencyPath]) => dependencyPath)
    .slice(0, MAX_REFERENCED_DEFINITION_FILES)

  const digests: ReferencedDefinitionDigest[] = []
  let usedBytes = 0

  for (const dependencyPath of rankedPaths) {
    let content: string

    try {
      const absolutePath = await resolveExistingPathInsideRoot(
        input.repositoryRoot,
        dependencyPath
      )
      content = await readDependencyFile(absolutePath)
    } catch {
      // Best-effort: a file that vanished or failed to read is simply skipped.
      continue
    }

    const digest = buildDefinitionDigest(dependencyPath, content)
    const digestBytes = bytesOf(digest)

    if (digestBytes === 0) {
      continue
    }

    if (usedBytes + digestBytes > REFERENCED_DEFINITIONS_TOTAL_BYTE_BUDGET) {
      // Section byte budget exhausted: skip remaining (lower-ranked) deps.
      break
    }

    digests.push({ path: dependencyPath, content: digest })
    usedBytes += digestBytes
  }

  return digests
}

export const referencedDefinitionBounds = {
  maxFiles: MAX_REFERENCED_DEFINITION_FILES,
  totalByteBudget: REFERENCED_DEFINITIONS_TOTAL_BYTE_BUDGET,
  perFileByteBudget: REFERENCED_DEFINITION_FILE_BYTE_BUDGET
} as const
