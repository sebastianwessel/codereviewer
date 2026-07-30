// Spec 25: the two things a changed guard is allowed to contribute to a review.
//
// Arm A — a section stating that a conditional changed and what it precedes.
// Arm B — the names that region calls, as a ranking input for the existing
//         referenced-definition budget (NOT extra bytes; see the spec amendment).
//
// The section states structure and nothing else. It does not say a protection was
// weakened, that the change is unsafe, or that anything is wrong: the trigger is
// lexical and cannot know any of that, and a section that asserted it would be
// the "did this weaken security?" framing measured to clear already-patched clean
// files only 3.2-11.8% of the time. Discovery does the judging; this only points.

import {
  findGuardedRegions,
  toSourceLines,
  type GuardedRegion
} from '../../../declaration-analysis/index.js'
import type { SupportSignalFact, SupportSignalSourceFile } from '../../../deterministic-signals/index.js'
import type { ReviewedDiffRange } from '../../../admission/index.js'

// Enough to point at what changed without turning the packet into a list. A diff
// touching more conditionals than this is a refactor, and naming forty of them
// would bury the section it is meant to sharpen.
const MAX_REPORTED_REGIONS = 12

// Ranking input only, so a long list buys nothing: the referenced-definition
// budget admits at most six files.
const MAX_PRIORITY_CALLEES = 24

export type GuardedRegionContextResult = {
  // '' when nothing triggered, which is the common case and not an error.
  readonly sectionText: string
  // De-duplicated, in the order the regions were found.
  readonly priorityCalleeNames: readonly string[]
  readonly regionCount: number
}

export type CollectGuardedRegionContextInput = {
  readonly sourceFiles: readonly SupportSignalSourceFile[]
  readonly facts: readonly SupportSignalFact[]
  readonly reviewedDiffRanges: readonly ReviewedDiffRange[]
  readonly taskPaths: readonly string[]
}

const changedLinesFor = (
  ranges: readonly ReviewedDiffRange[],
  path: string
): ReadonlySet<number> => {
  const lines = new Set<number>()

  for (const range of ranges) {
    if (range.path !== path) {
      continue
    }

    for (let line = range.startLine; line <= range.endLine; line += 1) {
      lines.add(line)
    }
  }

  return lines
}

const describeRegion = (path: string, region: GuardedRegion): string => {
  const calls =
    region.calleeNames.length === 0
      ? ''
      : `, which calls ${region.calleeNames.join(', ')}`

  return (
    `- ${path}:${region.guardLine} — a conditional in \`${region.declarationName}\` ` +
    `changed; it precedes lines ${region.governedStartLine}-${region.governedEndLine}${calls}.`
  )
}

/**
 * Guarded-region facts for one task's changed files.
 *
 * Returns an empty result when the diff touched no conditional inside a known
 * declaration — the common case. Both arms read this; which of them is switched
 * on is the caller's decision.
 */
export const collectGuardedRegionContext = (
  input: CollectGuardedRegionContextInput
): GuardedRegionContextResult => {
  const taskPathSet = new Set(input.taskPaths)
  const described: string[] = []
  const priorityCalleeNames: string[] = []
  let regionCount = 0

  for (const sourceFile of input.sourceFiles) {
    if (!taskPathSet.has(sourceFile.path)) {
      continue
    }

    const changedLines = changedLinesFor(
      input.reviewedDiffRanges,
      sourceFile.path
    )

    if (changedLines.size === 0) {
      continue
    }

    const lines = toSourceLines(sourceFile.content)

    for (const fact of input.facts) {
      if (fact.path !== sourceFile.path || fact.kind !== 'declaration') {
        continue
      }

      for (const region of findGuardedRegions({
        lines,
        declarationStartLine: fact.line,
        declarationName: fact.name,
        changedLines
      })) {
        regionCount += 1

        if (described.length < MAX_REPORTED_REGIONS) {
          described.push(describeRegion(sourceFile.path, region))
        }

        for (const name of region.calleeNames) {
          if (
            !priorityCalleeNames.includes(name) &&
            priorityCalleeNames.length < MAX_PRIORITY_CALLEES
          ) {
            priorityCalleeNames.push(name)
          }
        }
      }
    }
  }

  if (described.length === 0) {
    return { sectionText: '', priorityCalleeNames: [], regionCount: 0 }
  }

  const omitted =
    regionCount > described.length
      ? `\n(${regionCount - described.length} further changed conditionals not listed.)`
      : ''

  return {
    sectionText:
      `\n## Changed conditionals (deterministic, structural)\n` +
      `Lines this change modified that decide whether the code after them runs, ` +
      `with the extent each one precedes. This is a structural observation only: ` +
      `it does NOT claim any of these is wrong, weakened, or unsafe, and a ` +
      `deliberate change will appear here exactly like a mistaken one. Use it to ` +
      `decide where to look, never as evidence that something is a defect.\n` +
      `${described.join('\n')}${omitted}`,
    priorityCalleeNames,
    regionCount
  }
}
