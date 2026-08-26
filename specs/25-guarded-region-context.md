# 25: Guarded-Region Context

Status: **Withdrawn 2026-07-30** — measured, both arms failed, implementation removed
Date: 2026-07-30

## Outcome (2026-07-30)

Three arms, one session, `real-repo-cross-file` (37 cases / 87 expectations).
Total spend $5.33. Full entry in `reports/eval-results-ledger.md`.

| arm | matched | product recall | adj. precision | genuine FP | unlisted real |
|---|---:|---:|---:|---:|---:|
| 0 baseline | 40/87 | 46.0% | 95.2% | 2 | 4 |
| A signal | 42/87 | 48.3% | 93.3% | 3 | 11 |
| B + callee ranking | 39/87 | 44.8% | 90.7% | 4 | 14 |

**Neither arm met the decision rule below.** A moved +2.3pp against a ±4.8pp band
— two findings — and its precision fell. B was worse than baseline, worse than A,
and worst on precision.

**Both arms are deleted**, per this spec's own rule. The trigger, the section,
the callee ranking, the `review.guardedRegionContext` configuration block and the
`guarded-region` context kind are all removed; a config still setting the block
fails validation with exit code 2 and no compatibility shim is permitted.

Arm A was briefly retained off by default and then removed on the approver's
second instruction. That was the right call: a capability inside its own noise
band that costs precision is a maintenance liability in a precision-first
reviewer, and keeping it would have left the codebase asserting by its existence
something the measurement does not support.

**What survives is `declaration-analysis`.** Extracting declaration spans, lexical
traits and trait positions out of `invariant-conformance` was needed so a stage-1
caller could use them without importing a stage-3 domain. That extraction is
correct independently of this result and spec 24 now depends on it.

> **Superseded 2026-08-02.** It does not survive. Spec 24 was withdrawn on its own
> firing-rate measurement and removed, and `declaration-analysis` had acquired no
> other consumer — the stage-1 caller this extraction was performed for was arm A,
> which this spec deleted. It is removed with spec 24. Nothing else in the
> paragraph above changes: the extraction was the right shape while it had two
> consumers, and it is dead code with none.

Recorded as a hypothesis and explicitly not as a result: unlisted real findings
rose 4 → 11 → 14 while genuine false positives moved only 2 → 3 → 4.

The cost clause never engaged — the baseline was the most expensive arm ($2.23
against $1.52 and $1.57), so cost here tracks nondeterministic refutation volume
rather than packet size.

## Purpose

When a change alters a **guard** — a construct that gates whether following code
runs — make the reviewer aware of **what that guard governs**, so the consequence
of loosening it is visible at review time.

## Provenance

Adapted from `openai/codex-security` (Apache-2.0), `security-diff-scan/SKILL.md`,
which handles protection-weakening with no dedicated detector:

> *"when the diff adds, removes, or reshapes a guard around an existing parser,
> deserializer, expression evaluator, filesystem/path helper, archive utility, or
> auth/authz helper, use the adjacent pre-existing sink/control as supporting
> context for the changed behavior; keep the candidate anchored to the changed
> guard or newly exposed path"*

Their rule enumerates helper categories by name. **Ours MUST NOT** — spec 15's
Non-Negotiable. The adaptation keeps the mechanism and replaces the taxonomy with
a structural trigger (below).

## The Central Design Decision — Requires Explicit Approval

Spec 24 treats protection-weakening as a **separate advisory capability** (stage
3): its own command, its own peer sets, its own report.

This spec treats it as a **retrieval-and-framing gap inside the diff reviewer**
(stage 1). There is no new command and no new report.

**These are rivals, not complements.** Approving this spec means accepting that
*"did this change weaken a protection"* may not be a separate stage at all. If
this measures a win, spec 24 is retired and its detector deleted (see
*Relationship To Spec 24*).

This does not disturb the stage separation already required: stage 2
(spec 23, intent-fulfilment) and stage 3 (spec 22, change-impact) remain
independently runnable. It removes a *candidate* stage-3 capability, not the
stage.

## What Is Actually Missing — Scoped Honestly

Discovery is **holistic and whole-file**. When a changed guard and the code it
governs are in the same file, the reviewer **already has both**. This spec
therefore claims nothing there.

Two gaps remain, and they are different in kind:

1. **Attention.** Nothing tells the reviewer that a changed line *was* a guard, or
   which region it governs. The material is present but unmarked.
2. **Cross-file content.** When the guarded region calls into another file, that
   callee is absent from the packet.

Separating these two is the point of the measurement plan, because our own ledger
says they are not equally promising.

## Prior Attempts — Why The Bar Is High

**This is the fourth attempt at giving discovery more context, and the first three
failed.**

| intervention | mechanism | outcome |
|---|---|---|
| spec 16 cross-file retrieval | agentic — model searches the repo | off by default; no measured win — **REVERSED, see below** |
| spec 18 context scout | agentic — a pass selects context | withdrawn on mechanism |
| spec 19 un-anchored pass | extra discovery pass | withdrawn; failed its pre-fixed rule |

> **Correction 2026-08-14 — the first row was reversed by measurement and this table
> was not updated.** Both halves of it are now false. The ledger entry *Spec 16
> cross-file retrieval — REVERSES the earlier net-negative verdict* (2026-08-01,
> $3.94, same pinned engine `c11579c` both arms) reports recall 42.5% → **48.3%**,
> adjusted precision 97.4% → **100%**, and cost **−7%**; the earlier negative verdict
> had been measuring a silent 24 KB read truncation the model was never told about,
> so *"the earlier measurement could not distinguish the feature from that bug"*. A
> second run put it +2.3pp with precision again at 100% and cost again down. The
> feature is **on by default** since 2026-08-01.
>
> **What this does not become.** The reversal is not significance: +5.7pp sits at
> p = 0.096 on a single run, the entry closes *"Replicate before making it the
> default"*, and **no record of that replication exists in the ledger** — so the
> default rests on "nothing measured argues against it", which spec 16 states
> plainly. The requested replication is neither run nor recorded as outstanding, and
> naming that here is the point of the correction.
>
> **And it is not a reversal on every endpoint.** The 2026-08-11 ledger entry lists
> cross-file retrieval among *"six structural interventions [that] have now failed"* —
> that count is scoped to **later-in-file (out-of-diff) recall**, where it is null
> along with the other five, and it does not contradict the overall-recall reversal
> above. Both statements are true of different populations, which is exactly the
> distinction a stale row loses.

Against that, the intervention that **did** move the cross-file cases was a
**framing** change — the untrusted-input guard, one prompt line, which recovered
cross-file and caller cases that retrieval and the scout could not.

Two conclusions carried forward and shaped this spec's arms, and one of them no
longer holds as stated:

- **Deterministic beats agentic** for scoping (externally: Snyk `CodeReduce`
  28.9% → 82.75% *with the same model*; Semgrep 43.5% vs 12.6% recall at equal
  precision). This stands; all three interventions above were agentic or unscoped.
- **Framing has outperformed retrieval here**, on our own corpus. **Retained as the
  prior these arms were designed under, and superseded as a current position:**
  framing's win is the larger and the significant one, but retrieval is no longer a
  measured failure — it is a measured, unreplicated, precision-positive gain that
  ships on. A reader taking "retrieval is one of three failures" from this table
  would be steered away from the only intervention here that measured a gain at
  *lower* cost.

Arm A below is therefore the framing-only arm, and it is the arm this spec
expected to win. Arm B is the retrieval arm and it inherited a **low prior** — a
prior the spec 16 reversal, which landed after these arms were run and rejected,
would not now support at the same strength.

## Trigger — Deterministic, Structural, Language-Neutral

A changed declaration qualifies when the diff adds, removes, or modifies a line
that, by the existing lexical shape extraction, carries **either**:

- a **guard trait** — a conditional whose body leaves the declaration early, or
- a **call trait on the exit path** — a call whose position is terminal for the
  declaration

The **guarded region** is the remainder of the enclosing declaration that the
guard precedes, bounded by the declaration span.

No category list, no symbol names, no framework or language names. The trigger
MUST be expressible entirely in terms of position and structure.

## Design

1. **Trigger detection — deterministic.** Per changed declaration, per the rule
   above. No model.
2. **Region resolution — deterministic.** Compute the guarded region's span. No
   model.
3. **Signal emission — deterministic.** Emit a support signal stating that a
   guard-shaped construct changed and naming the region it governs, by path and
   line range. This is Arm A in full.
4. **Callee-priority ranking — deterministic, bounded, Arm B only.** Rank the
   existing referenced-definition budget so files defining the guarded region's
   callees are admitted first. One hop. No transitive expansion. No model-directed
   search. **No new bytes.**

### Amendment (2026-07-30): Arm B Re-Ranks, It Does Not Add

Found while wiring the trigger, and material enough to record: **one-hop
cross-file content already ships**. `referenced-definitions.ts` (R4) injects
bounded digests of unchanged imported files on every task, always on — **6 files,
12KB total, 4KB per file, ranked by import frequency**.

Arm B as first written — *"add one-hop cross-file content"* — was therefore
largely already built. The gap was never *"no cross-file content"*; it was
**cross-file content chosen by the wrong rule**.

Arm B is consequently redefined as a **ranking change inside the existing
budget**: the 12KB is spent on what the changed guard governs before it is spent
on what is imported most often.

Resolved parameters:

- **Blend, not replace.** Guarded-region callees take the budget first; frequency
  ranking fills the remainder. Pure replacement would evict context that is
  currently earning its place, and would confound the measurement with a loss.
- **Budget unchanged at 12KB / 6 files / 4KB per file.** This is what keeps the
  arms cost-comparable.
- Callee-to-file resolution MUST reuse the import parsing
  `referenced-definitions.ts` already performs. No new resolution path.

This makes the contrast sharper, not weaker: the question is no longer "more
context or less" but **"does targeting beat frequency ranking?"** — which, if
answered yes, also explains why three prior retrieval attempts failed.

The +25% cost clause below is retained but is now expected to be inert, since no
arm adds packet bytes. A measured cost rise would mean something went wrong and
MUST be investigated rather than accepted.

## Requirements

- Trigger detection, region resolution and one-hop resolution MUST be
  deterministic. The model MUST NOT be given a repository to search. Unbounded
  search is forbidden — it measured net-negative here twice.
- The trigger MUST NOT name any language, framework, vendor, library, symbol or
  defect category, per spec 15's Non-Negotiable. The existing guard test MUST
  cover it.
- The emitted signal MUST state **only what is structurally true** — that a
  guard-shaped construct changed and what region follows it. It MUST NOT assert
  that a protection was weakened, that the change is unsafe, or that a defect
  exists. That judgement belongs to discovery.
- One-hop expansion MUST be bounded by the existing packet budget and MUST
  degrade by dropping expansion, never by dropping changed-file content.
- It MUST reuse `deterministic-signals`, `context-retrieval` and the existing
  declaration span and shape extraction. It MUST NOT introduce a parallel
  retrieval path.
- It MUST NOT change the admission gate, the report schema, or severity.
- Both arms MUST be independently configurable and **disabled by default until
  measured**.
- Failure MUST be recoverable: a trigger or resolution failure MUST degrade to the
  current behaviour and MUST NOT fail the review.

## Measurement Plan

Measured on the existing real-repository corpus (30 cases / 42 findings) against
the recorded baseline: **recall 54.8%, adjusted precision 95.8%, line placement
97.2%, ~$1.35**.

Three arms, paired, using `eval-significance.ts`:

| arm | content |
|---|---|
| **0** | baseline, unchanged |
| **A** | trigger + signal only — no new file content |
| **B** | A + one-hop cross-file expansion |

**Pre-registered decision rule, fixed before any run:**

- The measured variance band is **sd 2.4pp** on this corpus (4.8pp on the wider
  sweep). A recall movement inside ±4.8pp is **not a result**.
- An arm wins only on **paired finding-level significance**, not on a point
  estimate.
- **Adjusted precision MUST NOT fall.** A recall gain bought with precision is a
  loss; this is a precision-first reviewer.
- Arm B must additionally beat **Arm A**, not merely the baseline. If B ≈ A, the
  retrieval half is unjustified and only A ships — this is the specific question
  three prior interventions never isolated.
- Cost is recorded and reported. Arm B is expected to raise packet bytes; a win
  costing more than **+25%** is referred back rather than shipped.

**Neither arm ships on a point estimate. Both are deleted outright if they fail** —
no "keep it off by default and revisit", which is how dead configuration
accumulates.

## Relationship To Spec 24

Spec 24 currently has **no positive case on real code** and a firing rate of
~~**0.70 per commit against its own ≈0.5 kill criterion**~~ (change-attributed firing
is 0.0125 and is not the problem; pre-existing divergences are).

**Correction, 2026-08-13.** The 0.70-per-commit figure was **void when this section
quoted it** and is struck above. Spec 24's own subsection heads the numbers it comes
from with *"Every number in this subsection is void"* — they were produced by a
declaration-span defect that hid every multi-line signature — and withdrew the
"gate is blown" conclusion drawn from them; the stale sentence was nonetheless left
unmarked at its own location in spec 24, which is where this citation came from.
Post-fix the same detector reported **0.000 per commit** (ledger, 2026-07-30).

**This changes nothing about the outcome recorded above.** Both arms of this spec
failed on their own pre-registered rule and were deleted; spec 24's firing rate was
never an input to that. What the correction changes is what this section may be read
as saying about spec 24: it is not evidence that spec 24 was noisy, and spec 24's
withdrawal rests on a separate 2026-08-02 run that is itself unrecorded (see spec
24's *The Withdrawal Rests On An Unrecorded Measurement*).

| outcome | consequence |
|---|---|
| an arm here wins | **Spec 24 is retired** and `invariant-conformance` deleted, including its command, config block and report schema. No compatibility shim. |
| both arms fail | Spec 24 stands or falls on its own firing-rate work, unaffected. |

**Spec 24's machinery is reused either way and is not wasted.** `declaration-span`,
`declaration-shape`, and the positional depth/terminality classification are what
make this spec's trigger expressible without naming a single language construct.
Retiring spec 24 retires its *detector*, not its foundations.

## Recommendation: Run All Three Arms In One Session

Arm B carries a low prior. It is still recommended, for three reasons that are
about method rather than optimism.

**1. Comparability is the binding constraint.** Arms are validly paired only
against the same baseline, in the same window, on the same corpus state. Two
recorded incidents came from violating this: a run scored against a **stale answer
key** (reported 78.8%, actually 54.8%), and an A/B that ran **base against base**
through a `zsh` word-splitting bug, at ~$11.50 for no comparison. Splitting A and
B across sessions reintroduces that class of error for no gain.

**2. Provider cost is not a decision input.** ~$1.35 per arm, ~$4–5 for all three.
The real cost is implementation, and **Arm B is Arm A plus one step** — identical
trigger, identical region resolution, then one bounded lookup that
`symbol-reference-lookup.ts` already performs. B's marginal work is budget
handling, not a second capability.

**3. Sequencing risks the wrong conclusion.** If A fails alone, the tempting
inference is that the idea is dead. That inference is invalid: A failing while B
would succeed means **content, not attention, was the binding constraint**. Our
evidence makes that unlikely, not impossible. Running both removes the guess.

Every outcome is decisive, which is the test of whether the run is worth making:

| result | conclusion |
|---|---|
| A wins, B ≈ A | ship A, retire spec 24, close retrieval permanently |
| B > A | deterministically scoped retrieval does pay — reopens a written-off line |
| both fail | guarded-region context is dead; spec 24 stands on its own firing-rate work |

**This table is a pre-run commitment, and the row that fired is the last one.** Both
arms failed (see *Outcome*, above), so *"close retrieval permanently"* is a branch
that was written and never taken — it is not a conclusion this spec reached, and it
must not be quoted as one. Noted 2026-08-14 because a reader did quote it as one.

Approving Arm A alone remains a legitimate reading of the evidence and is
cheaper. It costs the framing-versus-retrieval answer, which generalizes beyond
this spec.
