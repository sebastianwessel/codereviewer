// Reading the CURRENT bytes of one repository file, containment-checked against
// the repository root.
//
// One definition, because two callers need exactly the same answer to exactly the
// same question, and the question is "does this proposed edit still fit the file
// as it is on disk right now?". The fix lane asks it before an agent-produced edit
// set may enrich a finding's `fixProposal`; the review-comment layer asks it before
// that edit set may be rendered as a one-click ` ```suggestion `. A second copy
// could drift into a different notion of "current" — a mediated read that
// truncates at a byte budget, say, which shortens the file's line count and so
// turns a perfectly good edit into an apparently out-of-range one.
import { readFile } from 'node:fs/promises'
import { resolveExistingPathInsideRoot } from './path-service.js'

export type RepositoryFileReader = (
  repositoryRelativePath: string
) => Promise<string | undefined>

/**
 * Reads a repository-relative file as UTF-8, or resolves `undefined` when it
 * cannot be read — deleted, unreadable, or outside the root. Every caller of this
 * reader treats `undefined` as fail-closed, so it never throws: an unreadable file
 * must not fail a report or a fix lane, it must only withhold what it could not
 * prove.
 */
export const createRepositoryFileReader = (
  repositoryRoot: string
): RepositoryFileReader => async (repositoryRelativePath) => {
  try {
    return await readFile(
      await resolveExistingPathInsideRoot(repositoryRoot, repositoryRelativePath),
      'utf8'
    )
  } catch {
    return undefined
  }
}
