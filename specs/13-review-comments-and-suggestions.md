# 13: Platform-Neutral Review Comments And Suggestions

Status: Approved
Date: 2026-07-23
Amended: 2026-08-03 — the comment body carries its proof (see *Amendment* below)

## Amendment (2026-08-03): the comment body carries its proof

The original body was **severity, category, title, description, finding id, and
the fix summary**. Every one of those is the engine's own claim about itself.
Nothing in the comment let a reviewer check any of it, so an inline comment could
only be believed or ignored — and it is the surface most reviewers actually read,
because it sits in the diff next to the code while `report.md` sits in an
artifact directory.

**What forced it is a rendering property, not a new measurement.** With no
verdict line at all, a finding that survived a full refutation and a finding that
was never adjudicated produced **byte-identical comment bodies**. The distinction
existed in the report the whole time — the finding carries `refutationId` and
`evidenceIds` — and the comment discarded it. That is reproduced deterministically
in `review-comments.test.ts` ("says a missing verdict is missing instead of
omitting the line"); no provider run was needed to establish it and none was made.

Two standing measurements say what that costs. On the 37-case real-repository
corpus with the engine pinned, adjusted precision is 95-99%: roughly one comment
in twenty is wrong, so a reviewer who cannot check one is being asked to act on a
claim that fails at a known rate. And `report.md` plus the pull-request summary
comment were both given a checkable proof in `d9d98b6`; that commit recorded this
surface as the one remaining hole and did not close it, because this spec
enumerated the body fields and widening them is a spec change.

### What the body must now carry

Additional to the fields above, in this order — title, description, proof, fix
summary, finding id:

- **The refutation verdict and the refuter's one-sentence summary**, when one is
  recorded against the finding. It is bounded, not full: `report.md` prints every
  check and every evidence record because a reader who opened it came to audit,
  while a reader meeting this comment in a diff has a line or two of attention.
- **An explicit statement when no verdict was recorded.** The line MUST NOT be
  omitted in that case, and its wording MUST differ from the wording used for an
  unresolved finding — "nothing was recorded" and "the refuter could not decide"
  are different facts, and a reader who cannot tell them apart cannot weigh
  either.
- **The addresses the finding rests on**: the cited evidence records as
  `kind at path:line`, at most **three**, with the remainder pointed at the run
  report. An evidence id with no record in the report MUST be named as such
  rather than dropped — a hole a reader can see beats one they cannot.

### Findings An Earlier Push Carried

The pull request's own inline comments hold each finding's fingerprint in a hidden
marker, so what the previous push reported is readable from the pull request itself.
A run compares that set against its own findings and states how many are **no longer
reported**.

Three requirements, and the first two are the reason this is worth stating at all:

- **The comparison MUST be made even when the run has nothing to post.** The case it
  exists for is precisely the run with no findings — the author fixed everything —
  and fetching prior comments only when there is something to write would skip it.
- **It MUST NOT be called resolved, fixed, or addressed.** Nothing here separates a
  repair from a miss: in-diff recall is about two thirds and two runs over one commit
  do not agree, so a finding can drop out with the code unchanged. The sentence says
  so, in the reader's own line of sight, not in a footnote.
- **An uncomputed comparison MUST be absent, never zero.** No API access and no
  inline posting means the question was not asked, which is a different fact from
  asking it and finding nothing.

This requires the fingerprint to survive a push, which it did not until
`v3-category-path-anchor` — see `specs/03-contracts/finding-evidence-report.md`.

### What the body must NOT carry

**The run-level reliability rates.** They are stated once per review, in the
summary comment on the same pull request, and repeating them on every inline
comment is wrong twice over: the rates are mostly about what SILENCE means
(recall), and a comment that exists raises no question about silence; and an
aggregate printed beside one finding reads as that finding's probability, which
is not what an aggregate says. The per-finding verdict and evidence this
amendment adds are strictly stronger for a reader holding one comment — something
to check instead of a base rate to apply.

### Consequences for the caps

The body cap is unchanged at 3 000 characters, but it may no longer be applied as
a blind tail truncation: the proof follows the description, so cutting from the
end would strip the proof off precisely the findings with the most to say. The
description is therefore the only elastic field — every other prose field has a
fixed cap, applied to the RENDERED text (escaping can grow a string severalfold,
so a cap on the raw field does not bound what the reader gets) and cut so it can
never end inside a Markdown escape or an HTML entity.

Renderers are unaffected: the proof is assembled once in the neutral layer, and a
platform renderer still only turns the structured suggestion into native syntax.

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

## Which Findings Become Drafts

A draft is built for every admitted finding that admission marked
`reporterEligibility = inline` and whose location is not on the old side.
Whether a location can be anchored at all is decided once, in admission, which
is the only stage that holds the reviewed diff ranges (see
[05-review-workflow-and-runtime.md](05-review-workflow-and-runtime.md)). The
comment layer must not re-derive it from `location.side`.

This is a correction, not a restatement: until this rule was written, the neutral
layer additionally required `location.side = "new"`, while discovery stamps every
model-origin finding `side = "file"`. The two rules could not both hold, so this
surface produced zero drafts for model-origin findings on every run since it
shipped, even though each layer's own tests passed on hand-written new-side
fixtures. Tests for this spec must therefore start from a finding in the shape
discovery actually produces.

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
- `body` — redacted, Markdown-escaped comment text: severity, category, title,
  description, the proof (refutation verdict and cited evidence addresses, per
  the *Amendment* above), the fix summary when present, and the finding id.
- `suggestion` — optional `{ replacement }`: the structured replacement for
  `targetRange`. Present only when a single admitted fix edit maps exactly to
  `targetRange` (the eligibility rules below). Never a pre-rendered fenced block.
- `findingId`, `severity`, `category` — carried from the finding.

Suggestion eligibility, in the neutral layer: exactly one fix edit,
`fixProposal.safety` is `manual-review`, the edit path and line range match
`targetRange` exactly, and the replacement contains no triple-backtick fence.
When any of those fails, the fix could never be a suggestion and the draft
carries the prose fix summary alone.

Fitting the body cap is NOT one of those checks, and must not be treated as one.
Eligibility asks whether the fix can be represented; fitting is a budgeting
question, and answering it as eligibility made the suggestion the thing that
lost. The body's only elastic part is the description, which is sized LAST —
after the title, the proof, the fix summary, and the room the suggestion block
will need. A long description therefore costs itself and never the fix. Before
this reservation existed the description absorbed the whole remaining budget, the
body landed at the cap, and the apply-ready replacement was dropped for every
platform on any finding with a long description.

When a replacement is too large to carry even with the reservation, the draft
omits `suggestion` and the body MUST say that a concrete replacement was computed
and where it is recorded — the finding's `fixProposal.edits` in `report.json`,
because a draft that dropped its suggestion carries none in
`review-comments.json` either. Silence is forbidden here: the body already reads
"Suggested fix: <summary>", which tells the reader a fix exists, so saying
nothing tells them one exists and gives them no way to reach it.

The caps are contract constants, not configuration: a body is at most **3 000**
characters and a `replacement` at most **4 000**. The replacement bound is
deliberately the larger of the two — it bounds the structured field a platform
applies directly, while the body bound governs the rendered comment.

### PlatformTarget

`github | gitlab | bitbucket | generic`.

## Platform Detection

The target platform is resolved in this order, first match wins:

1. `reporting.reviewComments.platform`, when the user sets it explicitly.
2. CI environment signal: `GITHUB_ACTIONS` → `github`; `GITLAB_CI` → `gitlab`;
   `BITBUCKET_PIPELINE_UUID` (or `BITBUCKET_WORKSPACE`) → `bitbucket`.
3. The `origin` remote host: `github.com` → `github`; `gitlab.com` and any host
   whose name starts with `gitlab.` (the self-managed convention) → `gitlab`;
   `bitbucket.org` → `bitbucket`.
4. `generic` when nothing matches.

A CI environment variable present but set to the empty string, `false`, or `0` is
**not** a signal, so an unset-but-declared variable cannot mis-detect the platform.

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

The inherited cap can still bind in a renderer, because the neutral layer sizes
the body against the canonical ` ```suggestion ` fence while GitLab's fence
carries an offset suffix (` ```suggestion:-x+y `). A draft that fits for GitHub
can therefore overflow on GitLab. When a renderer cannot fit the suggestion
block, it must not drop it silently: the body already states the prose fix
summary, so silence tells the reader a fix exists while hiding that a concrete,
apply-ready replacement was computed for those exact lines. The body instead
carries one sentence stating that a ready-to-apply replacement was computed, does
not fit this platform's comment size limit, and is recorded in full in
`review-comments.json`. Room for that sentence is made by trimming the prose with
the truncation mark — never by dropping the sentence — since the untrimmed body
survives verbatim in `review-comments.json` and the finding id is a field on the
rendered record.

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

Concretely: a `review_comments` step carrying `draftCount`, `suggestionCount`,
`platform`, and `platformDetectedFrom` (`config | ci-env | remote | default`,
naming which rule in *Platform Detection* decided it). It is emitted **only when
the feature is enabled** — the step means "drafting ran", and reporting zero drafts
for a feature that is off would say it ran and found nothing.

Drafting happens in the artifact stage, after the run's event recorder has closed,
so the step is timed there and joins the run's `observability.json` through the
same no-content sanitizer as every other event. The counts come from the drafts
that were actually written; they are not recomputed, so the reported number cannot
drift from the artifact.

This requirement was unmet until 2026-08-06: nothing was emitted, and the artifact
writer read the resolved detection `source` only to discard it, so a run that
resolved `generic` and produced zero drafts was indistinguishable from one where
the feature never ran.

## Testing

- Unit: neutral draft assembly and suggestion eligibility; each renderer's
  platform syntax against fixtures; platform detection precedence (env over
  remote over generic) and explicit override.
- Snapshot: rendered output excludes raw source beyond the redacted,
  eligibility-checked replacement, and never emits an unterminated fence.
- Proof (2026-08-03 amendment): a finding with a recorded verdict and one without
  do not render the same body; a missing evidence record is named; the citation
  list is capped and the remainder pointed at the report; and a description that
  fills the cap loses its own tail rather than the proof.

## Acceptance

- A model-origin admitted finding whose reported line falls inside a reviewed
  diff hunk, and which meets the inline severity threshold, yields a draft on
  every platform.
- Fix suggestions render natively for the resolved platform, and as a neutral
  artifact for every enabled run.
- Detection resolves from CI env, then remote host, then `generic`, and an
  explicit `platform` overrides it.
- The core issues no network request and publishes nothing.
- A replacement containing a code fence, or an edit that does not map exactly to
  the comment range, yields a prose summary and no suggestion block.
- Every draft states what its finding survived, or that no verdict was recorded
  against it, and the addresses it rests on — on every platform, because the
  proof is assembled once in the neutral layer.
