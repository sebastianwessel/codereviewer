import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { resolveExistingPathInsideRoot } from '../../platform/path-service.js'
import {
  EvalSliceCaseSchema,
  parseEvalCasesJson,
  type EvalCase
} from './eval-fixture.schema.js'

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

const readSliceCases = async (
  repositoryRoot: string
): Promise<readonly EvalCase[]> => {
  let sliceRoot: string

  try {
    sliceRoot = await resolveExistingPathInsideRoot(repositoryRoot, sliceRootPath)
  } catch (error) {
    if (isMissingPathError(error)) {
      return []
    }

    throw error
  }

  const entries = await readdir(sliceRoot, { withFileTypes: true })
  const cases = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(async (entry): Promise<EvalCase> => {
        const sliceFile = await resolveExistingPathInsideRoot(
          repositoryRoot,
          path.posix.join(sliceRootPath, entry.name, 'slice.json')
        )
        const slice = EvalSliceCaseSchema.parse(
          JSON.parse(await readFile(sliceFile, 'utf8'))
        )

        return {
          id: slice.id,
          language: slice.language,
          repositoryFixture: path.posix.join(
            'fixtures',
            'slices',
            entry.name,
            'repo'
          ),
          ...(slice.baseRef === undefined ? {} : { baseRef: slice.baseRef }),
          ...(slice.headRef === undefined ? {} : { headRef: slice.headRef }),
          changedFiles: [...slice.changedFiles],
          expectedFindings: [...slice.expectedFindings],
          expectedNoFindingZones: [...slice.expectedNoFindingZones],
          tags: [...new Set(['slice', ...slice.tags])]
        }
      })
  )

  return cases
}

export const loadEvalCasesFromFixtures = async (
  repositoryRoot: string
): Promise<readonly EvalCase[]> => {
  const cases = [
    ...(await readSampleCases(repositoryRoot)),
    ...(await readSliceCases(repositoryRoot))
  ]
  const seenIds = new Set<string>()

  for (const evalCase of cases) {
    if (seenIds.has(evalCase.id)) {
      throw new Error(`Duplicate eval case id "${evalCase.id}".`)
    }

    seenIds.add(evalCase.id)
  }

  return cases
}
