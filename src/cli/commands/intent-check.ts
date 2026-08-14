// `intent check` (spec 23).
//
// What it produces is a MAPPING between the stated intent and the change: the
// obligations the intent states, each citing the line it was read from, and for
// each one either the changed lines that address it or nothing. It is not a
// verdict, nothing is admitted, nothing carries a severity, and spec 23 makes
// advisory-only a REQUIREMENT rather than a default — "The command MUST NOT be
// able to fail a pipeline on fulfilment grounds. This is not configurable" —
// because published measurement puts spurious rejection of model requirement-
// conformance judgement at 26-36%, rising to 73-88% when the same call also
// explains itself. The exit code is therefore 0 whatever the report says,
// INCLUDING when there is no intent to read, and only a configuration or usage
// failure (2) or a repository failure (3) changes it.
//
// It is one of three independently runnable stages and shares no context or output
// with the other two: `review` can block, `intent check` and `impact check`
// cannot.
//
// Output mirrors `impact check`: stdout stays exactly one JSON document so scripted
// use keeps working, and the rendered Markdown lands in a run directory beside where
// `review` writes `report.md`. The rendering matters more here than there — this
// lane's dominant measured error is a MISREAD answer rather than a wrong one, and a
// document that names what the search found is where that is preserved or lost. See
// `intent-markdown.ts`.
//
// It mirrors `impact check` because it IS `impact check`'s body:
// `runAdvisoryCheckCommand` is the shape both commands share, and everything this
// one does differently lives in `intentFulfilmentLaneDescriptor`.
import { runAdvisoryCheckCommand } from '../advisory-check-command.js'
import { intentFulfilmentLaneDescriptor } from '../advisory-lane.js'
import type { CliResult, CliRunOptions } from '../cli-contract.js'

export const runIntent = async (
  args: readonly string[],
  options: CliRunOptions
): Promise<CliResult> =>
  runAdvisoryCheckCommand(intentFulfilmentLaneDescriptor, args, options)
