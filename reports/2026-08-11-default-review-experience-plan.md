# Plan: make the defaults be the product

Date: 2026-08-11. Status: **plan, approved in direction by the product owner.**

## The gap, stated precisely

The product this engine is for is a reviewer that reads what the change is *for*,
finds defects in it, says what it might break, and answers whether the change did
what it set out to do — as one comment a human reads, with an inline note and a
suggested edit on each defect.

**All of that is built. Almost none of it is on by default.**

| Capability | Config key | CLI default | GitHub pipeline config |
| --- | --- | --- | --- |
| PR/ticket context | `contextSources.enabled` | `false` | `true` |
| Impact on existing code | `changeImpact.enabled` | `false` | `true` |
| Did it achieve its goal | `intentFulfilment.enabled` | `false` | `true` |
| Inline comments | `reporting.reviewComments.enabled` | `false` | `true` |
| Apply-checked fixes | `fix.enabled` | `false` | `false` |

So `codereviewer review` out of the box is a defect finder, and the product only
appears if you run it through `scripts/github/` with the config that ships beside
it. The defaults describe a narrower tool than the one that exists.

**That is the whole problem, and it is a defaults problem, not a missing-feature
problem.** Four flags and one correctness fix close it.

## Decision 1 — which defaults flip, and which must not

Flipping a default is a product decision. It is NOT an accuracy claim, and none is
made here. The discipline that applies is the one that already governs this
repository: a capability measured and rejected stays off, whatever the product
would prefer.

### Flip ON

| Key | Why | Accuracy claim |
| --- | --- | --- |
| `contextSources.enabled` | The input the whole flow depends on: without it there is no intent to check the change against, and the reviewer works blind to purpose | **None. See the caveat below — this one is accuracy-relevant and unmeasured** |
| `changeImpact.enabled` | Deterministic reference traversal; the "what might this break" half | None. Deterministic, its own deliverable |
| `intentFulfilment.enabled` | The "did it do what it set out to" half, measured repeatedly (2026-07-30 through 08-02) | None claimed for review recall; it is a separate deliverable |
| `reporting.reviewComments.enabled` | The delivery mechanism for per-issue inline notes. A renderer, not a lever | None |

**The caveat that must not be lost.** `contextSources` feeds the change-intent
brief into discovery's packet. That changes what the reviewer is shown, so it can
move recall in either direction and **nobody has measured it**. It is flipped on
because it is the product, not because it helps — and the intent-framing prompt
clause was separately measured and REJECTED, which is a reason for humility here
rather than confidence. The measurement that would settle it is named under
*Measurement owed*.

### Stay OFF, each for a recorded reason

| Key | Why it stays off |
| --- | --- |
| `review.signalFacts` | **Measured null** (2026-08-10): recall 64.9% → 61.7%, sign test 3/3, p = 1.0 |
| `changeImpact.adjudication` | **Measured and rejected** (2026-08-09): 0/7 against a pre-registered 40% bar |
| `security.dedicatedPass` | Mixed and unproven at n=1, **+61% cost**, and the security lift it exists for was not shown |
| `verification.enabled` | A different product (external claims), and `eval run` cannot score it — needs its own corpus first |
| `fix.enabled` | Unmeasured, and costs one agent run per eligible finding. **Decision 2 removes the safety argument for enabling it**, leaving it a quality upgrade to be decided on evidence |
| `reviewConversation.enabled` | Unmeasured, and needs a separate workflow trigger and write permission. One-line opt-in, documented |
| `skills.enabled` | Operator content that does not exist by default; never measured |
| `observability.openTelemetry` | Emits no spans; enabling it exports nothing |

## Decision 2 — a suggestion must be apply-checked before a human is offered one click

**This is a correctness defect, and it is the most important item here.**

The ` ```suggestion ` block GitHub renders carries a one-click *Apply*. Today its
content comes from the **refuter** (`fixSummary` / `fixEdits`), and nothing
verifies those edits still fit the file. The deterministic apply-check that exists
to catch exactly this — hallucinated line numbers, stale locations, overlapping
edits — lives in the fix lane, which is off. So the engine offers a human a
one-click apply of an edit no code has checked.

`applyFixEdits` (`src/domains/verification/apply-check.ts`) is **pure,
deterministic and model-free**: it takes current file bytes and edits, and reports
whether the set applies cleanly. It does not need the fix lane, an agent, or a
provider.

**Therefore: render a suggestion block only for edits that pass the apply-check
against current bytes.** A failing set drops the suggestion and keeps the comment's
prose. Costs nothing, needs no flag, and makes the fix lane an upgrade rather than
a prerequisite for safety.

Consequence worth stating: this may reduce how often a suggestion appears. That is
correct — the alternative is offering more suggestions that do not apply.

## Decision 3 — the comment is written for a human

The summary comment currently carries, outside any collapsed block: a
`| Stage | Role | Result |` pipeline table, the engine's own measured error rates,
refutation vocabulary (*"Survived refutation — proved: …"*), and a heading reading
*"Unresolved - Needs Human Decision"*. A human reviewer writes none of that.

Restructure **by placement, not deletion**:

- **Top, in plain language:** the verdict, what the change was for and whether it
  got there, what it might affect, then the findings.
- **Inside `<details>`:** the stage table, reliability rates, refutation status,
  run details.

**One standing decision constrains this and is not being reversed:** published
rates must name the model they were measured on, and there is a test defending it
because that text once drifted stale. So one short plain-language sentence about
confidence stays at the top, and the numbers move into the collapsed block. That
keeps the guarantee and gets the human surface.

Section renames: *"Unresolved - Needs Human Decision"* → *"Worth a look"*;
*"Survived refutation — proved"* → drop from the top level entirely.

## Decision 4 — easy by default, customizable properly

The test of "easy" is that **`scripts/github/codereviewer.github.json` shrinks to
almost nothing**, because the defaults already say what it says. What must remain
there is only what is genuinely deployment-specific: the SARIF target, the comment
platform, and the context provider paths.

`contextSources` must therefore default to a provider set that **no-ops silently
when its inputs are absent** — an inbox directory that does not exist is a review
with no intent brief, not an error. That property is what makes zero-config work.

Customization stays exactly where it is: one key per capability, strict schema,
every key documented in `docs/06-reference/configuration/`. No profile or preset
layer is introduced — it would add a concept to dodge four booleans.

## What this costs, stated honestly

Enabling impact and intent adds model calls to every default run. **I do not have
a measured per-PR cost for them and will not estimate one.** The one-process change
measured only their I/O (git subprocesses 6→4, file reads 14→7). Measuring the
default run's cost is listed below and should be done before this is called cheap.

## What is NOT claimed

- No recall or precision improvement. Nothing here was measured as a quality lever.
- No claim that the fix lane works — it remains unmeasured, and Decision 2 exists
  so that its absence is not a safety hole.
- No claim that change-intent context helps the review. It is unmeasured and could
  hurt.

## Measurement owed, in priority order

1. **Change-intent context as a recall lever.** The one accuracy-relevant flip.
   Pre-registered A/B, `contextSources` on vs off, on the security corpus.
2. **Cost of the default run**, per pull request, cold and warm.
3. **Suggestion yield.** How often a finding carries an apply-checked suggestion
   with the fix lane off versus on. This is also the fix lane's first real
   measurement, whose plan spec 12 now carries.

## Execution waves

Waves 1–3 touch disjoint files and run in parallel; wave 4 depends on all of them.

- **Wave 1 — defaults.** Config schema defaults, shrink the shipped GitHub config,
  make `contextSources` no-op cleanly when its inputs are missing, config tests.
- **Wave 2 — apply-checked suggestions.** Decision 2, in the reporting domain,
  with tests for both directions (a clean set survives, a stale set is dropped and
  the prose kept).
- **Wave 3 — human-facing comment.** Decision 3 in `scripts/github/`.
- **Wave 4 — alignment and cleanup.** Specs 05/12/22/23, the capability inventory,
  `docs/03-concepts/optional-capabilities/`, `docs/06-reference/configuration/`,
  the getting-started pages, and the shipped workflow. Plus a dead-config sweep:
  any key the shrunk GitHub config no longer needs.
