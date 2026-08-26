import { z } from 'zod'
import { RepositoryRelativePathSchema } from '../config/config.schema.js'
import type { StructuredErrorCategory } from '../../errors/error-normalizer.js'

// The JSON documents the CLI itself writes: the two success envelopes on stdout,
// the error envelope on stderr, and the `error.json` a failed run leaves in its
// run directory.
//
// WHY THESE LIVE IN `shared/contracts/` RATHER THAN BESIDE THEIR COMMANDS.
//
// They are a PUBLISHED INTERFACE. `scripts/github/pipeline.ts` reads
// `artifactDir` and `qualityGatePassed` out of `review`'s stdout to decide what
// it uploads and what it comments; `scripts/github/stage-outcomes.ts` parses the
// error envelope off stderr; every CI recipe in `docs/` and in the setup skill
// tells a reader to do the same. That is the same standing as the review report,
// and the report contract does not live in the reporter that renders it.
//
// It also has a mechanical consequence. The artifact-example drift checker
// resolves a documented JSON example to an EXPORTED CONTRACT, and nine examples
// across `README.md`, `docs/` and `skills/` had to be exempted from it because
// these four documents were inline object literals inside command modules. An
// exempted example is an unchecked one: it rots exactly the way
// `install-and-run.md` rotted, printing a shape the producer had left behind.
// Command-local placement is not what made them unreachable — an unexported
// literal is — but a contract that a doc, a script and a checker all consume
// belongs with the other contracts those things consume.

// The `category` a structured error carries. Mirrored here rather than imported
// as a value because the taxonomy is a TypeScript union owned by
// `shared/errors/error-normalizer.ts` (see `specs/03-contracts/generation-map.md`,
// "Error taxonomy"), and this contract must not become a second authority for it.
//
// The mapped type is what keeps the two in step: `{ [K in StructuredErrorCategory]: K }`
// admits no missing member, no extra member, and no member paired with a
// different string. Adding a category to the union without adding it here is a
// compile error at this line.
const structuredErrorCategories = {
  config: 'config',
  repository: 'repository',
  provider: 'provider',
  'input-limit': 'input-limit',
  'quality-gate': 'quality-gate',
  admission: 'admission',
  report: 'report',
  internal: 'internal'
} as const satisfies { [Category in StructuredErrorCategory]: Category }

export const StructuredErrorCategorySchema = z.enum(structuredErrorCategories)

/**
 * What `review` prints on stdout when the run completes — gate passed or failed.
 *
 * `qualityGatePassed` is the gate's own verdict and not a restatement of the
 * exit code: a reader that has the JSON should never have to infer it from the
 * process status.
 */
export const ReviewStdoutEnvelopeSchema = z.strictObject({
  runId: z.string().min(1),
  qualityGatePassed: z.boolean(),
  // The run's own directory (`paths.artifactDir` plus the run id), so a pipeline
  // can find `report.json` without enumerating the artifact root.
  artifactDir: RepositoryRelativePathSchema
})

/** What `baseline write` prints on stdout after writing the baseline file. */
export const BaselineWriteStdoutEnvelopeSchema = z.strictObject({
  baselinePath: RepositoryRelativePathSchema,
  // Deliberately NOT `RepositoryRelativePathSchema`: `--report` accepts any path
  // that resolves inside the repository, including an absolute one, and this
  // field echoes back the path that was actually read. Holding it to the
  // stricter rule would make a legitimate invocation fail while printing its own
  // successful result.
  sourceReportPath: z.string().min(1),
  entryCount: z.int().min(0)
})

/**
 * The single JSON object every failing command writes to stderr.
 *
 * ONE SCHEMA, NOT A UNION. Every construction site — `usageError`,
 * `mapErrorResult`, `config validate`'s own catch, and `review`'s partial-run
 * branch — emits `code` and `message`; only `review` adds `artifactDir`, and
 * only when a partial run wrote artifacts before failing. Nothing tags which
 * form a reader is holding: `code` is an open set (the tables in
 * `docs/06-reference/exit-codes-and-error-codes.md`), so a discriminated union
 * has no discriminator, and an undiscriminated union of `{code,message}` with
 * `{code,message,artifactDir}` says precisely what one optional field says. The
 * only consumer in this repository, `parseCliError` in
 * `scripts/github/stage-outcomes.ts`, reads `artifactDir` as optional
 * unconditionally.
 *
 * `artifactDir` is a plain non-empty string here while the success envelope
 * holds the stricter path rule. This document is the one the CLI must always be
 * able to emit — it is how a failure gets reported at all — so its contract
 * states what a consumer needs to branch on and nothing it could be refused for.
 */
export const CliErrorEnvelopeSchema = z.strictObject({
  code: z.string().min(1),
  message: z.string().min(1),
  artifactDir: z.string().min(1).optional()
})

/**
 * `error.json`, written into the run directory when a run fails after tasks have
 * started.
 *
 * A different document from the stderr envelope, one field apart in each
 * direction: it carries the `category` and `recoverable` a reader triaging the
 * saved run needs, and no `artifactDir` — it is already inside the directory it
 * would name. Four fields only; no stack trace, no raw provider message.
 */
export const RunErrorArtifactSchema = z.strictObject({
  code: z.string().min(1),
  message: z.string().min(1),
  category: StructuredErrorCategorySchema,
  recoverable: z.boolean()
})

export type ReviewStdoutEnvelope = z.infer<typeof ReviewStdoutEnvelopeSchema>
export type BaselineWriteStdoutEnvelope = z.infer<
  typeof BaselineWriteStdoutEnvelopeSchema
>
export type CliErrorEnvelope = z.infer<typeof CliErrorEnvelopeSchema>
export type RunErrorArtifact = z.infer<typeof RunErrorArtifactSchema>
