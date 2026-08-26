// Removed-comment disclosure in the reviewed diff (spec 17 anti-contamination).
//
// A corpus case reviews `base = fixCommit`, `head = parentCommit`: the upstream
// fix read backwards. A comment the fix ADDED therefore appears in the reviewed
// diff as a REMOVED line, and if that comment explains the defect in prose, the
// reviewer is handed the expectation in English before it reads any code.
//
// The advisory scan (`answerKeyLeakIn`) cannot see this: it looks for
// security-advisory vocabulary, and a plain engineering comment carries none.
//
// This rule is deliberately fuzzy, so it produces a WARNING a curator must
// resolve rather than a hard failure. A fuzzy rule wired to a hard failure would
// reject benign material (a copyright header, an unrelated comment displaced by
// re-indentation) and invite whoever hits it to weaken the rule until the corpus
// passes again. The advisory scan keeps its hard failure precisely because it is
// specific.

const commentMarkerPattern = /^(?:\/\/|\/\*|\*|#|--|<!--)/u

const wordTokenPattern = /[A-Za-z][A-Za-z'-]*/gu

// Prose, not punctuation. A marker line with fewer word-like tokens than this is
// a delimiter (`*/`), a directive, or a two-word label — none of which can carry
// an explanation of a defect.
export const minimumDisclosureWordCount = 5

const isProseComment = (content: string): boolean =>
  commentMarkerPattern.test(content) &&
  (content.match(wordTokenPattern) ?? []).length >= minimumDisclosureWordCount

// Only lines that START with a comment marker are considered. A trailing comment
// on a code line is not scanned, because `//` and `#` occur inside string
// literals and URLs, and a rule that split on them would flag ordinary code. The
// consequence to remember is that a disclosure appended to a code line is not
// detected by this rule.
//
// Hunk bodies are located by tracking `@@` and `diff --git` rather than by
// skipping lines that start with `---`, so a removed line whose own content
// begins with `--` (a Lua or SQL comment) is still read as removed content.
export const removedProseCommentsIn = (diff: string): readonly string[] => {
  const flagged = new Set<string>()
  let insideHunk = false

  for (const line of diff.split(/\r?\n/u)) {
    if (line.startsWith('diff --git ')) {
      insideHunk = false
      continue
    }

    if (line.startsWith('@@')) {
      insideHunk = true
      continue
    }

    if (!insideHunk || !line.startsWith('-')) {
      continue
    }

    const content = line.slice(1).trim()

    if (isProseComment(content)) {
      flagged.add(content)
    }
  }

  return [...flagged]
}

export type RemovedCommentDisclosureResolution = {
  // Flagged comments no curator has judged. Each one may be the answer key.
  readonly unresolvedComments: readonly string[]
  // Acknowledged text the reviewed diff no longer removes. A resolution that
  // outlives the comment it described is a blanket approval waiting to cover the
  // next disclosure, so it is reported rather than ignored.
  readonly staleAcknowledgements: readonly string[]
}

export const resolveRemovedCommentDisclosures = (input: {
  readonly flaggedComments: readonly string[]
  readonly acknowledgedComments: readonly string[]
}): RemovedCommentDisclosureResolution => {
  const acknowledged = new Set(input.acknowledgedComments)
  const flagged = new Set(input.flaggedComments)

  return {
    unresolvedComments: input.flaggedComments.filter(
      (comment) => !acknowledged.has(comment)
    ),
    staleAcknowledgements: input.acknowledgedComments.filter(
      (comment) => !flagged.has(comment)
    )
  }
}
