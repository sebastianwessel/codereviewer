// The change, reduced to the lines a judgement is allowed to cite.
//
// Spec 23: "An obligation judged addressed MUST cite the change that addresses
// it — path and line. Unevidenced satisfaction claims are worse than silence,
// because they invite a reviewer to stop checking."
//
// Two things follow, and both are structural rather than advisory.
//
// 1. The judgement is shown the lines the diff ADDED OR MODIFIED, not whole
//    files. A citation into an untouched line is not evidence that the change
//    addressed anything, and a model shown whole files will produce one.
// 2. The same set is the verification surface. A cited `path:line` that is not
//    in it is not a valid citation, so "addressed" cannot survive on a line the
//    change never touched. That check is `verifyJudgement` in `judgement.ts`, and
//    it reads the surface this module builds — one definition of "the change",
//    used both to ask and to check.

import type { DiffHunk } from '../repository-intake/index.js'

export type ChangedLine = {
  readonly line: number
  readonly text: string
}

export type ChangedFileSurface = {
  readonly path: string
  readonly changedLines: readonly ChangedLine[]
}

export type ChangeSurface = {
  readonly files: readonly ChangedFileSurface[]
  readonly changedLineCount: number
  // True when `maxChangeLines` bounded the surface, so a reader can never mistake
  // a bounded judgement for one made over the whole change.
  readonly truncated: boolean
}

export type ChangeSurfaceSourceFile = {
  readonly path: string
  readonly content: string
  readonly hunks: readonly DiffHunk[]
  // A new file has no pre-change side, so every one of its lines is changed and
  // the hunks are not consulted.
  readonly isNewFile: boolean
}

const splitLines = (content: string): readonly string[] =>
  content.split(/\r\n|\n|\r/u)

// New-side line numbers a hunk covers. A hunk with `newLineCount === 0` is a pure
// deletion: it adds no line to cite, and citing the surviving line beside it would
// attribute the deletion to code the change did not write.
const linesInHunks = (hunks: readonly DiffHunk[]): ReadonlySet<number> => {
  const lines = new Set<number>()

  for (const hunk of hunks) {
    for (let offset = 0; offset < hunk.newLineCount; offset += 1) {
      lines.add(hunk.newStartLine + offset)
    }
  }

  return lines
}

/**
 * Builds the citable change surface, bounded by `maxChangeLines`.
 *
 * Files are consumed in the order intake produced them and lines in ascending
 * order, so which part of a large change a bounded run judges is reproducible
 * rather than dependent on iteration order. Blank changed lines are skipped: they
 * are citable addresses that show nothing, and admitting them would let an
 * "addressed" verdict rest on whitespace.
 */
export const collectChangeSurface = (input: {
  readonly files: readonly ChangeSurfaceSourceFile[]
  readonly maxChangeLines: number
}): ChangeSurface => {
  const files: ChangedFileSurface[] = []
  let remaining = input.maxChangeLines
  let truncated = false
  let changedLineCount = 0

  for (const file of input.files) {
    const lines = splitLines(file.content)
    const selected = file.isNewFile ? undefined : linesInHunks(file.hunks)
    const changedLines: ChangedLine[] = []

    for (const [index, text] of lines.entries()) {
      const line = index + 1

      if (selected !== undefined && !selected.has(line)) {
        continue
      }

      if (text.trim().length === 0) {
        continue
      }

      if (remaining <= 0) {
        truncated = true
        break
      }

      remaining -= 1
      changedLines.push({ line, text })
    }

    if (changedLines.length > 0) {
      changedLineCount += changedLines.length
      files.push({ path: file.path, changedLines })
    }

    if (truncated) {
      break
    }
  }

  return { files, changedLineCount, truncated }
}
