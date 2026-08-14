// `impact check` (spec 22).
//
// It produces a REFERENCE report plus the adjudicated subset of it: the dependents
// shown to rely on the part of the contract that changed, each with its path, its
// line, the contract element and the consequence. Nothing here carries a severity —
// spec 22's findings carry a COMPATIBILITY CLASS instead — and nothing can block.
// The exit code is 0 whatever the report says, and only a configuration (2) or
// repository (3) failure changes that. A breaking change is frequently
// intentional; the command's job is to surface the dependents, not to decide
// whether breaking them is acceptable.
//
// It makes a provider call ONLY for the residue, and only when
// `changeImpact.adjudication.enabled` is set: everything structural — a removed,
// relocated or newly added declaration — is settled in code, and a run without a
// provider still emits those findings and counts the rest as unadjudicated. With
// adjudication off the command remains fully deterministic and free.
//
// The reference list is also spec 22's own falsifier: its removal criterion is
// that the capability must beat naming the changed symbols and letting a human
// grep, and that list IS that baseline.
//
// Its output goes three places, for one reason each. The JSON stays on stdout so
// scripted use keeps working. The rendered Markdown lands in the run directory
// beside where `review` writes `report.md`, because a report a reviewer has to go
// looking for is not in the workflow they actually use — spec 22 records exactly
// that gap. `--format markdown` puts the same document on stdout for someone
// reading it in a terminal or piping it into a pull-request body.
//
// The body of all of that is `runAdvisoryCheckCommand`, shared with `intent
// check`: the two commands were the same shape written twice, and everything this
// one does differently now lives in `changeImpactLaneDescriptor`.
import { runAdvisoryCheckCommand } from '../advisory-check-command.js'
import { changeImpactLaneDescriptor } from '../advisory-lane.js'
import type { CliResult, CliRunOptions } from '../cli-contract.js'

export const runImpact = async (
  args: readonly string[],
  options: CliRunOptions
): Promise<CliResult> =>
  runAdvisoryCheckCommand(changeImpactLaneDescriptor, args, options)
