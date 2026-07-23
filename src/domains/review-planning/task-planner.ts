import path from 'node:path'
import { z } from 'zod'
import {
  RepositoryRelativePathSchema,
  ContractIdSchema,
  ContextLedgerIdSchema,
  TaskIdSchema,
  type CodeReviewerConfig,
  type EvidenceRecord
} from '../../shared/contracts/index.js'
import { sha256 } from '../../shared/hash/hash.js'
import { uniqueSorted } from '../../shared/text/unique-sorted.js'
import type { CandidateFinding } from '../admission/index.js'
import type { SupportSignalFact } from '../deterministic-signals/index.js'

export const ReviewTaskKindSchema = z.enum([
  'file',
  'dependency-cluster'
])

export const ReviewTaskSchema = z.strictObject({
  id: TaskIdSchema,
  round: z.int().min(1),
  kind: ReviewTaskKindSchema,
  paths: z.array(RepositoryRelativePathSchema).min(1),
  factIds: z.array(z.string()).default([]),
  evidenceIds: z.array(z.string()).default([]),
  candidateIds: z.array(z.string()).default([]),
  contextEntryIds: z.array(ContextLedgerIdSchema).default([]),
  intentId: ContractIdSchema.optional(),
  objective: z.string().min(1).max(1200).optional(),
  focusAreas: z.array(z.string().min(1).max(160)).max(8).optional(),
  riskAreas: z.array(z.string().min(1).max(160)).max(8).optional(),
  verificationQuestions: z.array(z.string().min(1).max(240)).max(8).optional(),
  priority: z.int().min(0)
})

export type ReviewTask = z.infer<typeof ReviewTaskSchema>

export type PlanReviewTasksOptions = {
  readonly depth: CodeReviewerConfig['review']['depth']
  readonly files: readonly { readonly path: string }[]
  readonly facts: readonly SupportSignalFact[]
  readonly evidence: readonly EvidenceRecord[]
  readonly candidates: readonly CandidateFinding[]
}

const taskIdFor = (
  kind: z.infer<typeof ReviewTaskKindSchema>,
  paths: readonly string[]
): string => `task_${sha256(`${kind}:${paths.join('|')}`).slice(0, 16)}`

const evidencePath = (evidence: EvidenceRecord): string | undefined =>
  evidence.location?.path

const candidatePath = (candidate: CandidateFinding): string =>
  candidate.location.path

const extensionCandidates = (target: string): readonly string[] => {
  const extension = path.posix.extname(target)
  const targetWithoutExtension =
    extension.length === 0 ? target : target.slice(0, -extension.length)

  if (extension.length > 0) {
    return [
      target,
      ...extensionCandidates(targetWithoutExtension).filter(
        (candidate) => candidate !== target
      )
    ]
  }

  return [
    `${target}.ts`,
    `${target}.tsx`,
    `${target}.js`,
    `${target}.jsx`,
    `${target}.mts`,
    `${target}.mjs`,
    `${target}.cts`,
    `${target}.cjs`,
    `${target}.py`,
    `${target}.rb`,
    `${target}.go`,
    `${target}.rs`,
    `${target}.java`
  ]
}

const resolveRelativeImport = (
  fromPath: string,
  moduleSpecifier: string,
  knownPaths: ReadonlySet<string>
): string | undefined => {
  if (!moduleSpecifier.startsWith('.')) {
    return undefined
  }

  const baseDirectory = path.posix.dirname(fromPath)
  const normalizedTarget = path.posix.normalize(
    path.posix.join(baseDirectory, moduleSpecifier)
  )

  return extensionCandidates(normalizedTarget).find((candidate) =>
    knownPaths.has(candidate)
  )
}

// Convert a non-relative import specifier into a repo-relative path suffix so
// Python dotted (`a.b.c`), Java package (`com.foo.Bar`), and Ruby/Go slashed
// (`foo/bar`) imports can cluster related changed files the way relative TS/JS
// imports already do. Only multi-segment specifiers are resolved; bare
// single-segment modules (e.g. `os`, `json`) are skipped to avoid false matches.
const moduleSpecifierPathSuffix = (
  moduleSpecifier: string
): string | undefined => {
  const trimmed = moduleSpecifier.trim()

  if (trimmed === '' || trimmed.startsWith('.')) {
    return undefined
  }

  const slashed = (trimmed.includes('/') ? trimmed : trimmed.replace(/\./gu, '/'))
    .replace(/^\/+|\/+$/gu, '')

  return slashed.includes('/') ? slashed : undefined
}

const resolveModuleImportBySuffix = (
  moduleSpecifier: string,
  knownPaths: ReadonlySet<string>
): string | undefined => {
  const suffix = moduleSpecifierPathSuffix(moduleSpecifier)

  if (suffix === undefined) {
    return undefined
  }

  for (const candidate of extensionCandidates(suffix)) {
    const match = [...knownPaths].find(
      (known) => known === candidate || known.endsWith(`/${candidate}`)
    )

    if (match !== undefined) {
      return match
    }
  }

  return undefined
}

const connectedPathGroups = (
  paths: readonly string[],
  facts: readonly SupportSignalFact[]
): readonly (readonly string[])[] => {
  const knownPaths = new Set(paths)
  const edges = new Map<string, Set<string>>()

  for (const pathValue of paths) {
    edges.set(pathValue, new Set())
  }

  for (const fact of facts) {
    if (fact.kind !== 'import' || fact.moduleSpecifier === undefined) {
      continue
    }

    const target =
      resolveRelativeImport(fact.path, fact.moduleSpecifier, knownPaths) ??
      resolveModuleImportBySuffix(fact.moduleSpecifier, knownPaths)

    if (target === undefined || target === fact.path || !knownPaths.has(fact.path)) {
      continue
    }

    edges.get(fact.path)?.add(target)
    edges.get(target)?.add(fact.path)
  }

  const visited = new Set<string>()
  const groups: string[][] = []

  for (const pathValue of paths) {
    if (visited.has(pathValue)) {
      continue
    }

    const group: string[] = []
    const stack = [pathValue]

    visited.add(pathValue)

    while (stack.length > 0) {
      const current = stack.pop()!
      group.push(current)

      for (const next of edges.get(current) ?? []) {
        if (!visited.has(next)) {
          visited.add(next)
          stack.push(next)
        }
      }
    }

    groups.push([...group].sort((left, right) => left.localeCompare(right)))
  }

  return groups.sort((left, right) => left[0]!.localeCompare(right[0]!))
}

const maxPathsPerCluster = 8

const splitGroupIntoBoundedChunks = (
  group: readonly string[]
): readonly (readonly string[])[] => {
  const chunks: string[][] = []

  for (let index = 0; index < group.length; index += maxPathsPerCluster) {
    chunks.push(group.slice(index, index + maxPathsPerCluster))
  }

  return chunks
}

const packPathGroups = (
  groups: readonly (readonly string[])[]
): readonly (readonly string[])[] => {
  const packedGroups: string[][] = []
  let pendingSingletons: string[] = []

  const flushSingletons = (): void => {
    while (pendingSingletons.length > 0) {
      packedGroups.push(pendingSingletons.slice(0, maxPathsPerCluster))
      pendingSingletons = pendingSingletons.slice(maxPathsPerCluster)
    }
  }

  for (const group of groups) {
    if (group.length === 1) {
      pendingSingletons.push(group[0]!)
      continue
    }

    flushSingletons()
    for (const chunk of splitGroupIntoBoundedChunks(group)) {
      packedGroups.push([...chunk])
    }
  }

  flushSingletons()

  return packedGroups
}

const createTask = (
  input: {
    readonly kind: z.infer<typeof ReviewTaskKindSchema>
    readonly paths: readonly string[]
    readonly round: number
    readonly priority: number
    readonly facts: readonly SupportSignalFact[]
    readonly evidence: readonly EvidenceRecord[]
    readonly candidates: readonly CandidateFinding[]
  }
): ReviewTask => {
  const taskPaths = uniqueSorted(input.paths)

  return ReviewTaskSchema.parse({
    id: taskIdFor(input.kind, taskPaths),
    round: input.round,
    kind: input.kind,
    paths: taskPaths,
    factIds: input.facts
      .filter((fact) => taskPaths.includes(fact.path))
      .map((fact) => fact.id),
    evidenceIds: input.evidence
      .filter((record) => taskPaths.includes(evidencePath(record) ?? ''))
      .map((record) => record.id),
    candidateIds: input.candidates
      .filter((candidate) => taskPaths.includes(candidatePath(candidate)))
      .map((candidate) => candidate.id),
    contextEntryIds: [],
    priority: input.priority
  })
}

export const planReviewTasks = (
  options: PlanReviewTasksOptions
): readonly ReviewTask[] => {
  const paths = uniqueSorted(options.files.map((file) => file.path))

  if (paths.length === 0) {
    return []
  }

  if (options.depth === 'fast') {
    return paths.map((pathValue, index) =>
      createTask({
        kind: 'file',
        paths: [pathValue],
        round: 1,
        priority: index,
        facts: options.facts,
        evidence: options.evidence,
        candidates: options.candidates
      })
    )
  }

  const clusterTasks = packPathGroups(
    connectedPathGroups(paths, options.facts)
  ).map(
    (group, index) =>
      createTask({
        kind: 'dependency-cluster',
        paths: group,
        round: 1,
        priority: index,
        facts: options.facts,
        evidence: options.evidence,
        candidates: options.candidates
      })
  )

  return clusterTasks
}
