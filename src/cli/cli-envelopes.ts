// The one place the CLI's own output documents are checked against their
// contracts, before anything renders them.
//
// WHY A PARSE AND NOT ONLY A TYPE.
//
// A type is what these envelopes already had in effect, and it is what let them
// drift: an object literal typed by inference satisfies whatever it happens to
// be, so a renamed field failed nothing. Annotating the literals would catch a
// rename — but three things a consumer depends on are not expressible in the
// type system and are exactly what breaks a pipeline reading this JSON:
//
//   1. `JSON.stringify` DROPS a key whose value is `undefined`. A field can
//      disappear from the printed document at runtime with a green typecheck,
//      leaving a plausible-looking envelope that CI reads a missing
//      `artifactDir` out of. This repository has a name for that shape.
//   2. Value invariants the documentation states and consumers branch on: a
//      non-empty `runId`, an `artifactDir` that really is repository-relative,
//      an `entryCount` that is a whole non-negative number.
//   3. `strictObject` rejects an extra key at runtime. Excess-property checking
//      only applies to fresh object literals, and two of the four envelopes are
//      built from values that arrive from a domain module.
//
// The cost is one parse of a three- or four-key object per command invocation —
// once per process, against work measured in seconds. The report contracts pay
// the same price at their boundary for the same reason.
//
// These builders return the VALIDATED OBJECT rather than a rendered string, so
// each producer keeps the rendering it already had. `mapErrorResult` pretty-
// prints with a trailing newline and `usageError` writes compact JSON; that
// difference is not this module's to reconcile, and reconciling it would change
// what the CLI prints.
import type { ZodType } from 'zod'
import {
  BaselineWriteStdoutEnvelopeSchema,
  type BaselineWriteStdoutEnvelope,
  CliErrorEnvelopeSchema,
  type CliErrorEnvelope,
  ReviewStdoutEnvelopeSchema,
  type ReviewStdoutEnvelope,
  RunErrorArtifactSchema,
  type RunErrorArtifact
} from '../shared/contracts/index.js'
import { createStructuredError } from '../shared/errors/error-normalizer.js'

/**
 * The code every envelope violation reports under, on stdout and stderr alike.
 * Documented in `docs/06-reference/exit-codes-and-error-codes.md`; it names a
 * fault in this repository, never in the caller's input.
 */
export const CLI_ENVELOPE_INVALID_CODE = 'cli_envelope_invalid'

const describeViolation = (
  envelopeName: string,
  issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[]
): string =>
  `The ${envelopeName} envelope does not satisfy its contract: ${issues
    .map(
      (issue) =>
        `${issue.path.length === 0 ? '(root)' : issue.path.join('.')}: ${issue.message}`
    )
    .join('; ')}`

// THE RULE THIS MODULE FOLLOWS, stated once because it decides which of the two
// builders below each document gets:
//
//   A builder on the SUCCESS path raises. A builder on the FAILURE path never
//   does, and reports the violation inside the document it was asked to build.
//
// A success envelope is built inside a command's `try`, so a throw lands in that
// command's own catch and is classified there. A failure-path builder is called
// FROM a catch — `cliError` from every command's error mapping, and
// `runErrorArtifact` from the partial-artifact write in `review`'s catch — where
// a throw escapes as an unhandled rejection. Node exits `1` for that, and `1` is
// the code this CLI reserves for "run completed, a gate failed": a pipeline
// would be told the run finished cleanly and its artifacts are complete. The
// channel that exists for reporting problems has to stay able to report this
// one.

// The success-path half. It raises a structured `internal` error rather than the
// raw `ZodError` because `mapErrorResult` classifies a `ZodError` as a
// CONFIGURATION fault — exit 2, message beginning "Configuration is invalid" —
// which would blame the caller's config for a defect in this repository's own
// output.
const validated = <Envelope>(
  schema: ZodType<Envelope>,
  value: Envelope,
  envelopeName: string
): Envelope => {
  const parsed = schema.safeParse(value)

  if (parsed.success) {
    return parsed.data
  }

  throw createStructuredError({
    code: CLI_ENVELOPE_INVALID_CODE,
    message: describeViolation(envelopeName, parsed.error.issues),
    category: 'internal'
  })
}

/** `review`'s stdout document, validated. */
export const reviewStdout = (
  envelope: ReviewStdoutEnvelope
): ReviewStdoutEnvelope =>
  validated(ReviewStdoutEnvelopeSchema, envelope, 'review stdout')

/** `baseline write`'s stdout document, validated. */
export const baselineWriteStdout = (
  envelope: BaselineWriteStdoutEnvelope
): BaselineWriteStdoutEnvelope =>
  validated(
    BaselineWriteStdoutEnvelopeSchema,
    envelope,
    'baseline write stdout'
  )

/** The stderr error envelope, validated. Failure path: never raises. */
export const cliError = (envelope: CliErrorEnvelope): CliErrorEnvelope => {
  const parsed = CliErrorEnvelopeSchema.safeParse(envelope)

  return parsed.success
    ? parsed.data
    : {
        code: CLI_ENVELOPE_INVALID_CODE,
        message: describeViolation('CLI error', parsed.error.issues)
      }
}

/**
 * The `error.json` a failed run leaves in its run directory, validated. Failure
 * path: never raises.
 *
 * It is written last in the partial-artifact set, from inside `review`'s catch,
 * and the run's real failure is reported on stderr by the same catch. So the
 * degraded document loses nothing a reader cannot recover — and it stays a
 * readable `error.json`, which is what the run directory promises to hold.
 */
export const runErrorArtifact = (
  artifact: RunErrorArtifact
): RunErrorArtifact => {
  const parsed = RunErrorArtifactSchema.safeParse(artifact)

  return parsed.success
    ? parsed.data
    : {
        code: CLI_ENVELOPE_INVALID_CODE,
        message: `${describeViolation('run error artifact', parsed.error.issues)}. The failure this run ended with is reported on stderr.`,
        category: 'internal',
        recoverable: false
      }
}
