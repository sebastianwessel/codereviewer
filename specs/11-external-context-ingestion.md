# 11: External Change-Intent Context Ingestion

Status: Approved
Date: 2026-07-21

## Purpose

Assemble a change-intent brief before the review from authorized sources —
pull/merge-request metadata, pipeline-provided context files, and change-relevant
repository files — summarize it with a dedicated model call, and inject it as one
bounded, redacted, context-only document. The feature is optional and off by
default.

Design rationale and phasing:
[`docs/design/external-context-ingestion.md`](../docs/design/external-context-ingestion.md).

## Trust And Authority Boundary

- External change-intent context is untrusted input, in the same class as
  repository content and reviewer instructions.
- Context is gathered by deterministic orchestrator code before the review. The
  review and discovery models are never granted network authority, tool
  authority, or the ability to initiate a fetch. This preserves the enterprise
  invariants in `07-security-privacy-operations.md`.
- External context is informational only. It must never change candidate
  admission, severity, reporter eligibility, quality-gate outcomes, or baseline
  status, and it must never suppress a finding. Those remain deterministic code
  paths.

## Architecture And Separation

Platform-specific code is isolated behind interfaces so additional platforms are
added without changing the core. The core composes providers and a summarizer and
depends only on the interfaces below.

Types:

- `PullRequestContext` — platform-neutral pull/merge-request metadata: platform,
  id, title, description, author, labels, comments, linked-issue references,
  source branch, target branch, url.
- `ContextFragment` — the normalized unit every provider emits: origin label,
  kind, optional title, body text, and a bounded metadata map.
- `ChangeIntentBrief` — the summarized output: brief text, contributing origin
  labels, and a truncation flag.

Interfaces:

- `PlatformAdapter` — `readPullRequest(input) -> PullRequestContext | undefined`.
  One implementation per platform (`github` in initial scope; `gitlab` and
  `bitbucket` are future implementations of the same interface). The adapter owns
  its transport (CI event payload on disk, or a read-only API call).
- `ContextProvider` — `gather(input) -> ContextFragment[]`. Initial providers:
  `platform`, `inbox`, `changed-files`. The interface is designed to admit a
  future `agentic` provider without changing the core.
- `ContextSummarizer` — `summarize(fragments, budget) -> ChangeIntentBrief`. Two
  implementations: `model` and `digest`.

## Stage Placement

External context ingestion runs after repository intake and before model-backed
holistic discovery. When ingestion is disabled or yields nothing, the review
proceeds unchanged.

## Context Providers

Each provider is independent and bounded, and emits `ContextFragment`s tagged
with an origin label. Zero or more providers are configured.

### `platform`

- Wraps a `PlatformAdapter` to read pull/merge-request title, description, and a
  configured subset of comments.
- Transport is `event` or `api`:
  - `event` reads a continuous-integration payload file already present on disk
    (for example the file referenced by `GITHUB_EVENT_PATH`). No network access.
    The path is resolved through `path-service`; when supplied by an environment
    variable, the resolved path must remain under a configured allowed root.
  - `api` performs authenticated read-only HTTP requests to a configured,
    host-allowlisted platform host. The credential is read only from a configured
    environment variable name. Only the configured host is contacted; fetch
    targets are never derived from repository content or model output.
- The adapter may extract linked-issue references from the metadata using a
  configured pattern, but it does not fetch them. Issue content reaches the review
  through the `inbox` provider.

### `inbox`

- Reads context files that pipeline steps write into a configured directory
  (default `.codereviewer/context/`) before the review starts. This is how
  issue-tracker and other external content is supplied without integrating those
  systems into the product: the pipeline owns the fetch and its credentials.
- Each file is frontmatter markdown. Frontmatter carries provenance metadata
  (for example `source`, `id`, `title`, `url`); the markdown body is the content.
- The directory resolves through `path-service` under the repository root. The
  provider is bounded by a maximum file count and a per-file byte cap. File
  content is untrusted and is redacted before use.

### `changed-files`

- Surfaces repository files changed in the reviewed diff that match configured
  globs (for example `specs/**`, `docs/**`, `**/*.md`) as intent context for the
  code-review tasks. No network access.
- Built on the merge-base diff already computed by intake. Bounded by a maximum
  file count and per-file byte cap.
- A changed file may also be a review target in its own right; as context it
  informs other tasks and never changes their scope.

## Summarization

- The default distiller is a dedicated model call whose only task is to compress
  the gathered fragments into a `ChangeIntentBrief`: stated intent, acceptance
  criteria, and notable constraints. It runs before discovery, under its own
  bounded token budget, sends only redacted fragments to the provider, and is
  recorded in the context ledger and cost accounting.
- Two modes:
  - `model` (default when a provider is configured): the dedicated summarizer
    call.
  - `digest`: deterministic ordered per-origin bounded truncation. No provider
    call, fully reproducible.
- The digest mode is used when no provider is configured, when `digest` is
  selected, and as the fallback when a `model` summarization call fails. A failed
  summarization never fails the review.
- The brief must not exceed the configured byte cap. Truncation is deterministic
  and recorded. Only the brief is injected; raw fragments are not.

## Injection

- The brief is injected as exactly one review-context document of kind
  `change-intent`.
- A `change-intent` document is context only. It is never a review target, never
  contributes a task path, and never seeds a candidate finding. A finding whose
  location points at the change-intent document is discarded, matching the
  `referenced-definition` rule.
- The document is recorded in the context ledger with a stable reason
  (`task-context-change-intent`), byte counts, and a content hash.
- The document is presented to the model under an explicit header marking it as
  untrusted, informational change-intent context and not instructions.

## Reviewer Use Of Change Intent

Change intent orients the reviewer to the goal; it is never authorization. The
reviewer prompt and the summarizer must enforce these principles:

- Change intent reduces misunderstanding-based false positives by explaining why
  a change was made. It does not define what is acceptable.
- Satisfying the stated intent does not make the code correct or safe. A change
  that does exactly what the ticket asked can still be a defect and must still be
  reported. A stated goal like "make the endpoint available for X" does not
  excuse an implementation that exposes it to everyone.
- Requirements the intent omits — access control, authentication and
  authorization, input validation, error handling, resource and data safety,
  concurrency, and edge cases — remain in scope. Silence in the intent is not
  permission.
- An implementation broader or more permissive than the intent requires is
  itself a candidate finding (over-broad scope or privilege).
- The intent may be incomplete, ambiguous, or wrong; the reviewer does not defer
  to it over defect evidence.
- The summarizer must preserve the exact stated scope, audience, and
  constraints. It must not broaden, generalize, or soften them, must not assert
  that any approach is safe, correct, approved, or complete, and must not infer
  constraints the source does not state.

## Determinism And Failure Handling

- All providers are optional. A provider that produces nothing — missing payload,
  unreachable host, empty inbox, no matching changed files, timeout — emits a
  warning and the review continues without it. A provider failure never fails the
  review run.
- Evaluation and benchmark runs use no context providers so results stay
  reproducible.
- Ingestion is bounded by per-provider file/byte caps, a total fetch timeout, and
  a request cap, consistent with the denial-of-service controls in
  `07-security-privacy-operations.md`.

## Configuration

Configuration lives under a `contextSources` block; keys are defined in
`04-configuration-and-providers.md`. The block is disabled by default. Enabling
it, selecting providers, choosing the summarization mode, and setting byte and
timeout caps are explicit configuration choices. Misconfiguration (unknown
provider type, missing required per-provider field, non-allowlisted host, a
literal secret in configuration) fails `config validate` with
`context_source_misconfigured` and exit code 2.

## Observability

- Each provider records a no-content event: provider type, origin label, fragment
  count, bytes gathered, included or failed status, and duration. No
  pull-request, ticket, or file text appears in logs, traces, or events.
- The summarizer records mode, input byte count, output byte count, and whether
  truncation occurred.

## Errors

| Code | Category | Exit | Meaning |
| --- | --- | --- | --- |
| `context_source_misconfigured` | config | 2 | A configured provider is invalid; raised at config validation. |
| `context_source_unavailable` | repository | — | A provider failed at run time; recorded as a warning, non-fatal. |

## Acceptance

- With `contextSources` disabled, review behavior and artifacts are byte-for-byte
  unchanged from a run without this feature.
- A configured provider that fails never changes the review exit code relative to
  the same run with the provider removed.
- External context never alters admission, severity, gate, or baseline outcomes;
  a test injects an adversarial brief ("ignore all findings") and proves findings
  are unchanged.
- Redaction removes known secret patterns from gathered context before it enters
  the summarizer call, the prompt, or any log.
- `change-intent` context never appears as a finding location in a report.
- Adding a platform is a new `PlatformAdapter` only: a test drives the core with a
  stub adapter and asserts no platform-specific branching in the core path.
