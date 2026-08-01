// What changed about a symbol's contract, stated the way a reviewer would state it.
//
// WHY THIS EXISTS. Without it `impact check` reports "`scheme` was modified, here
// are 49 places that mention it" — bounded, deduplicated and comment-free, but
// still a grep. It gives a reader no reason to open any particular reference. A
// contract delta is what turns the reference list into a reason: "`scheme` may now
// return nil where it previously could not" tells you which of those 49 to check.
//
// It is derived from the DIFF LINES inside the symbol's span, not from a second
// checkout of the base revision. Intake already carries the unified diff, so the
// added and removed lines are in hand; reconstructing and re-parsing the base tree
// to compare two ASTs would cost a second full parse of every changed file to
// answer a question the diff already contains.
//
// The cost of that choice is honest and worth stating: this reads TEXT, so it sees
// what the change wrote rather than what the type system concluded. It is a
// signal-strength claim ("a caller can observe this"), never a proof.

// Contract dimensions, in the order a reviewer cares about them. Each is a pair of
// language-neutral markers: what the removed lines said, what the added lines say.
//
// The vocabulary is deliberately drawn from constructs that exist across the seven
// supported languages rather than from any one of them — `nil` and `None` and
// `null` and `undefined` all mean "the caller may now get nothing", and a reader
// does not care which language spelled it.
type ContractDimension = {
  readonly id: string
  readonly pattern: RegExp
  // Stated when the construct APPEARS in the change but was not there before.
  readonly onAdded: string
  // Stated when it disappears. Removal is not the mirror of addition — losing a
  // guard is a different claim from gaining one — so both are written out.
  readonly onRemoved: string
}

const CONTRACT_DIMENSIONS: readonly ContractDimension[] = [
  {
    id: 'absence',
    pattern: /\b(null|nil|None|undefined|nullptr)\b/u,
    onAdded: 'may now yield an absent value (null/nil/None) where it previously did not',
    onRemoved: 'no longer yields an absent value it previously could'
  },
  {
    id: 'failure',
    pattern: /\b(throw|raise|panic|fail|reject)\b/u,
    onAdded: 'may now fail where it previously did not',
    onRemoved: 'no longer signals failure the way it previously did'
  },
  {
    id: 'return-shape',
    pattern: /(^|\s)(return|yield)\b/u,
    onAdded: 'returns something it did not return before',
    onRemoved: 'stopped returning on a path it previously returned on'
  },
  {
    id: 'guard',
    pattern: /(^|\s)(if|unless|guard|assert|require)\b/u,
    onAdded: 'gained a condition callers must now satisfy',
    onRemoved: 'lost a condition it previously enforced'
  },
  {
    id: 'mutation',
    pattern: /\b(push|append|delete|splice|clear|insert|remove|assign|set)\b/u,
    onAdded: 'mutates state it did not mutate before',
    onRemoved: 'no longer mutates state it previously did'
  },
  {
    id: 'concurrency',
    pattern: /\b(await|async|lock|mutex|synchronized|spawn|thread|go func)\b/u,
    onAdded: 'became concurrent or asynchronous in a way callers can observe',
    onRemoved: 'lost concurrency control it previously had'
  }
]

export type ContractDeltaInput = {
  // Lines the change ADDED inside this symbol's span, without their `+` marker.
  readonly addedLines: readonly string[]
  // Lines the change REMOVED from inside this symbol's span, without their `-`.
  readonly removedLines: readonly string[]
}

/**
 * The observable contract changes a reviewer should be told about.
 *
 * A dimension is reported only when it is ASYMMETRIC — present on one side of the
 * change and not the other. A function whose body already threw and still throws
 * has not changed its contract in that respect, and saying "may now fail" about it
 * would be the kind of confident noise that makes a report ignorable. Reformatting,
 * renaming a local, or reordering statements produces no entries at all.
 *
 * Returns an empty list far more often than not, and that is the intended
 * behaviour: it means "changed, but not in a way this engine can show reaches a
 * caller" — never "safe".
 */
export const describeContractDelta = (
  input: ContractDeltaInput
): readonly string[] => {
  const added = input.addedLines.join('\n')
  const removed = input.removedLines.join('\n')
  const changes: string[] = []

  for (const dimension of CONTRACT_DIMENSIONS) {
    const inAdded = dimension.pattern.test(added)
    const inRemoved = dimension.pattern.test(removed)

    if (inAdded && !inRemoved) {
      changes.push(dimension.onAdded)
      continue
    }

    if (inRemoved && !inAdded) {
      changes.push(dimension.onRemoved)
    }
  }

  return changes
}
