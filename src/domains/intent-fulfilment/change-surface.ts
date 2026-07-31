// The change, reduced to the lines a judgement is allowed to cite.
//
// Spec 23: "An obligation judged addressed MUST cite the change that addresses
// it — path and line. Unevidenced satisfaction claims are worse than silence,
// because they invite a reviewer to stop checking."
//
// Two things follow, and both are structural rather than advisory.
//
// 1. The judgement is shown the lines the diff ADDED, MODIFIED OR REMOVED, not
//    whole files. A citation into an untouched line is not evidence that the
//    change addressed anything, and a model shown whole files will produce one.
//    Removed lines were added by spec 23's 2026-07-30 amendment: without them a
//    deletion is unprovable, because it creates no line to point at, and every
//    "remove X" obligation came back wrong on a real revert commit.
// 2. The same set is the verification surface. A cited `path:line` that is not
//    in it is not a valid citation, so "addressed" cannot survive on a line the
//    change never touched. That check is `verifyJudgement` in `judgement.ts`, and
//    it reads the surface this module builds — one definition of "the change",
//    used both to ask and to check.

import type { DiffHunk, RemovedLine } from '../repository-intake/index.js'

// Which side of the change a citable line lives on. A removed line is numbered on
// the PRE-change side, so the two are different address spaces and the side has to
// travel with the number — spec 23 requires the report to disclose it, so that
// "done, this deleted line 42" can never read as "done, this added line 42".
type ChangedLineSide = 'added' | 'removed'

export type ChangedLine = {
  readonly line: number
  readonly text: string
  readonly side: ChangedLineSide
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
  // Lines this change removed, numbered on the pre-change side. Absent for a file
  // that removes nothing.
  readonly removedLines?: readonly RemovedLine[]
}

const splitLines = (content: string): readonly string[] =>
  content.split(/\r\n|\n|\r/u)

// New-side line numbers a hunk covers. A hunk with `newLineCount === 0` is a pure
// deletion: it adds no line on the new side, which is precisely why the removed
// lines are carried separately rather than by citing the surviving line beside it
// — that would attribute the deletion to code the change did not write.
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
 *
 * Added lines come before removed lines within a file, and the budget is spent in
 * that order. A pure deletion therefore still reaches the surface, while a change
 * that both adds and removes spends its budget on the new code first.
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
      changedLines.push({ line, text, side: 'added' })
    }

    for (const removed of file.removedLines ?? []) {
      if (removed.text.trim().length === 0) {
        continue
      }

      if (remaining <= 0) {
        truncated = true
        break
      }

      remaining -= 1
      changedLines.push({ line: removed.line, text: removed.text, side: 'removed' })
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
