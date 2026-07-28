# Change-impact candidates — NOT A CORPUS YET

Curated candidates for `specs/22-change-impact-review.md`. **Nothing here is
validated, hydrated, or runnable.** The schema that would validate it does not
exist yet; see the implementation plan's W1c
(`reports/2026-07-27-impact-and-fulfilment-implementation-plan.md`).

They live outside `real-repo-cross-file/` deliberately. That corpus enforces the
exact opposite invariant — every expectation must sit **inside** the reviewed
paths — while these are outside the diff by construction. Merging them would
require a mode flag on an invariant, and a schema whose central rule is
conditional enforces nothing.

## What is here

5 candidates, 7 expectations, from 66,685 commit bodies screened across 27
repositories. Each carries the upstream commit that **proves** the breakage
happened — a fix referencing the causing sha, a revert, or an issue naming the
caller-side symptom. A curator's inference that something might break was not
admissible, and one tempting near-miss was rejected on exactly that ground.

## Before any of these can be used

1. The corpus schema (W1c) — inverted path invariant, required `reachability`
   label, required `evidenceOfBreakage` discriminated union.
2. Hydration orientation support (G6) — these are **forward** diffs
   (`base = introducingCommit^`), not the reversed orientation spec 17 uses.
3. Adjudication of two disclosure flags recorded in the candidates file.
4. Resolution of the `low`-severity tension recorded in spec 22 — four of seven
   expectations are `low` while the default actionable threshold is `medium`.
   **That must not be resolved by relabelling these fixtures to fit the gate.**
