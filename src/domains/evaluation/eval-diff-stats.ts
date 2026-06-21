import { parseGitDiffMaps } from '../repository-intake/index.js'

export type EvalDiffStats = {
  readonly changedLineCount: number
  readonly diffHunkCount: number
}

export const calculateEvalDiffStats = (diff: string): EvalDiffStats => {
  let changedLineCount = 0

  for (const line of diff.split(/\r?\n/u)) {
    if (
      line.startsWith('+') &&
      !line.startsWith('+++') &&
      !line.startsWith('diff --git ')
    ) {
      changedLineCount += 1
    }
  }

  return {
    changedLineCount,
    diffHunkCount: parseGitDiffMaps(diff).reduce(
      (count, diffMap) => count + diffMap.hunks.length,
      0
    )
  }
}
