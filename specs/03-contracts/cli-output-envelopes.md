# 03: CLI Output Envelopes

Status: Approved
Date: 2026-08-13

## Contract Source Rule

The four documents the CLI itself writes are contracts, not command-local
detail. Implementation must define them as Zod schemas in
`src/shared/contracts/cli/cli-output.schema.ts`, infer their TypeScript types
from those schemas, and validate every document against its schema **before**
rendering it. A producer that only satisfies the type is not sufficient; see
"Parse, not type" below.

## Why These Are Contracts

They are a published interface. `scripts/github/pipeline.ts` reads `artifactDir`
and `qualityGatePassed` out of `review`'s stdout to decide what it uploads and
comments; `scripts/github/stage-outcomes.ts` parses the error envelope off
stderr; the CI recipes in `docs/04-guides/ci-cd.md` and in the setup skill tell
readers to do the same. Nine documented examples of these four shapes were
exempt from the artifact-example drift check for want of an exported contract to
check them against — the same gap that let `install-and-run.md` document a report
version its producer had left behind.

## The Envelopes

### `review` stdout — `ReviewStdoutEnvelope`

Written on completion, gate passed or failed. Exit `1` when
`qualityGatePassed` is `false`.

| Field | Type | Rule |
| --- | --- | --- |
| `runId` | string | Non-empty. The run's id, matching `run.runId` in `report.json`. |
| `qualityGatePassed` | boolean | The gate's own verdict, so a reader holding the JSON never has to infer it from the process status. |
| `artifactDir` | string | Repository-relative: `paths.artifactDir` joined with `runId`. |

```json review-stdout
{
  "runId": "…",
  "qualityGatePassed": true,
  "artifactDir": ".codereviewer/runs/<runId>"
}
```

### `baseline write` stdout — `BaselineWriteStdoutEnvelope`

| Field | Type | Rule |
| --- | --- | --- |
| `baselinePath` | string | Repository-relative; the configured `baseline.path` that was written. |
| `sourceReportPath` | string | Non-empty. The report the baseline was built from. Deliberately **not** held to the repository-relative rule: `--report` accepts any path that resolves inside the repository, including an absolute one, and this field echoes back what was read. |
| `entryCount` | integer | `>= 0`. Entries written to the baseline file. |

```json baseline-write-stdout
{ "baselinePath": "…", "sourceReportPath": "…", "entryCount": 0 }
```

### stderr error envelope — `CliErrorEnvelope`

One schema, not a union. Every construction site — `usageError`,
`mapErrorResult`, `config validate`'s own catch, and `review`'s partial-run
branch — emits `code` and `message`; only `review` adds `artifactDir`, and only
when a partial run wrote artifacts before failing. Nothing tags which form a
reader holds: `code` is an open set (`docs/06-reference/exit-codes-and-error-codes.md`),
so a discriminated union has no discriminator, and an undiscriminated union of
`{code,message}` with `{code,message,artifactDir}` states exactly what one
optional field states.

| Field | Type | Rule |
| --- | --- | --- |
| `code` | string | Non-empty structured error code. |
| `message` | string | Non-empty, redacted. |
| `artifactDir` | string? | Present only when partial artifacts were written. Non-empty; **not** held to the repository-relative rule, because this document is how a failure gets reported at all and its contract must state what a consumer branches on and nothing it could be refused for. |

```json cli-error
{ "code": "…", "message": "…" }
```

### `error.json` — `RunErrorArtifact`

Written into the run directory when a run fails after tasks have started. A
different document from the stderr envelope, one field apart in each direction:
it carries the triage fields and no `artifactDir`, being already inside the
directory it would name.

| Field | Type | Rule |
| --- | --- | --- |
| `code` | string | Non-empty. |
| `message` | string | Non-empty, redacted. No stack trace, no raw provider message. |
| `category` | enum | A `StructuredErrorCategory`. Mirrored from `src/shared/errors/error-normalizer.ts` under a mapped type, so a category added to the union without being added to the contract is a compile error. |
| `recoverable` | boolean | Derived from the category by the error normalizer. |

```json run-error
{
  "code": "provider_context_length",
  "message": "…",
  "category": "provider",
  "recoverable": true
}
```

## Parse, Not Type

Producers validate at the boundary rather than relying on an annotated literal.
An annotation catches a rename; it cannot catch the three failures that actually
break a consumer of this JSON:

1. `JSON.stringify` drops a key whose value is `undefined`, so a field can leave
   the printed document at runtime with a green typecheck — a plausible-looking
   envelope with a missing `artifactDir`.
2. Value invariants the documentation states and consumers branch on: a
   non-empty `runId`, an `artifactDir` that really is repository-relative, an
   `entryCount` that is a whole non-negative number.
3. Excess-property checking applies only to fresh object literals, and two of
   the four envelopes are built from values that arrive from a domain module.

The cost is one parse of a three- or four-key object per command invocation.

A violation is reported as `cli_envelope_invalid`, and one rule decides how:

- **A builder on the success path raises**, as a structured `internal` error and
  therefore exit `5` — never as a configuration fault, which is what a raw
  `ZodError` reaching a command's catch would be classified as, blaming the
  caller's config for a defect in this engine.
- **A builder on the failure path never raises**, and reports the violation
  inside the document it was asked to build. The stderr envelope and `error.json`
  are both constructed from inside a catch, where a throw escapes as an unhandled
  rejection at exit `1` — the code reserved for a completed run whose gate
  failed, so a pipeline would be told the run finished cleanly. The channel that
  exists for reporting failures must stay able to report this one.

## Drift Control

- `src/shared/contracts/cli/cli-output.schema.test.ts` — a renamed, dropped or
  invented field is rejected.
- `src/cli/cli-envelopes.test.ts` — the validated builders, the classification of
  a violation, and the real dispatcher's output for the error paths.
- `src/cli/review-command.test.ts`, `src/cli/baseline-command.test.ts` — the
  stdout of a real run parsed against its contract.
- The artifact-example drift check walks every documented example of these four
  shapes, under the tags `review-stdout`, `baseline-write-stdout`, `cli-error`
  and `run-error`. This repository holds no exempted example.
