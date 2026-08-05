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

// The dimensions, named. They are an ENUM rather than free-form strings because
// adjudication (spec 22 design step 3) branches on them: a compatibility class and
// a caller-side consequence are properties of the dimension, and deriving either
// by matching on a rendered English sentence would make the report's prose
// load-bearing. The statement a reader sees is derived FROM the dimension, never
// the other way round.
export const CONTRACT_DIMENSION_IDS = [
  'absence',
  'failure',
  'return-shape',
  'guard',
  'mutation',
  'concurrency'
] as const

export type ContractDimensionId = (typeof CONTRACT_DIMENSION_IDS)[number]

/**
 * One observable change to what callers can rely on.
 *
 * `statement` is what the symbol-side table shows; `consequence` is what a
 * dependent shown to rely on it is exposed to. They are separate because they
 * answer different questions and are read by different readers: the first is about
 * the symbol, the second is about a named file that uses it.
 */
export type ContractChange = {
  readonly dimension: ContractDimensionId
  // Which side of the change the construct appeared on. Carried because losing a
  // guard is a different claim from gaining one, and a consumer that needs the
  // distinction should not have to re-derive it from the wording.
  readonly direction: 'added' | 'removed'
  readonly statement: string
  readonly consequence: string
}

// Contract dimensions, in the order a reviewer cares about them. Each is a pair of
// language-neutral markers: what the removed lines said, what the added lines say.
//
// The vocabulary is deliberately drawn from constructs that exist across the seven
// supported languages rather than from any one of them — `nil` and `None` and
// `null` and `undefined` all mean "the caller may now get nothing", and a reader
// does not care which language spelled it.
type ContractStatement = {
  // What the SYMBOL now does. Reads as a continuation of the symbol's name.
  readonly statement: string
  // What that does to a dependent SHOWN TO RELY ON IT. Never a claim on its own:
  // it is only ever emitted attached to an adjudicated reliance, so it describes
  // an exposure that was established rather than one that was assumed.
  readonly consequence: string
}

type ContractDimension = {
  readonly id: ContractDimensionId
  readonly pattern: RegExp
  // Stated when the construct APPEARS in the change but was not there before.
  readonly onAdded: ContractStatement
  // Stated when it disappears. Removal is not the mirror of addition — losing a
  // guard is a different claim from gaining one — so both are written out.
  readonly onRemoved: ContractStatement
}

const CONTRACT_DIMENSIONS: readonly ContractDimension[] = [
  {
    id: 'absence',
    pattern: /\b(null|nil|None|undefined|nullptr)\b/u,
    onAdded: {
      statement:
        'may now yield an absent value (null/nil/None) where it previously did not',
      consequence:
        'a use here that assumes a value is present fails when it is absent'
    },
    onRemoved: {
      statement: 'no longer yields an absent value it previously could',
      consequence:
        'handling here for the absent case can no longer be reached, so a branch this file relies on is now dead'
    }
  },
  {
    id: 'failure',
    pattern: /\b(throw|raise|panic|fail|reject)\b/u,
    onAdded: {
      statement: 'may now fail where it previously did not',
      consequence:
        'a use here that does not handle a failure propagates it to this file and its own callers'
    },
    onRemoved: {
      statement: 'no longer signals failure the way it previously did',
      consequence:
        'failure handling here can no longer be reached, so this file no longer learns about the condition it was written for'
    }
  },
  {
    id: 'return-shape',
    pattern: /(^|\s)(return|yield)\b/u,
    onAdded: {
      statement: 'returns something it did not return before',
      consequence: 'a use here reads a result whose shape the change moved'
    },
    onRemoved: {
      statement: 'stopped returning on a path it previously returned on',
      consequence:
        'a use here can receive nothing on a path that previously produced a result'
    }
  },
  {
    id: 'guard',
    pattern: /(^|\s)(if|unless|guard|assert|require)\b/u,
    onAdded: {
      statement: 'gained a condition callers must now satisfy',
      consequence:
        'a call from here that does not satisfy the new condition is rejected'
    },
    onRemoved: {
      statement: 'lost a condition it previously enforced',
      consequence:
        'this file is no longer protected by a condition it was written against'
    }
  },
  {
    id: 'mutation',
    pattern: /\b(push|append|delete|splice|clear|insert|remove|assign|set)\b/u,
    onAdded: {
      statement: 'mutates state it did not mutate before',
      consequence: 'state this file holds is changed underneath it'
    },
    onRemoved: {
      statement: 'no longer mutates state it previously did',
      consequence:
        'state this file expected to be updated is left as it was'
    }
  },
  {
    id: 'concurrency',
    pattern: /\b(await|async|lock|mutex|synchronized|spawn|thread|go func)\b/u,
    onAdded: {
      statement:
        'became concurrent or asynchronous in a way callers can observe',
      consequence:
        'a use here that consumes the result without waiting for it observes an incomplete result'
    },
    onRemoved: {
      statement: 'lost concurrency control it previously had',
      consequence: 'ordering this file relied on is no longer enforced'
    }
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
): readonly ContractChange[] => {
  const added = input.addedLines.join('\n')
  const removed = input.removedLines.join('\n')
  const changes: ContractChange[] = []

  for (const dimension of CONTRACT_DIMENSIONS) {
    const inAdded = dimension.pattern.test(added)
    const inRemoved = dimension.pattern.test(removed)

    if (inAdded && !inRemoved) {
      changes.push({
        dimension: dimension.id,
        direction: 'added',
        ...dimension.onAdded
      })
      continue
    }

    if (inRemoved && !inAdded) {
      changes.push({
        dimension: dimension.id,
        direction: 'removed',
        ...dimension.onRemoved
      })
    }
  }

  return changes
}
