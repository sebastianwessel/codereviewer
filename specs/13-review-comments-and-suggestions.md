# 13: Platform-Neutral Review Comments And Suggestions

Status: Approved
Date: 2026-07-23

## Purpose

Emit inline review-comment drafts — including one-click fix suggestions — as a
neutral artifact the core owns, then render them into platform-specific forms
(GitHub, GitLab, Bitbucket, generic). The engine stays platform-neutral while
still producing native suggestion blocks for whichever platform a run targets.

The core writes neutral files and per-platform renderings only. It performs no
network call and publishes nothing; posting comments remains a downstream
pipeline step (spec 07, `CAP-PR-001`).

## Structure

Comment drafting is split in two:

- a **neutral** `ReviewCommentDraft` that carries a structured suggestion (the
  replacement text and target range), not a pre-rendered fenced block; and
- **platform renderers** that turn the neutral draft into GitHub, GitLab,
  Bitbucket, or generic output.

Every eligibility and safety rule is enforced once in the neutral layer and
inherited by every renderer, so a platform can only differ in syntax.

There is no platform-specific report format: the removed `github-review-comments`
format has no replacement value in the `ReportFormat` enum, and callers configure
`reporting.reviewComments` instead. Markdown and SARIF reports render fix
summaries and edits independently of this spec.

## Contracts

### ReviewCommentDraft

A strict schema under `src/shared/contracts/`:

- `path` — repository-relative path (new side).
- `targetRange` — `{ startLine, endLine }` on the new side the comment anchors
  to.
- `body` — redacted, Markdown-escaped comment text (severity, category, title,
  description, finding id, and the fix summary when present).
- `suggestion` — optional `{ replacement }`: the structured replacement for
  `targetRange`. Present only when a single admitted fix edit maps exactly to
  `targetRange` (the eligibility rules below). Never a pre-rendered fenced block.
- `findingId`, `severity`, `category` — carried from the finding.

Suggestion eligibility (unchanged from current behavior, moved into the neutral
layer): exactly one fix edit, `fixProposal.safety` is `manual-review`, the edit
path and line range match `targetRange` exactly, the replacement contains no
triple-backtick fence, and the rendered result fits the platform body cap. When
any check fails, the draft carries the prose fix summary but no `suggestion`.

### PlatformTarget

`github | gitlab | bitbucket | generic`.

## Platform Detection

The target platform is resolved in this order, first match wins:

1. `reporting.reviewComments.platform`, when the user sets it explicitly.
2. CI environment signal: `GITHUB_ACTIONS` → `github`; `GITLAB_CI` → `gitlab`;
   `BITBUCKET_PIPELINE_UUID` (or `BITBUCKET_WORKSPACE`) → `bitbucket`.
3. The `origin` remote host: `github.com` → `github`; `gitlab.com` (and
   self-managed hosts whose remote path matches the GitLab form) → `gitlab`;
   `bitbucket.org` → `bitbucket`.
4. `generic` when nothing matches.

Detection reads environment variables and the git remote only. It performs no
network request and calls no platform API, so it does not compromise platform
neutrality — detection is not integration.

## Renderers

Each renderer consumes the neutral draft and produces platform output:

- **GitHub** — a ` ```suggestion ` block with `side: RIGHT` and absolute
  `line` / `startLine` anchors.
- **GitLab** — an offset-anchored ` ```suggestion:-x+y ` block computed from the
  comment line and `targetRange`.
- **Bitbucket** — an inline comment with a fenced replacement block; Bitbucket
  has no one-click apply, so the suggestion degrades to a readable code block.
- **Generic** — a plain fenced replacement block with no apply affordance.

Renderers are pure and deterministic. Redaction, Markdown escaping, the
fence-breakout guard, and the body-length cap are enforced once in the neutral
layer and inherited by every renderer.

## Artifacts

- `review-comments.json` — the neutral drafts (structured suggestion). Written
  whenever the feature is enabled. This is the source of truth.
- `review-comments.<platform>.json` — the rendered drafts for the resolved
  platform (for example `review-comments.github.json`).

Both are local artifacts only; neither publishes.

## Configuration

A `reporting.reviewComments` block, keys defined in
[04-configuration-and-providers.md](04-configuration-and-providers.md):

- `enabled` — default `false`.
- `platform` — `github | gitlab | bitbucket | generic | auto`, default `auto`
  (run the detection order above). An explicit value overrides detection.

Invalid configuration fails validation with exit code `2`.

## Observability And Errors

- Building drafts records a no-content step: draft count, suggestion count, the
  resolved platform, and the detection source. No source, comment text, or
  replacement appears in logs, traces, or events.
- A run that resolves to `generic` (no platform detected) is normal, not an
  error.

## Testing

- Unit: neutral draft assembly and suggestion eligibility; each renderer's
  platform syntax against fixtures; platform detection precedence (env over
  remote over generic) and explicit override.
- Snapshot: rendered output excludes raw source beyond the redacted,
  eligibility-checked replacement, and never emits an unterminated fence.

## Acceptance

- Fix suggestions render natively for the resolved platform, and as a neutral
  artifact for every enabled run.
- Detection resolves from CI env, then remote host, then `generic`, and an
  explicit `platform` overrides it.
- The core issues no network request and publishes nothing.
- A replacement containing a code fence, or an edit that does not map exactly to
  the comment range, yields a prose summary and no suggestion block.
