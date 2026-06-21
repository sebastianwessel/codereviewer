import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { resolveExistingPathInsideRoot } from '../../platform/path-service.js'
import {
  EvalSourceProfileSchema,
  EvalSliceCaseSchema
} from './eval-fixture.schema.js'

const sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/u)

export const EvalSliceManifestCaseSchema = z.strictObject({
  id: z.string().min(1),
  language: z.string().min(1),
  sourceProfile: EvalSourceProfileSchema,
  tags: z.array(z.string().min(1)),
  changedFileCount: z.int().min(0),
  expectedFindingCount: z.int().min(0),
  semanticOnlyExpectedCount: z.int().min(0),
  lineBearingExpectedCount: z.int().min(0),
  noFindingZoneCount: z.int().min(0),
  repositoryFileCount: z.int().min(0),
  repositoryBytes: z.int().min(0),
  sliceJsonSha256: sha256HexSchema,
  repositoryTreeSha256: sha256HexSchema
})

export const EvalSliceManifestSchema = z.strictObject({
  schemaVersion: z.literal('1.0'),
  generatedAt: z.iso.datetime(),
  sliceRoot: z.string().min(1),
  caseCount: z.int().min(0),
  caseIds: z.array(z.string().min(1)),
  digest: sha256HexSchema,
  cases: z.array(EvalSliceManifestCaseSchema)
})

export type EvalSliceManifestCase = z.infer<typeof EvalSliceManifestCaseSchema>
export type EvalSliceManifest = z.infer<typeof EvalSliceManifestSchema>

type StableJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly StableJsonValue[]
  | { readonly [key: string]: StableJsonValue }

type RepositoryFileIdentity = {
  readonly relativePath: string
  readonly sizeBytes: number
  readonly sha256: string
}

type EvalSliceManifestDigestPayload = {
  readonly [key: string]: StableJsonValue
  readonly schemaVersion: '1.0'
  readonly sliceRoot: string
  readonly caseCount: number
  readonly caseIds: readonly string[]
  readonly cases: readonly StableJsonValue[]
}

const hashBytes = (bytes: Buffer | string): string =>
  createHash('sha256').update(bytes).digest('hex')

const toPortableRelativePath = (rootPath: string, filePath: string): string =>
  path.relative(rootPath, filePath).split(path.sep).join(path.posix.sep)

const isStableJsonObject = (
  value: StableJsonValue
): value is { readonly [key: string]: StableJsonValue } =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const stableStringify = (value: StableJsonValue): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }

  if (isStableJsonObject(value)) {
    return `{${Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key] ?? null)}`)
      .join(',')}}`
  }

  return JSON.stringify(value)
}

const collectRepositoryFiles = async (
  repositoryRoot: string,
  currentPath: string = repositoryRoot
): Promise<readonly RepositoryFileIdentity[]> => {
  const entries = await readdir(currentPath, { withFileTypes: true })
  const fileGroups = await Promise.all(
    entries
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(async (entry): Promise<readonly RepositoryFileIdentity[]> => {
        if (entry.isSymbolicLink()) {
          throw new TypeError('Slice repository must not contain symbolic links.')
        }

        const entryPath = path.join(currentPath, entry.name)

        if (entry.isDirectory()) {
          return collectRepositoryFiles(repositoryRoot, entryPath)
        }

        if (!entry.isFile()) {
          return []
        }

        const [entryStat, content] = await Promise.all([
          stat(entryPath),
          readFile(entryPath)
        ])

        return [
          {
            relativePath: toPortableRelativePath(repositoryRoot, entryPath),
            sizeBytes: entryStat.size,
            sha256: hashBytes(content)
          }
        ]
      })
  )

  return fileGroups.flat().sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath)
  )
}

const repositoryTreeDigest = (
  files: readonly RepositoryFileIdentity[]
): string =>
  hashBytes(
    stableStringify(
      files.map((file) => ({
        path: file.relativePath,
        sha256: file.sha256,
        sizeBytes: file.sizeBytes
      }))
    )
  )

const createDigestPayload = (
  input: {
    readonly sliceRoot: string
    readonly cases: readonly EvalSliceManifestCase[]
  }
): EvalSliceManifestDigestPayload => ({
  schemaVersion: '1.0',
  sliceRoot: input.sliceRoot,
  caseCount: input.cases.length,
  caseIds: input.cases.map((manifestCase) => manifestCase.id),
  cases: input.cases.map((manifestCase) => ({
    id: manifestCase.id,
    language: manifestCase.language,
    sourceProfile: manifestCase.sourceProfile,
    tags: manifestCase.tags,
    changedFileCount: manifestCase.changedFileCount,
    expectedFindingCount: manifestCase.expectedFindingCount,
    semanticOnlyExpectedCount: manifestCase.semanticOnlyExpectedCount,
    lineBearingExpectedCount: manifestCase.lineBearingExpectedCount,
    noFindingZoneCount: manifestCase.noFindingZoneCount,
    repositoryFileCount: manifestCase.repositoryFileCount,
    repositoryBytes: manifestCase.repositoryBytes,
    sliceJsonSha256: manifestCase.sliceJsonSha256,
    repositoryTreeSha256: manifestCase.repositoryTreeSha256
  }))
})

const createManifestCase = async (
  input: {
    readonly repositoryRoot: string
    readonly sliceRoot: string
    readonly entryName: string
  }
): Promise<EvalSliceManifestCase> => {
  const sliceJsonPath = path.posix.join(input.sliceRoot, input.entryName, 'slice.json')
  const repositoryFixturePath = path.posix.join(input.sliceRoot, input.entryName, 'repo')
  const [sliceJsonFile, repositoryFixtureRoot] = await Promise.all([
    resolveExistingPathInsideRoot(input.repositoryRoot, sliceJsonPath),
    resolveExistingPathInsideRoot(input.repositoryRoot, repositoryFixturePath)
  ])
  const sliceJson = await readFile(sliceJsonFile)
  const slice = EvalSliceCaseSchema.parse(JSON.parse(sliceJson.toString('utf8')))
  const repositoryFiles = await collectRepositoryFiles(repositoryFixtureRoot)
  const repositoryBytes = repositoryFiles.reduce(
    (total, file) => total + file.sizeBytes,
    0
  )
  const semanticOnlyExpectedCount = slice.expectedFindings.filter(
    (expectedFinding) =>
      (expectedFinding.matchMode ??
        (expectedFinding.path === undefined
          ? 'semantic-only'
          : expectedFinding.lineRange === undefined
            ? 'path-semantic'
            : 'path-line')) === 'semantic-only'
  ).length
  const lineBearingExpectedCount = slice.expectedFindings.filter(
    (expectedFinding) =>
      expectedFinding.path !== undefined && expectedFinding.lineRange !== undefined
  ).length

  return EvalSliceManifestCaseSchema.parse({
    id: slice.id,
    language: slice.language,
    sourceProfile: slice.sourceProfile,
    tags: [...slice.tags],
    changedFileCount: slice.changedFiles.length,
    expectedFindingCount: slice.expectedFindings.length,
    semanticOnlyExpectedCount,
    lineBearingExpectedCount,
    noFindingZoneCount: slice.expectedNoFindingZones.length,
    repositoryFileCount: repositoryFiles.length,
    repositoryBytes,
    sliceJsonSha256: hashBytes(sliceJson),
    repositoryTreeSha256: repositoryTreeDigest(repositoryFiles)
  })
}

export const createEvalSliceManifest = async (
  input: {
    readonly repositoryRoot: string
    readonly sliceRoot: string
    readonly generatedAt?: string
  }
): Promise<EvalSliceManifest> => {
  const resolvedSliceRoot = await resolveExistingPathInsideRoot(
    input.repositoryRoot,
    input.sliceRoot
  )
  const entries = await readdir(resolvedSliceRoot, { withFileTypes: true })
  const cases = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) =>
        createManifestCase({
          repositoryRoot: input.repositoryRoot,
          sliceRoot: input.sliceRoot,
          entryName: entry.name
        })
      )
  )
  const seenIds = new Set<string>()

  for (const manifestCase of cases) {
    if (seenIds.has(manifestCase.id)) {
      throw new Error(`Duplicate eval case id "${manifestCase.id}".`)
    }

    seenIds.add(manifestCase.id)
  }

  const digestPayload = createDigestPayload({
    sliceRoot: input.sliceRoot,
    cases
  })

  return EvalSliceManifestSchema.parse({
    ...digestPayload,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    digest: hashBytes(stableStringify(digestPayload))
  })
}
