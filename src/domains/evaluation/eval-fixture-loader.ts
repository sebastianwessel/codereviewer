import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { resolveExistingPathInsideRoot } from '../../platform/path-service.js'
import {
  EvalSliceCaseSchema,
  parseEvalCasesJson,
  type EvalCase
} from './eval-fixture.schema.js'

const defaultFixtureRootPath = path.posix.join('eval', 'fixtures')
const defaultCaseSetPath = path.posix.join(
  'eval',
  'fixtures',
  'sample-eval-cases.json'
)
const sliceRootPath = path.posix.join('eval', 'fixtures', 'slices')

const isMissingPathError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === 'ENOENT'

const readSampleCases = async (
  repositoryRoot: string
): Promise<readonly EvalCase[]> =>
  parseEvalCasesJson(
    await readFile(
      await resolveExistingPathInsideRoot(repositoryRoot, defaultCaseSetPath),
      'utf8'
    )
  )

const repositoryFixtureForSlice = (
  sliceRoot: string,
  entryName: string
): string => path.posix.join(sliceRoot, entryName, 'repo')

export const loadEvalSliceCasesFromRoot = async (
  repositoryRoot: string,
  sliceRoot: string
): Promise<readonly EvalCase[]> => {
  let resolvedSliceRoot: string

  try {
    resolvedSliceRoot = await resolveExistingPathInsideRoot(
      repositoryRoot,
      sliceRoot
    )
  } catch (error) {
    if (isMissingPathError(error)) {
      return []
    }

    throw error
  }

  const entries = await readdir(resolvedSliceRoot, { withFileTypes: true })
  const cases = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(async (entry): Promise<EvalCase> => {
        const sliceFile = await resolveExistingPathInsideRoot(
          repositoryRoot,
          path.posix.join(sliceRoot, entry.name, 'slice.json')
        )
        const slice = EvalSliceCaseSchema.parse(
          JSON.parse(await readFile(sliceFile, 'utf8'))
        )

        return {
          id: slice.id,
          language: slice.language,
          repositoryFixture: repositoryFixtureForSlice(sliceRoot, entry.name),
          ...(slice.baseRef === undefined ? {} : { baseRef: slice.baseRef }),
          ...(slice.headRef === undefined ? {} : { headRef: slice.headRef }),
          changedFiles: [...slice.changedFiles],
          expectedFindings: [...slice.expectedFindings],
          expectedNoFindingZones: [...slice.expectedNoFindingZones],
          tags: [...new Set(['slice', ...slice.tags])],
          sourceProfile: slice.sourceProfile,
          ...(slice.diff === undefined ? {} : { diff: slice.diff })
        }
      })
  )

  return cases
}

const readDefaultSliceCases = (
  repositoryRoot: string
): Promise<readonly EvalCase[]> =>
  loadEvalSliceCasesFromRoot(repositoryRoot, sliceRootPath)

const normalizeDefaultCaseFixture = (evalCase: EvalCase): EvalCase => ({
  ...evalCase,
  repositoryFixture: path.posix.join(
    path.posix.dirname(defaultFixtureRootPath),
    evalCase.repositoryFixture
  )
})

export const loadEvalCasesFromFixtures = async (
  repositoryRoot: string,
  options: {
    readonly sliceRoot?: string
  } = {}
): Promise<readonly EvalCase[]> => {
  const cases =
    options.sliceRoot === undefined
      ? [
          ...(await readSampleCases(repositoryRoot)).map(normalizeDefaultCaseFixture),
          ...(await readDefaultSliceCases(repositoryRoot))
        ]
      : [...(await loadEvalSliceCasesFromRoot(repositoryRoot, options.sliceRoot))]
  const seenIds = new Set<string>()

  for (const evalCase of cases) {
    if (seenIds.has(evalCase.id)) {
      throw new Error(`Duplicate eval case id "${evalCase.id}".`)
    }

    seenIds.add(evalCase.id)
  }

  return cases
}
