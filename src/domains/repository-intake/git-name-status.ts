// Parsing for `git diff --name-status` output: the tab-separated status/path
// lines that tell intake which paths a change touched and how. Kept apart from
// the intake orchestration because it is a pure text-to-record function over
// git's output format, with no filesystem, no refs, and no policy in it.

export type GitChangedPath = {
  readonly path: string
  readonly status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied'
}

const statusFromGitCode = (statusCode: string): GitChangedPath['status'] => {
  const normalizedStatus = statusCode[0]

  if (normalizedStatus === 'A') {
    return 'added'
  }

  if (normalizedStatus === 'D') {
    return 'deleted'
  }

  if (normalizedStatus === 'R') {
    return 'renamed'
  }

  if (normalizedStatus === 'C') {
    return 'copied'
  }

  return 'modified'
}

export const parseGitNameStatus = (output: string): readonly GitChangedPath[] =>
  output
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [statusCode, firstPath, secondPath] = line.split('\t')
      const status = statusFromGitCode(statusCode ?? 'M')
      const rawPath = status === 'renamed' || status === 'copied' ? secondPath : firstPath

      if (rawPath === undefined) {
        throw new TypeError('Git name-status output is missing a path.')
      }

      return {
        path: rawPath,
        status
      }
    })
