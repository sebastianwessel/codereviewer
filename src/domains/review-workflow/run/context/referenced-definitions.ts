import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveExistingPathInsideRoot } from '../../../../platform/path-service.js'
import { utf8ByteLength } from '../../../../shared/text/utf8-bytes.js'
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
// section budget. When it binds, the digest is cut on a LINE boundary and the cut
// is disclosed in the digest itself (see `truncateDigestAtLineBoundary`).
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

export type ReferencedDefinitionResult = {
  readonly digests: readonly ReferencedDefinitionDigest[]
  // Resolvable dependencies the caps kept out. Returned rather than discarded: a
  // run that silently drops context is indistinguishable from one that had none to
  // add, which is the failure shape this project found three times in the intent
  // capability's limits on 2026-08-01 and had not looked for here.
  readonly droppedByFileCap: number
  readonly droppedByBudget: number
  // Dependencies that resolved and then failed to read (vanished between the
  // probe and the read, permissions, an I/O error). Counted apart from the two
  // cap counters because it is a different fact about the run: a cap that binds
  // is the design working, an unreadable dependency is the repository or the
  // filesystem surprising us, and only one of the two is answered by raising a
  // bound. `droppedByBudget` used to absorb these, which reported a read failure
  // as a budget cut.
  readonly droppedByReadFailure: number
}

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

/**
 * A run's memo for referenced-definition work that repeats across tasks.
 *
 * The collector runs once per task and every task re-resolves the same import
 * specifiers and re-digests the same shared dependencies: each probe costs two
 * `realpath` syscalls (`path-service.ts`) and each digest re-runs the whole
 * ast-grep extractor over the dependency file. Measured on this repository, 18
 * digests were built over 14 distinct paths in one run.
 *
 * Scoped to one `assembleContext` call rather than to the process, because it
 * caches filesystem state and file content: a memo that outlived the run would
 * answer for a repository that had since moved on.
 *
 * `has` rather than a truthiness test on `get` decides a hit, so "probed, and it
 * does not resolve" stays distinguishable from "not probed yet".
 */
export type ReferencedDefinitionCache = {
  // Repo-relative candidate path -> its absolute path, or undefined when the
  // path does not exist or resolves outside the root.
  readonly probedPaths: Map<string, string | undefined>
  // Repo-relative dependency path -> its bounded digest.
  readonly digests: Map<string, string>
}

export const createReferencedDefinitionCache = (): ReferencedDefinitionCache => ({
  probedPaths: new Map(),
  digests: new Map()
})

// Resolve one candidate repo-relative path to its absolute path, or undefined when
// it does not exist or escapes the root. `resolveExistingPathInsideRoot` throws for
// both, and both mean "not a valid dependency target".
const probeCandidatePath = async (
  repositoryRoot: string,
  candidate: string,
  cache: ReferencedDefinitionCache | undefined
): Promise<string | undefined> => {
  if (cache?.probedPaths.has(candidate) === true) {
    return cache.probedPaths.get(candidate)
  }

  let resolved: string | undefined

  try {
    resolved = await resolveExistingPathInsideRoot(repositoryRoot, candidate)
  } catch {
    resolved = undefined
  }

  cache?.probedPaths.set(candidate, resolved)

  return resolved
}

// Resolve a relative import to an existing repo file path, always going through
// resolveExistingPathInsideRoot for path-safety (never escapes the repo root).
// Returns the repo-relative path on success, undefined otherwise.
//
// Candidates are probed in declared order and the first hit wins, because the
// order encodes the resolution rules (literal specifier, then source extensions,
// then a directory index).
const resolveRelativeDependencyPath = async (
  input: {
    readonly repositoryRoot: string
    readonly fromPath: string
    readonly moduleSpecifier: string
    readonly cache?: ReferencedDefinitionCache | undefined
  }
): Promise<string | undefined> => {
  for (const candidate of relativeImportCandidates(
    input.fromPath,
    input.moduleSpecifier
  )) {
    const resolved = await probeCandidatePath(
      input.repositoryRoot,
      candidate,
      input.cache
    )

    if (resolved !== undefined) {
      return candidate
    }
  }

  return undefined
}

// Cut an over-budget digest at a line boundary and say so, instead of slicing it
// by bytes.
//
// The per-file cap binds on a format that means something. Between every pair of
// non-contiguous kept lines the digest pushes a literal '...', so within this
// format an end with no marker ASSERTS that nothing follows it. And
// `sliceUtf8Bytes` is code-point-aware but not line-aware, so a byte cut lands
// mid-line and shows the model a fragment — `47: const token = resolveSecret(user`
// — presented as real numbered source. Both are false statements about the
// dependency file, not merely incomplete ones, which is the same shape as a
// ranged read that contradicts its own summary.
//
// Modelled on the `repo_list` cap notice in `context-retrieval/index.ts`: the same
// kind of cut (a list of items ended early) gets the same kind of disclosure.
const truncateDigestAtLineBoundary = (
  digestLines: readonly string[]
): string => {
  const truncationNotice = (keptLineCount: number): string =>
    `[TRUNCATED: ${keptLineCount} of ${digestLines.length} digest lines shown, ` +
    `cut at the per-file byte budget. Absence of a declaration below this point ` +
    `is NOT evidence this file lacks it — read the file with the repository ` +
    `tools rather than concluding from this digest.]`

  // Reserved against the LONGEST notice this digest can produce: the kept count
  // never exceeds the total, so the total's own digit width bounds it. The extra
  // byte is the newline that joins the notice to the body.
  const bodyBudget =
    REFERENCED_DEFINITION_FILE_BYTE_BUDGET -
    utf8ByteLength(truncationNotice(digestLines.length)) -
    1
  const keptLines: string[] = []
  let usedBytes = 0

  for (const line of digestLines) {
    // Every line but the first also costs the newline that joins it.
    const lineBytes = utf8ByteLength(line) + (keptLines.length === 0 ? 0 : 1)

    if (usedBytes + lineBytes > bodyBudget) {
      break
    }

    keptLines.push(line)
    usedBytes += lineBytes
  }

  // A first line longer than the whole budget keeps nothing, and the disclosure
  // is still emitted rather than a fragment of it: "none of this file was shown"
  // is true, and the fragment would not be.
  return [...keptLines, truncationNotice(keptLines.length)].join('\n')
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

  const digest = digestLines.join('\n')

  // A digest that fits is returned unchanged, byte for byte.
  return utf8ByteLength(digest) <= REFERENCED_DEFINITION_FILE_BYTE_BUDGET
    ? digest
    : truncateDigestAtLineBoundary(digestLines)
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
  // Shared across the tasks of one run. Omitted, every task resolves and digests
  // from scratch, which is the correct behaviour for a one-shot caller.
  readonly cache?: ReferencedDefinitionCache | undefined
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
): Promise<ReferencedDefinitionResult> => {
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
      moduleSpecifier: fact.moduleSpecifier,
      ...(input.cache === undefined ? {} : { cache: input.cache })
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

    // How many resolvable dependencies the caps kept out. Reported rather than
  // discarded: a run that silently drops context looks identical to one that had
  // none to add, and this project has now found that same shape three times in the
  // intent capability's limits.
  //
  // It binds routinely. Measured over the corpus every A/B has used: HALF of the
  // TypeScript/JavaScript changed files import more than three local dependencies,
  // which is all the 12KB total budget can hold at the 4KB per-file cap, and 40%
  // exceed the six-file cap as well.
  const rankedPathsAll = [...referenceCounts.entries()]
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1]
      }
      return left[0].localeCompare(right[0])
    })
    .map(([dependencyPath]) => dependencyPath)
  const rankedPaths = rankedPathsAll.slice(0, MAX_REFERENCED_DEFINITION_FILES)
  const droppedByFileCap = rankedPathsAll.length - rankedPaths.length

  const digests: ReferencedDefinitionDigest[] = []
  let usedBytes = 0
  let droppedByBudget = 0
  let droppedByReadFailure = 0

  for (const [rankedIndex, dependencyPath] of rankedPaths.entries()) {
    // The digest is a pure function of the dependency file, so a dependency two
    // tasks share is read once and extracted once. A read that FAILS is not
    // cached: the next task retries it rather than inheriting a verdict this one
    // reached about a transient failure.
    let digest = input.cache?.digests.get(dependencyPath)

    if (digest === undefined) {
      let content: string

      try {
        const absolutePath = await resolveExistingPathInsideRoot(
          input.repositoryRoot,
          dependencyPath
        )
        content = await readDependencyFile(absolutePath)
      } catch {
        // Best-effort: a file that vanished or failed to read is skipped — but
        // under its OWN cause, so the budget counter is not asked to explain it.
        droppedByReadFailure += 1
        continue
      }

      digest = buildDefinitionDigest(dependencyPath, content)
      input.cache?.digests.set(dependencyPath, digest)
    }

    const digestBytes = utf8ByteLength(digest)

    if (digestBytes === 0) {
      // The extractor found nothing to show for this dependency. Deliberately
      // uncounted: the counters report context this run HAD and did not send, and
      // there was none here — a file with no extractable definitions is nothing to
      // add, not something dropped.
      continue
    }

    if (usedBytes + digestBytes > REFERENCED_DEFINITIONS_TOTAL_BYTE_BUDGET) {
      // Section byte budget exhausted: skip this dependency and every
      // lower-ranked one after it, and count them so the omission is reportable.
      //
      // Counted from the RANK POSITION, not from `digests.length`. The two differ
      // by every file skipped earlier in this loop for a reason that is not the
      // budget — a failed read, or a digest with no content — and deriving the
      // count from `digests.length` handed those to the budget counter, which is
      // the one counter that exists to say the caps are too tight.
      droppedByBudget = rankedPaths.length - rankedIndex
      break
    }

    digests.push({ path: dependencyPath, content: digest })
    usedBytes += digestBytes
  }

  return { digests, droppedByFileCap, droppedByBudget, droppedByReadFailure }
}

export const referencedDefinitionBounds = {
  maxFiles: MAX_REFERENCED_DEFINITION_FILES,
  totalByteBudget: REFERENCED_DEFINITIONS_TOTAL_BYTE_BUDGET,
  perFileByteBudget: REFERENCED_DEFINITION_FILE_BYTE_BUDGET
} as const
