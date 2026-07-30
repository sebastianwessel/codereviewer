// Majority-pattern extraction: what a peer set agrees on, and who does not.
//
// This is the second deterministic half of spec 24 and the whole of its removal
// criterion. The rule is stated in the spec and implemented literally here:
//
//   - a member is only compared against a peer set when it holds at least one
//     trait a majority of those peers also hold;
//   - a pattern is a trait a MAJORITY of the peers hold;
//   - a divergence is such a pattern that one member does not hold;
//   - a divergence citing fewer than three peers is a coincidence, not a pattern,
//     and MUST be rejected.
//
// All three thresholds are applied, and none implies another. A two-peer set has
// a majority at two and is still rejected for citing too few; a fifty-peer set can
// have twenty holders — comfortably above three — and is still rejected because
// twenty of fifty is not a convention; and a member that shares nothing with the
// set is not compared at all, however unanimous the set is.
//
// Every member of the peer set is evaluated, not only the changed declaration.
// Spec 24 is explicit that this capability MAY report a divergence the change did
// not cause, because suppressing "this handler is the only one without an auth
// check" purely because the change did not create it would hide the most useful
// thing the analysis produces. Those are labelled `pre-existing` and counted
// apart.

import { sha256 } from '../../shared/hash/hash.js'
import {
  conformanceAdjudicationInputFor,
  type ConformanceAdjudicationInput
} from './conformance-adjudication.js'
import {
  declarationTraitKey,
  declarationTraitSubjectKey,
  describeDeclarationTrait,
  describePositionedTrait,
  type DeclarationTrait
} from './declaration-shape.js'
import { describeTraitPosition, type TraitPosition } from './trait-position.js'
import type { PeerDeclaration, PeerSet } from './peer-sets.js'
import {
  MINIMUM_CITED_PEERS,
  type ConformanceDivergence,
  type DeclarationSite
} from './conformance-report.js'

const toSite = (declaration: PeerDeclaration): DeclarationSite => ({
  path: declaration.path,
  line: declaration.span.startLine,
  name: declaration.name
})

const divergenceId = (
  declaration: PeerDeclaration,
  traitKey: string
): string =>
  `conf_${sha256(
    `${declaration.path}:${declaration.span.startLine}:${traitKey}`
  ).slice(0, 24)}`

// How the member relates to the pattern, which is what decides how the divergence
// reads. Spec 24's positional traits split one shape into two: the declaration may
// not use the symbol at all, or it may use it somewhere structurally different. A
// reader told "does not call newError" about a declaration that plainly calls
// newError would stop reading, so the two are never phrased alike.
type MemberStanding =
  | { readonly shape: 'absent' }
  | { readonly shape: 'displaced'; readonly positions: readonly TraitPosition[] }

const describePositions = (positions: readonly TraitPosition[]): string =>
  [...new Set(positions.map(describeTraitPosition))].sort().join(' and ')

// What the peers do, with a plural subject. `describeDeclarationTrait` phrases the
// same fact for a single declaration ("calls X"), and the two are kept apart rather
// than patched at the call site, because a statement is read by a human and
// "4 of 4 sibling declarations calls X" reads as a defect in the tool.
const peerPredicate = (trait: DeclarationTrait): string => {
  if (trait.kind === 'guard') {
    return `call ${trait.name} in a conditional`
  }

  if (trait.kind === 'call-argument') {
    return `call ${trait.name} with ${trait.argument} as its first argument`
  }

  return `call ${trait.name}`
}

// The fact, phrased so it can be read without the schema. It states the
// arithmetic ("13 of 15") because the majority IS the claim, and it stops there:
// nothing about consequence, exploitability or correctness belongs in it.
const statementFor = (
  trait: DeclarationTrait,
  holders: number,
  peers: number,
  declaration: PeerDeclaration,
  standing: MemberStanding
): string =>
  standing.shape === 'displaced'
    ? `${holders} of ${peers} sibling declarations ${peerPredicate(
        trait
      )} ${describeTraitPosition(trait.position)}; ${
        declaration.name
      } does so ${describePositions(standing.positions)}.`
    : `${holders} of ${peers} sibling declarations ${peerPredicate(trait)}; ${
        declaration.name
      } does not.`

// The question, which is the other half of what spec 24 requires the output to
// be. It asks whether the shared pattern is a convention, never whether the code
// is wrong.
const questionFor = (
  trait: DeclarationTrait,
  declaration: PeerDeclaration,
  standing: MemberStanding
): string =>
  `Is calling ${trait.name}${trait.kind === 'guard' ? ' as a check' : ''}${
    standing.shape === 'displaced'
      ? ` ${describeTraitPosition(trait.position)}`
      : ''
  } a convention ${declaration.name} should follow, or do those peers merely resemble each other?`

/**
 * Whether a trait count is a majority of `peerCount`.
 *
 * One definition serves both the pattern rule and the membership rule below, so
 * "what this group of peers is about" cannot mean two different things in the two
 * halves of the same comparison.
 */
const isMajorityOf = (holders: number, peerCount: number): boolean =>
  holders * 2 > peerCount

type CandidateDivergence = {
  readonly divergence: ConformanceDivergence
  // Ranking inputs, kept out of the contract: they order the report without
  // implying a severity.
  readonly citedPeerCount: number
  readonly traitKey: string
  // The packet an adjudication call would send for this divergence, built here
  // because this is the only place that knows the peer set's other majority traits.
  // It is NOT part of the report contract: a divergence is a fact plus a question,
  // and the trait lists below are working material for the one judgement the
  // deterministic core cannot make.
  readonly adjudicationInput: ConformanceAdjudicationInput
}

// Bounds on the two trait lists the adjudication packet carries. A schema-heavy
// module can share dozens of majority traits, and a packet listing all of them
// spends input tokens describing the group in ever finer detail without changing
// what the group IS. Strongest agreement first, so what the cap drops is always
// the weakest evidence.
const MAX_SHARED_PEER_TRAITS = 12
const MAX_DECLARATION_TRAITS = 12

type HolderEntry = {
  readonly trait: DeclarationTrait
  readonly holders: PeerDeclaration[]
}

/**
 * Evaluates one member of a peer set against the majority patterns of the others.
 */
const divergencesForMember = (
  peerSet: PeerSet,
  member: PeerDeclaration
): readonly CandidateDivergence[] => {
  const peers = peerSet.members.filter(
    (candidate) =>
      candidate.path !== member.path ||
      candidate.span.startLine !== member.span.startLine
  )

  // A set that cannot cite three peers can never produce an admissible
  // divergence, so it is dropped before any counting.
  if (peers.length < MINIMUM_CITED_PEERS) {
    return []
  }

  const memberTraitKeys = new Set(member.traits.map(declarationTraitKey))
  // Where the member holds each trait SUBJECT, so a pattern it holds elsewhere is
  // reported as displaced rather than as missing.
  const memberPositionsBySubject = new Map<string, TraitPosition[]>()

  for (const trait of member.traits) {
    const subjectKey = declarationTraitSubjectKey(trait)
    const positions = memberPositionsBySubject.get(subjectKey) ?? []

    positions.push(trait.position)
    memberPositionsBySubject.set(subjectKey, positions)
  }

  const standingFor = (trait: DeclarationTrait): MemberStanding => {
    const positions = memberPositionsBySubject.get(
      declarationTraitSubjectKey(trait)
    )

    return positions === undefined || positions.length === 0
      ? { shape: 'absent' }
      : { shape: 'displaced', positions }
  }
  const holdersByKey = new Map<string, HolderEntry>()

  for (const peer of peers) {
    for (const trait of peer.traits) {
      const key = declarationTraitKey(trait)
      const entry = holdersByKey.get(key) ?? { trait, holders: [] }

      entry.holders.push(peer)
      holdersByKey.set(key, entry)
    }
  }

  // MEMBERSHIP PRECONDITION. Everything above establishes that the peers agree
  // with each other; nothing yet establishes that this member belongs to the group
  // they form. Peer sets are derived structurally — same fact kind, same language,
  // same indentation column — and that is a proxy for "sibling", not a proof of
  // it. A module's top-level declarations sit at column 0 whatever they are, so an
  // error class, a type alias and twenty schema builders land in one set, and the
  // error class is then reported for not calling a schema builder. It is not a
  // deviant member of that group; it is not a member of it.
  //
  // So a member is compared only when it holds at least one trait a majority of
  // its peers also hold. The quantifier is `majority` rather than `any peer`
  // because a pattern is already defined as what a majority holds: membership
  // asks whether the member holds one of the traits that make this set a set, and
  // a single incidental overlap with one sibling is precisely the coincidence the
  // citation floor already refuses to treat as evidence.
  if (
    ![...holdersByKey.entries()].some(
      ([key, entry]) =>
        memberTraitKeys.has(key) && isMajorityOf(entry.holders.length, peers.length)
    )
  ) {
    return []
  }

  const admissible = [...holdersByKey.entries()].filter(
    ([key, entry]) =>
      !memberTraitKeys.has(key) &&
      entry.holders.length >= MINIMUM_CITED_PEERS &&
      isMajorityOf(entry.holders.length, peers.length)
  )
  // ONE DIVERGENCE PER TRAIT SUBJECT. Positional traits let the same symbol be a
  // majority pattern at two positions at once — peers that both guard with `X` at
  // the top and call it again inside a loop — and a member holding neither would
  // otherwise be reported twice for one absence. The best-evidenced position is
  // kept, so the extra dimension can sharpen a divergence but never multiply it.
  const strongestBySubject = new Map<string, [string, HolderEntry]>()

  for (const candidate of admissible) {
    const subjectKey = declarationTraitSubjectKey(candidate[1].trait)
    const existing = strongestBySubject.get(subjectKey)

    if (
      existing === undefined ||
      candidate[1].holders.length > existing[1].holders.length ||
      (candidate[1].holders.length === existing[1].holders.length &&
        candidate[0].localeCompare(existing[0]) < 0)
    ) {
      strongestBySubject.set(subjectKey, candidate)
    }
  }

  const diverging = [...strongestBySubject.values()]
  // A member that does not call `X` at all cannot call it as a guard or with a
  // particular argument either, so the more specific divergences are redundant
  // restatements of the plain one. Reporting all three would inflate the count
  // three-fold for a single missing call.
  const missingCalls = new Set(
    diverging
      .filter(([, entry]) => entry.trait.kind === 'call')
      .map(([, entry]) => entry.trait.name)
  )
  // What a majority of these peers do, strongest agreement first. This is how the
  // group identifies itself, and it is the difference between an answerable
  // question and a guess: "these peers all build a schema" and "these peers all
  // respond to a request" are the two cases the adjudicator exists to separate.
  //
  // A divergence's own trait is removed from its own packet, but the OTHER traits
  // over the same symbol are kept on purpose. That a majority of the peers call the
  // symbol in a conditional, or pass it the request, is how the symbol is used
  // rather than a restatement that they use it — and it is the only signal in the
  // packet that tells a check apart from one call in a construction chain.
  const majorityTraits = [...holdersByKey.entries()]
    .filter(([, entry]) => isMajorityOf(entry.holders.length, peers.length))
    .sort(
      ([leftKey, left], [rightKey, right]) =>
        right.holders.length - left.holders.length ||
        leftKey.localeCompare(rightKey)
    )
  // The two packet lists describe the group and the member by WHAT they do. The
  // position is dropped here and de-duplicated away: a peer set that calls `respond`
  // at two positions has not thereby acquired two shared practices, and listing the
  // same phrase twice would spend the packet's bounded room restating one fact.
  // Position is carried where it is the point — on the divergent trait, and in the
  // statement.
  const declarationTraits = [
    ...new Set(
      [...member.traits]
        .sort((left, right) =>
          declarationTraitKey(left).localeCompare(declarationTraitKey(right))
        )
        .map(describeDeclarationTrait)
    )
  ].slice(0, MAX_DECLARATION_TRAITS)

  return diverging
    .filter(
      ([, entry]) =>
        entry.trait.kind === 'call' || !missingCalls.has(entry.trait.name)
    )
    .map(([key, entry]) => {
      const standing = standingFor(entry.trait)
      const divergence: ConformanceDivergence = {
        id: divergenceId(member, key),
        attribution: member.changeAttributed
          ? ('change-attributed' as const)
          : ('pre-existing' as const),
        declaration: {
          path: member.path,
          line: member.span.startLine,
          endLine: member.span.endLine,
          name: member.name,
          kind: member.kind,
          language: member.language
        },
        pattern: {
          kind: entry.trait.kind,
          symbol: entry.trait.name,
          ...(entry.trait.argument === undefined
            ? {}
            : { argument: entry.trait.argument })
        },
        peerScope: peerSet.scope,
        peerCount: peers.length,
        citedPeerCount: entry.holders.length,
        citedPeers: entry.holders.map(toSite),
        peersTruncated: peerSet.truncated,
        statement: statementFor(
          entry.trait,
          entry.holders.length,
          peers.length,
          member,
          standing
        ),
        question: questionFor(entry.trait, member, standing)
      }

      return {
        traitKey: key,
        citedPeerCount: entry.holders.length,
        divergence,
        adjudicationInput: conformanceAdjudicationInputFor(
          divergence,
          {
            sharedPeerTraits: [
              ...new Set(
                majorityTraits
                  .filter(([majorityKey]) => majorityKey !== key)
                  .map(([, majority]) => describeDeclarationTrait(majority.trait))
              )
            ].slice(0, MAX_SHARED_PEER_TRAITS),
            declarationTraits
          },
          // Positioned, because for a displaced divergence the position IS the
          // divergence and the unpositioned phrase would describe something the
          // declaration also does.
          describePositionedTrait(entry.trait)
        )
      }
    })
}

// Strongest agreement first, then a stable tie-break on location and trait, so
// two runs over the same commit emit byte-identical reports.
const compareCandidates = (
  left: CandidateDivergence,
  right: CandidateDivergence
): number =>
  right.citedPeerCount - left.citedPeerCount ||
  left.divergence.declaration.path.localeCompare(
    right.divergence.declaration.path
  ) ||
  left.divergence.declaration.line - right.divergence.declaration.line ||
  left.traitKey.localeCompare(right.traitKey)

export type CollectDivergencesInput = {
  readonly peerSets: readonly PeerSet[]
  readonly maxDivergences: number
  readonly maxPreExistingDivergences: number
}

export type CollectDivergencesResult = {
  readonly changeAttributed: readonly ConformanceDivergence[]
  readonly preExisting: readonly ConformanceDivergence[]
  readonly changeAttributedTruncated: boolean
  readonly preExistingTruncated: boolean
  // The adjudication packet for each reported divergence, by divergence id. A map
  // rather than a parallel array so a caller cannot pair a packet with the wrong
  // divergence, and separate from the divergences so the deterministic arm can
  // ignore it entirely.
  readonly adjudicationInputsById: ReadonlyMap<string, ConformanceAdjudicationInput>
}

/**
 * Collects the divergences of every peer set, de-duplicated and bounded.
 *
 * De-duplication is by divergence id: two changed declarations in the same
 * directory produce overlapping peer sets, so the same untouched sibling can be
 * found to be the odd one out more than once. It is one fact and is reported once.
 */
export const collectDivergences = (
  input: CollectDivergencesInput
): CollectDivergencesResult => {
  const byId = new Map<string, CandidateDivergence>()

  for (const peerSet of input.peerSets) {
    for (const member of peerSet.members) {
      for (const candidate of divergencesForMember(peerSet, member)) {
        const existing = byId.get(candidate.divergence.id)

        // Keep the reading backed by the most peers when the same declaration is
        // evaluated in two overlapping sets, so a bounded set never silently
        // replaces a better-evidenced one.
        if (
          existing === undefined ||
          candidate.citedPeerCount > existing.citedPeerCount
        ) {
          byId.set(candidate.divergence.id, candidate)
        }
      }
    }
  }

  const sorted = [...byId.values()].sort(compareCandidates)
  const changeAttributed = sorted.filter(
    (candidate) => candidate.divergence.attribution === 'change-attributed'
  )
  const preExisting = sorted.filter(
    (candidate) => candidate.divergence.attribution === 'pre-existing'
  )
  const reported = [
    ...changeAttributed.slice(0, input.maxDivergences),
    ...preExisting.slice(0, input.maxPreExistingDivergences)
  ]

  return {
    changeAttributed: changeAttributed
      .slice(0, input.maxDivergences)
      .map((candidate) => candidate.divergence),
    preExisting: preExisting
      .slice(0, input.maxPreExistingDivergences)
      .map((candidate) => candidate.divergence),
    changeAttributedTruncated: changeAttributed.length > input.maxDivergences,
    preExistingTruncated: preExisting.length > input.maxPreExistingDivergences,
    // Only the divergences that are actually reported get a packet: one beyond the
    // caps is never adjudicated, so building its packet would be dead work.
    adjudicationInputsById: new Map(
      reported.map(
        (candidate) => [candidate.divergence.id, candidate.adjudicationInput] as const
      )
    )
  }
}
