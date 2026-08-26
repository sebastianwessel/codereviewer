// The security boundary for every git process this domain starts.
//
// This domain is the only one permitted to read the repository UNDER REVIEW, and
// it does so with refs a run was pointed at — `--base-ref`/`--head-ref` values
// that can come from a CI variable, a PR payload, or a hand-typed command line.
// Git treats a leading `-` as an option wherever it appears, so a ref is the one
// place an argument can be smuggled into an otherwise fixed argument array.
//
// These two functions are what stop that. They are kept in a module of their own
// so the allowlist is one readable page rather than a paragraph inside the
// orchestration, and so a new git call has an obvious thing to go through. They
// hold no state and reach nothing but the path normalizer and the error factory.
import { normalizeRepositoryRelativePath } from '../../platform/repository-path.js'
import { createStructuredError } from '../../shared/errors/error-normalizer.js'

export const assertReadOnlyGitArgs = (args: readonly string[]): void => {
  const [command, ...rest] = args

  // `merge-base` resolves the divergence commit of two refs. It is a distinct
  // subcommand from `merge`: it only prints a commit id and never touches the
  // repository, index, or working tree.
  if (command === 'merge-base') {
    if (rest.length !== 2) {
      throw new TypeError('Git merge-base command shape is not allowlisted.')
    }

    assertSafeGitRef(rest[0], 'baseRef')
    assertSafeGitRef(rest[1], 'headRef')

    return
  }

  if (command !== 'diff') {
    throw new TypeError('Only read-only git diff and merge-base commands are allowed.')
  }

  const [mode, baseRef, headRef, separator] = rest

  if (mode === '--name-status' && rest.length === 3) {
    assertSafeGitRef(baseRef, 'baseRef')
    assertSafeGitRef(headRef, 'headRef')
    return
  }

  if (mode === '--unified=0' && separator === '--' && rest.length >= 4) {
    assertSafeGitRef(baseRef, 'baseRef')
    assertSafeGitRef(headRef, 'headRef')

    for (const filePath of rest.slice(4)) {
      normalizeRepositoryRelativePath(filePath)
    }

    return
  }

  throw new TypeError('Git diff command shape is not allowlisted.')
}

export const assertSafeGitRef = (ref: string | undefined, fieldName: string): string => {
  if (ref === undefined || ref.trim().length === 0 || ref.startsWith('-')) {
    throw createStructuredError({
      code: 'invalid_git_ref',
      message: 'Git refs must be non-empty and must not start with "-".',
      category: 'config',
      details: { field: fieldName }
    })
  }

  return ref
}
