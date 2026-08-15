// How the plausibility judge gets to see the file the reviewer saw: a memoized
// reader over one run's fixture repositories.
import { readFile } from 'node:fs/promises'
import type { EvalCaseFileReader } from '../domains/evaluation/index.js'
import {
  resolveExistingPathInsideRoot,
  resolvePathInsideRoot
} from '../platform/path-service.js'

/**
 * Reads the new-side content of a finding's file from the case's fixture repo,
 * so the plausibility judge sees the same file the reviewer saw. Returns
 * undefined on any read failure; the judge then fails closed.
 *
 * Memoized for the run because the judge asks once per UNMATCHED FINDING and
 * several findings routinely land in one file: without this, four findings in
 * a file cost four reads and eight `realpath` syscalls over identical bytes.
 * A failure is cached alongside a success — the fixture repository does not
 * change during an eval run, so a second attempt would fail the same way, and
 * caching it keeps the judge's fail-closed verdict consistent across the
 * findings in that file.
 */
export const createEvalFindingSourceReader = (
  repositoryRoot: string
): EvalCaseFileReader => {
  const findingSourceByKey = new Map<string, string | undefined>()

  return async ({ evalCase, path: findingPath }) => {
    // The fixture root, not the case id: two cases pointing at one fixture read
    // the same file. A NUL separator cannot occur in a path, so no two
    // different pairs can ever collapse onto one key.
    const cacheKey = `${evalCase.repositoryFixture}\u0000${findingPath}`

    if (findingSourceByKey.has(cacheKey)) {
      return findingSourceByKey.get(cacheKey)
    }

    let content: string | undefined

    try {
      const fixtureRoot = await resolveExistingPathInsideRoot(
        repositoryRoot,
        evalCase.repositoryFixture
      )

      content = await readFile(
        resolvePathInsideRoot(fixtureRoot, findingPath),
        'utf8'
      )
    } catch {
      content = undefined
    }

    findingSourceByKey.set(cacheKey, content)

    return content
  }
}
