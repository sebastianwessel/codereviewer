# Spec reasoning audit — foundations (00, 01, 02, 03, 04–09, 11)

Date: 2026-08-12
Scope: `specs/00-*.md`, `specs/01-*`, `specs/02-capabilities/**`, `specs/03-contracts/**`,
`specs/03-flows/**`, `specs/04-*`, `specs/05-*`, `specs/06-*`, `specs/07-*`, `specs/08-*`,
`specs/09-*`, `specs/11-*`.

**This is not a spec-vs-code drift audit.** The question is whether the reasoning in these
specs is valid, whether the cited evidence supports the claim made, and what is missing.
Every finding names a concrete consequence. Nothing here is edited into a spec — these are
the product owner's calls.

Method: read `reports/eval-results-ledger.md` in full (all 3450 lines, including the
appended 2026-08-07…2026-08-11 entries) plus the relevant `reports/*-prereg.md` decision
tables, then checked each spec claim against the measurement record rather than against
plausibility. Where the consequence is mechanical, I confirmed it in the code (read-only).
No provider call, no eval run, no file edited, nothing committed.

---

## F1 — Spec 05's "supersedes everything" clause points at the oldest number on the page

**Where.** `specs/05-review-workflow-and-runtime.md:565-570`:

> **The current headline for this stage is recall 43.7% at adjusted precision 95.0% for
> $2.31 per run**, measured on 2026-08-01 … That figure supersedes every earlier one on
> this page for quoting purposes.

**What it claims.** That 43.7% is the current rate, and that a reader wanting the current
rate should quote it in preference to anything else in the file.

**Why the reasoning fails.** The clause is a *superseding* rule with no mechanism to
supersede itself. The same file records two later measurements — `05:494-499` (68.3%,
sd 2.89pp, 2026-08-05) and `05:993` (66.1% mean, 2026-08-06 control arm) — and the ledger
states outright at `eval-results-ledger.md:234` that "the control arm supersedes the
2026-08-05 baseline". So the page carries three figures and instructs the reader to quote
the oldest and lowest of them. Meanwhile `specs/00-scope-and-glossary.md:52-55` publishes a
fourth ("most recently a 61.1% mean over three pinned runs, 2026-08-02"), and the product
publishes a fifth: `src/domains/reporting/measured-reliability.ts` pins 68.3% / 96.2%, which
`markdown-reporter.ts:86` prints in every `report.md` and PR summary.

Five "current" numbers, no owner. The 2026-08-02 ledger entry says these figures were
recorded "so the prose in `markdown-reporter.ts` and `summary-comment.ts` cannot drift from
the measurement it cites" — that intent has been defeated on both sides: the reporter is one
baseline stale and spec 05's instruction is three baselines stale.

**Concrete consequence.** An implementation agent told to quote the current rate follows the
literal instruction and publishes 43.7% — an arm figure from a spec-26 A/B, not a baseline.
Every user-facing report currently states 68.3%, which the ledger explicitly retired. And
`specs/03-contracts/finding-evidence-report.md:505-511` mandates *when* those rates must be
suppressed (a run with no model search) while never specifying *which* measurement they come
from or that it must be the newest ledger entry — so nothing binds the printed number to the
record.

**Correct position.** One location owns the published rate — the ledger entry, transcribed
once into `measured-reliability.ts` with a test that pins it, exactly the pattern
`measuredIntentReliability` already uses for the 87% intent self-agreement. Spec 05's figures
become dated audit trail with no quoting clause; `00-scope` and the reporter cite the single
owner. Additionally, the printed number should carry the configuration it was measured under
(see F5) — 68.3% describes an engine with all four 2026-08-11 default flips OFF.

---

## F2 — The refutation budget ladder's first rung is the exact defect the same page removed a rung for, and it makes the packet larger

**Where.** `specs/05-review-workflow-and-runtime.md:903-923` (the shedding ladder) against
`specs/05-review-workflow-and-runtime.md:1922-1925`.

The ladder: *"Under budget pressure, it omits support-signal corroboration candidates first,
then ambient review context, before failing the packet budget."* The page then explains why a
third rung was deleted (`05:913-914`):

> A rung that shed the shared digest used to run ahead of both: it dropped a constant of a
> few dozen bytes and could never make an oversized packet fit, so it read as a reduction
> while doing nothing, and it went with the field.

And, 1000 lines later (`05:1922-1925`), the spec records as measured fact that
`supportSignalCandidates` "was **always empty, for every candidate, since inception** …
whose filter requires `proposedBy !== 'review-agent'` while the sole candidate producer
hardcodes `'review-agent'`."

**Why the reasoning fails.** The argument that killed rung 0 applies *a fortiori* to rung 1.
A constant of a few dozen bytes frees a few dozen bytes; an always-empty array frees zero.
The spec states both facts and never connects them.

Verified in `src/domains/review-workflow/pipeline/refutation/packet.ts:178-196`: rung 1
rebuilds the packet with `supportSignalCandidates: []` **and** sets `budgetNotice` to a
~330-character string. Because the array was already `[]`, the rung's net effect on an
over-budget packet is to make it **larger**, then re-measure and fall through to rung 2.

**Concrete consequence.** Two, both in the failure class `05:916-923` warns about by name.
(1) The disclosure is false: the refuter is told "WITHHELD from this refutation packet to fit
the provider input budget: the deterministic support signals" when no support signals ever
existed for any candidate. That is the engine authoring an absence and then telling the
adjudicating stage the absence is an artefact of budget — the spec's own words for why this
matters are "a candidate is then refuted on the strength of an absence the engine itself
created, invisibly, because a refuted finding produces no output". (2) The ladder has one
working rung, not two, so a packet that rung 2 cannot fit goes to the split path having
burned a measurement pass.

**Correct position.** Delete rung 1 on the identical argument that deleted rung 0, and fix
or delete the `proposedBy !== 'review-agent'` filter — it is a dead selector for a producer
that no longer exists (`05:226-230` records that the trusted-rule allowlist which seeded
non-`review-agent` candidates was removed as eval-gaming). If the rung is kept against a
future producer, the notice must be emitted only when something was actually withheld.

---

## F3 — Discovery citations were promoted ON by default outside their own pre-registered decision table, and the standing kill rule is blind to the direction the data leaned

**Where.** `specs/04-configuration-and-providers.md:156` and
`specs/05-review-workflow-and-runtime.md:1966-1978`; capability inventory line 57.

**What it claims.** *"Promoted to ON by default, 2026-08-11, on readability and explicitly
not on quality."* The kill rule is stated as standing: *"a future measurement showing adjusted
precision falling removes the key whatever its readability value."*

**Why the reasoning fails.** The A/B was pre-registered with all four cells enumerated in
advance — `reports/2026-08-10-citations-prereg.md:39-43`:

| recall vs control | significant | decision |
| --- | --- | --- |
| improves | yes | **PROMOTE** to enabled by default |
| improves | no | KEEP, DISABLED |
| flat or worse | no | KEEP, DISABLED |
| flat or worse | yes | REMOVE |

The result landed in cell 3 and the ledger records it as *"**KEEP, DISABLED** — the
pre-registered table's third cell … All four cells were enumerated in advance this time, so
no cell needed interpretation after the fact"*. Promotion to ON the following day rests on
"readability", which appears nowhere in the pre-registration — not even among its
"secondary observations, recorded but decision-free". This is the error the ledger names
three separate times: *"promoting a metric chosen after seeing the results is how a null
becomes a 'win'"* (2026-08-07 authorization entry) and *"Choosing afterwards is the error
corrected three times in the preceding two days"* (2026-08-08 spec 31 gate).

There is a second, independent break. `05:1949-1953` argues the lane is *"incapable of
costing recall, by construction rather than by measurement"* — but that argument covers only
the verifier's failure mode (no candidate is dropped when a citation fails). It does not
cover the *asking*, which `05:1959-1961` concedes in the next paragraph: *"This changes what
discovery is ASKED to output, so it is promoted on measurement."* The two sentences cannot
both be true, and the measurement went the way the second one predicts: recall 63.1% → 62.2%,
3 gained / 7 lost, reviews posting nothing 27% → 30%.

**Concrete consequence.** Every default review now pays +5.6% input tokens per discovery call
for a change whose only measured direction on recall was slightly negative, and the standing
kill rule watches **adjusted precision only** — which rose. There is no trigger for the metric
that actually moved. A future recall regression attributable to this lane fires nothing.

**Correct position.** Either state the readability promotion as a product decision that
overrides the pre-registered table, recorded in the ledger with that framing (the honest
version, and the one CAP-CTX-002 already uses for `contextSources`), or return the key to its
pre-registered default. Either way, drop the "incapable of costing recall by construction"
sentence — it is contradicted on the same page — and extend the standing kill rule to recall,
since recall is the endpoint the prereg named primary.

---

## F4 — Spec 06's single-seed decision rule is superseded by the ledger and contradicted by spec 06

**Where.** `specs/06-evaluation-and-quality-gates.md:675-688`:

> four seeds of one identical configuration produced recall 81.3%, 87.5%, 81.3%, and 75.0%
> — a mean of 81.3% with a standard deviation of 4.4 percentage points … A change measured
> on a single seed must therefore move recall by more than roughly twice that deviation
> before it can be distinguished from noise … Later measurement on an expanded corpus found
> a comparable band of about 4.8 points.
>
> Two consequences follow, and both are requirements rather than advice.

**Why the reasoning fails.** Three ways.

1. **The evidence was retracted.** The ledger entry *2026-08-07 — Intent-framing clause
   REVERTED, and the real variance (CORRECTS AN EARLIER ENTRY)* puts four independent
   three-seed estimates of the *same* quantity at 2.22 / 3.92 / 6.30 / 8.38pp — a 3.8×
   spread — pools them at **5.71pp**, and concludes: *"Three seeds resolve ~11pp, not ~8 and
   not ~16. Detecting a 5-point effect at this variance needs roughly 20 seeds per arm."*
   The 2026-08-06 control arm produced 60.0 / 68.3 / 70.0 on identical inputs — a 10-point
   range. So the rule authorises calling a ~9pp single-seed movement real, when three seeds
   resolve ~11pp.
2. **Spec 06 refutes it internally.** `06:1044-1048` argues that an sd from three seeds "is
   barely an estimate", quoting 95% intervals of [0.50, 6.04] and [1.50, 18.17], and
   concludes the paired test **"replaces run-level mean ± standard deviation as the decision
   rule"**. A 4-seed sd is not better evidence than a 3-seed sd. The document holds both
   rules and retires neither explicitly, and the surviving rule is the one that governs the
   case the paired test cannot reach — a single-seed run with no control arm.
3. **The same retracted band underwrites the default gate.** `06:1641-1645` chooses `stable`
   as the default regression profile by citing the identical four-seed figure.

**Concrete consequence.** A reader with one seed and a 9pp movement has explicit spec
authority to call it distinguishable from noise. That is roughly the size of every effect
this project has spent money chasing and correctly rejected: the sub-file partitioning arm
moved −2.9pp, the correctness fixes +5.13pp then +0.77pp, the un-anchored pass +0.83pp. The
rule licenses exactly the false positive the 2026-08-07 confirmation study was run to prevent.

**Correct position.** State the pooled figure (sd ≈ 5.71pp, three seeds resolve ~11pp,
citing the 2026-08-07 correction), mark the four-seed band as a dated record that must not be
used as a resolution claim, and say explicitly that a single seed resolves nothing — which is
what the paired-test section already implies. The `stable` profile's justification survives
unchanged under the larger band; only the number cited needs replacing.

---

## F5 — The 2026-08-11 default flips put the shipped product outside every measured configuration, and the rule for closing that gap is one-sided

**Where.** `specs/11-external-context-ingestion.md:13-19` and `:262-290`;
`specs/06-evaluation-and-quality-gates.md:586-607`; capability inventory line 37.

Spec 11 is unusually honest here and gets most of it right: the flip is stated as
UNMEASURED, `eval run` is pinned OFF from a committed file, and the reason is given —
*"Every figure in `reports/eval-results-ledger.md` was measured before the flip … A run that
inherited it would compare a reviewer shown the change intent against a population that never
was."* Spec 06 adds the correct general principle: *"The eval is a longitudinal instrument;
one whose zero point follows the product default re-zeroes itself every time a default moves."*

**Why the reasoning fails.** The escape clause is stated in one direction only
(`11:275-280`): *"The owed on-vs-off A/B is run that way, and a result that favours ON changes
the pin in its own commit, followed by a re-baseline."* Nothing states what happens if the
result is neutral or unfavourable — which, given six measured nulls on discovery framing and
the fact that the brief enters the discovery packet, is the likely outcome. In that branch the
product default stays ON, the pin stays OFF, and the divergence becomes permanent by default
rather than by decision. Spec 06 records the same gap generically: *"the disagreement is a
committed, commented fact with an owed measurement attached"* — with no owner, no date, and
no gate.

**Concrete consequence.** Four capabilities flipped on 2026-08-11 (`contextSources`,
`review.citations`, `changeImpact`, `intentFulfilment`, plus `reporting.reviewComments`).
Every rate this project publishes — the 68.3% in `report.md`, the 64.0% security baseline,
the 96.2% adjusted precision — describes a configuration no user runs. There is no spec
sentence acknowledging that, and `00-scope-and-glossary.md:52-61` presents the figures as
`review`'s measured behaviour with no configuration caveat at all.

**Correct position.** Enumerate all four cells of the on-vs-off outcome in advance, as the
citations prereg did and the signal-facts prereg failed to (the ledger's own 2026-08-10
lesson: *"the next pre-registration on this stage must enumerate all four recall ×
significance cells in advance"*). And make the published-rate surface state the pinned
capability set beside the number, so a reader can see the figure does not describe their run.

---

## F6 — The advisory lanes spend provider money outside `review.maxCostUsd` and outside `run.costUsd`, and the defence offered for defaulting them on argues only the case where they do nothing

**Where.** `specs/02-capabilities/capability-inventory.md:489-492`:

> `intentFulfilment.enabled`, **on by default since 2026-08-11**. When disabled, or enabled
> with no provider configured, the lane reports that rather than failing: nothing in it can
> fail the run. **Defaulting it on therefore costs a repository without a model provider
> nothing but a stated status.**

**Why the reasoning fails.** The sentence establishes safety for the population where the
feature is inert — a repository with no provider — and offers it as the argument for a
default that only spends money on the complementary population, every repository that *has* a
provider. That is the containment shape the brief asks about: advisory-ness contains
pipeline-failure authority, and the argument silently extends it to cost.

`00-architecture-overview.md:32-37` makes the same move at the architecture level:
*"`review-workflow` still neither imports them nor can be failed by them"* — true, and about
failure authority, not spend or report accuracy.

Verified in code:
- `src/cli/advisory-lanes.ts` (305 lines) contains no cost, budget, or usage aggregation.
- `src/cli/commands/review.ts:143` runs the lanes **after** the review report is built.
- `review.maxCostUsd` is enforced in
  `src/domains/review-workflow/run/results/completion-state.ts:164-166`, against
  `runCost` from the review workflow only.
- `src/domains/intent-fulfilment/` has its own `LaneUsage` recorder and no `costUsd` reaching
  the review report.

Spec 04 already concedes the enforcement is weak on its own terms (`04:134`: *"It is not a
mid-run stop, and it is skipped entirely when cost is unavailable"*; `04:332-333`: *"Full
per-task cost enforcement remains a required follow-up"*), and spec 06:1919-1920 calls strict
per-task cost stops *"release-blocking follow-up work before R1 is considered complete"*.

**Concrete consequence.** Since 2026-08-11 a default `review` on a repository with a provider
issues one extraction call, one judgement call **per obligation** (`maxObligations` default
**100**), and one explanation call — none of which is counted in `run.costUsd` or bounded by
`review.maxCostUsd`. The ledger prices intent judgement at $0.0108 per obligation, so a
change producing 100 obligations adds ~$1.08 to a review the token audit prices at $1.47/run
warm. An operator who set `maxCostUsd` to cap spend is not capped, and the cost figure on the
report understates what was spent. `specs/03-flows/e2e-coverage.md:64` states as an unhappy
path that a run exceeding `review.maxCostUsd` exits 1 with `cost_budget_exceeded`; for the
lanes that row is now false.

**Correct position.** Either fold the lanes' usage into the run cost and move the budget
check after them, or state explicitly in spec 04 and the capability inventory that
`maxCostUsd` bounds the review stage only and that the advisory lanes are unbounded — and
price the worst case, since `maxObligations` defaults to 100 and the intent spec's own
economics argue for a *generous* cap. The current text implies a bound that does not exist.

---

## F7 — Spec 11's injection acceptance criteria cannot establish the property a reader takes from them, and the containment argument leaves the silent failure uncovered

**Where.** `specs/11-external-context-ingestion.md:414-426` (Acceptance) and `:52-62`.

Acceptance: *"External context never alters admission, severity, gate, or baseline outcomes;
a test injects an adversarial brief ("ignore all findings") and **proves findings are
unchanged**"* … *"Both surfaces … are exercised by **hermetic** tests that carry a real
injected instruction."*

**Why the reasoning fails.** The test is real and well built — I read it. But its own header
comment is more honest than the spec (`src/domains/review-workflow/run/context/change-intent-injection.test.ts:17-21`):

> The scripted reviewer is EVIDENCE-DRIVEN by construction: it decides purely from the
> changed-file content in its packet and never reads the change-intent section. … It proves
> what the product controls … **It does NOT prove a real model resists persuasion; that is a
> model property, measured live.**

"Measured live" is a forward reference to a measurement that does not exist: the ledger
contains no injection-resistance run, and no spec in scope states a measurement path for one.
So the acceptance list — the thing a security reviewer or product owner reads to decide the
risk is closed — asserts a proof the cited artefact explicitly disclaims.

The containment argument has a matching gap. `11:52-62` concedes redaction is not an
injection defence and that `digest` mode passes the attacker's words through verbatim, then
concludes: *"Containment rests on the deterministic code paths above and on the reviewer-side
framing."* The deterministic paths cover admission, severity, gate, baseline, and finding
location. They cannot cover a **discovery-stage suppression**: a brief that persuades
discovery not to emit a candidate produces no candidate, no rejection record, and no report
entry. Spec 11 identifies exactly this asymmetry for *refutation* (`:47-50`, *"a refuted
finding produces none"*) and responds by withholding the brief from the refutation packet —
correctly. Discovery still receives it, and for discovery the residual rests entirely on
framing.

**Concrete consequence.** An operator reading the acceptance list concludes the injection
risk is closed by tests. What is actually established is placement (attacker bytes never
reach an instruction channel, the brief is delivered only inside its guarded section) plus
the deterministic decision paths — all real and worth having. What is not established, and
not stated as unestablished, is whether a real model shown a suppression payload emits fewer
candidates. Since `contextSources` defaults ON as of 2026-08-11 and anyone who can open a PR
writes that text, the unmeasured surface is now the default surface.

**Correct position.** Reword the acceptance criteria to claim what the tests prove — the
scripted-provider test proves containment of the deterministic paths, not model resistance —
and add the residual to spec 11's own "Accepted cost, recorded rather than assumed away"
paragraph, which is the right pattern and already exists for the refutation trade. If a live
measurement is wanted, the corpus for it is cheap: the `security-advisory-2026` cases already
have known-findable defects (the 2026-08-10 multi-defect entry establishes a 13/15 in-diff
hit rate on five of them), so an arm with a suppression brief naming those files has a
measurable ceiling to score against.

---

## F8 — The absolute redaction claim is verified by a method that has demonstrably failed in both directions, and the 2026-08-11 change created a new failure mode nothing addresses

**Where.** `specs/00-vision.md:41` (VIS-002), `specs/00-scope-and-glossary.md:127`
(INV-SEC-001), `specs/07-security-privacy-operations.md:102-150`.

VIS-002: *"Default runs leak no raw source, prompts, provider responses, or secrets into
logs/traces/reports."* Verification: *"Redaction and artifact snapshot tests."*

**Why the reasoning fails.** The mechanism is a closed list of six pattern families
(`07:121-128`: bearer/basic, `sk-`, GitHub PAT, GitLab, AWS key ids, plus operator-configured
exact values) and the verification is snapshot tests over *known* tokens. Tests over known
tokens can establish that the listed patterns are removed from the covered surfaces. They
cannot establish "no secrets", and the record shows both error directions have shipped:

- **False negative, shipped for months.** `07:110-119` records that the reviewed diff was the
  one path that did not redact until 2026-08-11 — *"a credential committed inside a changed
  hunk went to the provider verbatim while the identical string in the surrounding file body
  came out `[REDACTED]`"*. VIS-002's verification method did not catch it.
- **Second false negative.** `07:146-150` records the configured-exact-secret redactor was
  *"reachable only from its own unit test until 2026-08-11"* — a capability no production
  call site could reach.
- **False positive, recorded and not patched.** The ledger's 2026-08-01 entry: *"The context
  redactor mangles a backticked configuration constant: spec 11's `` `task-context-change-intent` ``
  reached the extractor as `` `ta[REDACTED]` ``. A secret-pattern rule is firing on a
  hyphenated identifier in backticks. Harmless here."*

**Concrete consequence.** The "harmless here" judgement was correct on 2026-08-01 and is not
correct now. Since 2026-08-11 the same redactor runs on **the reviewed diff at intake**
(`07:110-119`), so a false-positive match now silently corrupts the source the reviewer
reads: the model is shown `[REDACTED]` in place of a real identifier and reasons about code
that does not exist. That is a recall and precision defect with no detection path — nothing
counts redaction substitutions, and `07:84` (*"If a value cannot be proven redacted, exclude
it from output"*) names no mechanism for "proven" and no error code. It also affects the
coverage certificate, since `07:114-118` argues redacting at intake "keeps the context ledger
honest, since the ledger measures that same string".

Note the direction of the risk changed with the surface. Over-redaction of a *log* is
cosmetic. Over-redaction of *model input* is a silent quality change — the same class spec 06
calls out as its worst failure mode, and the same class the 2026-08-01 ledger entry on
context budgets treats as needing "visibility plus a measurement, not a refusal".

**Correct position.** Restate VIS-002 and INV-SEC-001 as what the mechanism supports: the
listed pattern families plus configured exact values are removed from logs, traces, reports
and provider-bound context, verified by snapshot tests; residual secret shapes outside the
list are not covered and no completeness claim is made. Separately, treat over-redaction of
the diff as a first-class failure mode: count substitutions in the intake path and surface a
run warning when a redaction fires inside a changed hunk, so the reviewer's input being
altered is visible rather than silent.

---

## F9 — Smaller breaks, each with a concrete consequence

**F9.1 — `CAP-EVAL-004` names two different capabilities.**
`specs/02-capabilities/capability-inventory.md:49` assigns CAP-EVAL-004 to "Per-mechanism
security measurement (recall/precision by CWE mechanism + context-depth, held-out
anti-contamination)". Line 452 assigns the same id to "Benchmark Posture". They are unrelated,
and each is missing the other's half: the security-measurement capability has no detail
section (no trigger, side effects, final state, verification) despite the file's own rule at
line 6-7 that a capability is implementation-ready only when those are defined; Benchmark
Posture has no inventory row, so it is invisible to the R1 column, the source-spec column, and
any per-row audit. *Consequence:* a ticket, drift check, or readiness review tracing
CAP-EVAL-004 resolves to two incompatible definitions.

**F9.2 — `00-stack.md` says the advisory commands are never invoked by `review`.**
Lines 42-43 of the **Public API Inventory**: `impact check` — *"Never invoked by `review`."*;
`intent check` — *"Never invoked by `review`."* Both have been invoked by every default
`review` since 2026-08-11 (`00-architecture-overview.md:32-37`, capability inventory
471/489, `src/cli/advisory-lanes.ts`). *Consequence:* the one table that claims to enumerate
the public surface tells a reader that a default review makes no intent or impact provider
call — the wrong answer for cost (F6), for what data leaves the machine, and for what a
default run does.

**F9.3 — "none needed … a bigger model" is not established.**
`00-scope-and-glossary.md:58-61` justifies the out-of-diff scope boundary with: *"none needed
retrieval, a larger context window, or a bigger model, so this is not a context or retrieval
limitation."* Retrieval and context are well established (2026-08-10 multi-defect entry:
same file, same defect, only the hunk boundary differs — *"it retires retrieval, context size
and difficulty as explanations"*). "Bigger model" is not: the only model comparison measured a
*cheaper* model matching recall, and the same ledger entry states *"`gpt-5.1-codex-max` is
unusable on this key … so the STRONGER-tier question remains open"*. *Consequence:* a product
owner reads the population as unreachable by any model and closes a line of work the record
leaves open. The defensible version — eleven structural and prompt interventions have failed
against it, and no stronger tier has been testable — supports the same scope decision without
the unsupported clause.

**F9.4 — `e2e-coverage.md` has no flow row for the in-`review` advisory lanes.**
The Coverage Rule (lines 8-9) requires each R1 capability to map to an entrypoint, side
effect, unhappy path, and verification. FLOW-IMPACT and FLOW-INTENT (lines 42-43) name only
the standalone commands. *Consequence:* the composition that now runs on every default review
— including its declared failure behaviour ("a throw becomes a warning on the review report")
and its unbounded spend — has no declared unhappy path and no declared verification in the
matrix that exists to guarantee exactly that.

**F9.5 — Spec 07's threat model does not cover the shipped GitHub integration.**
`00-scope-and-glossary.md:38-42` places `scripts/github/` and `.github/workflows/code-review.yml`
inside First Release Scope, and defends it with: *"the engine itself (`src/`) still makes no
network call and holds no forge credentials"* — a containment statement about `src/`, offered
as a statement about the product. Spec 07's invariant `L61` (*"The only network path is the
explicitly selected model provider endpoint"*) and its attacker-vector table (L68-87) are
written as product-level claims and contain no row for the integration, which reads
attacker-authored PR text, holds `pull-requests: write`, and posts model-derived content.
Spec 07's CI section (L476-488) is written in the future tense — *"R1 must document these
constraints before any CI template is shipped"* — about a template already shipped.
*Calibration:* I checked the workflow, and it is materially hardened — `pull_request` rather
than `pull_request_target`, top-level `contents: read`, digest-pinned actions, a documented
refusal to interpolate PR text into `run:`/`env:`, and a concurrency group that bounds reply
floods. **This is a spec-coverage gap, not a live vulnerability.** *Consequence:* a security
reviewer auditing the product against spec 07 concludes there is exactly one network
destination and no credential-holding surface; there are two and there is one, and neither
appears in the threat table or the Verification list.

**F9.6 — `EvidenceKind` removal arithmetic does not reconcile.**
`03-contracts/finding-evidence-report.md:39-52` says *"It carried seventeen values; twelve had
no producer and were removed"*, then enumerates eleven by name and concludes *"All six removed
on 2026-08-10."* Six, eleven, and twelve cannot all be right. *Consequence:* minor, but this
is a contract file whose whole purpose is to be reconcilable against the schema by counting.

**F9.7 — Spec 09's readiness handoff and gap list are stale in opposite directions.**
`09-readiness-self-audit.md:156` records `blocking_findings_count: 0` and `gaps: []` for every
topic; line 192 says *"These specs are not approved until that review and human approval are
recorded"* while every spec in scope is marked `Status: Approved`. Its `performance_capacity`
and `ai_automation` evidence lists cite spec 27, whose central design was measured and
removed (ledger 2026-08-07: *"Not promoted; code removed (spec 27 now records the finding in
place of the design)"*). And `09:186-188` disclaims that accuracy figures in specs 05 and 06
are *"audit trail, not current performance"* — a disclaimer filed in a document nobody reads
before quoting spec 05, where the "current headline … supersedes every earlier one" clause of
F1 sits. *Consequence:* the one document that exists to record gaps records none, and its
containment disclaimer does not reach the page it is about.

---

## What I read and found sound

Calibration matters here, because most of these specs argue well and several argue better
than the code they describe.

- **The empty-denominator reasoning is now correct and was corrected for the right reason.**
  `06:782-799` catches exactly the false dichotomy the brief describes — *"That is right about
  `1` and treats the choice as though `0` and `1` were the only options"* — and grounds it in
  the concrete harm (23 archived reports publishing `securityObviousRecall: 0.0%` for a
  question nobody asked). The code's own comment at `metrics.ts:306-317` correctly distinguishes
  denominators over total cases (empty only for a run that scored nothing) from denominators
  empty in the default configuration. This is the model the rest of the spec set should follow.
- **The eval capability-pin design is right, including the part that is uncomfortable.**
  `06:592-613` — pin after the config loader, pin only what an eval-run code path reads, pin
  at the value the live baselines were measured under even when that disagrees with the
  shipped default, refuse a flag outside the pin set. The longitudinal-instrument argument is
  correct and is the reason F5 is a gap in the closing rule rather than in the design.
- **The arm-order rule** (`06:632-669`): alternate arm order per seed, record position, cite
  no precision delta until the cause is found, and explicitly *"a confound whose mechanism is
  unknown is still a confound"*. Also the observation that interleaving is a different control
  and does not satisfy it.
- **The existence-oracle argument in `07:234-240`** is the best single piece of security
  reasoning in the set: a path eligible only under the directory rule that turns out not to be
  a directory must be refused *indistinguishably* from a nonexistent path, because eligibility
  is otherwise decided before existence and answering the two outcomes differently
  reintroduces a probe. That is a threat most specs would miss entirely.
- **The withdrawal records refuse to over-claim**, consistently: the context scout is removed
  on mechanism with *"A void measurement is not a failed one"*; the discovery posture record
  says *"this record must not be cited as evidence against it"*; independent sampling records
  that it falsified its own premise and that the 4pp ceiling *"bounds identical-input
  resampling only"*. This discipline is why F1–F4 are findable at all.
- **Spec 11's refutation-withholding argument** (`:65-88`) is correct in both halves,
  including the accepted, unmeasured cost recorded rather than assumed away — the pattern F7
  asks for elsewhere in the same file.
- **The semantic merge's asymmetric-cost argument** (`05:1650-1654`): a wrong merge silently
  removes a real defect, a missed merge produces a redundant comment, *"the visible failure is
  the acceptable one"* — and the consequent refusal to use a line-distance threshold.
- **Spec 07's OpenTelemetry section** (`:511-528`) is exemplary about a capability that does
  nothing: it refuses to call the cleanup a cleanup, fixes the lie ("setup completed") without
  pretending the feature works, and states that either resolution is acceptable. The one thing
  it does not do is choose — a shipped, validated config key whose only effect on a default
  install is to fail the run with `opentelemetry_dependency_missing` is a trap for an operator,
  and "either is fine" is not a decision. Worth putting a date on.
- **Spec 08's dependency reasoning** is verifiable and verified — the `typescript`
  demotion, the `@types/node` runtime-dependency argument checked by a consumer typecheck in
  CI rather than by assertion, and the peer-range decision. One small break: `08:95` justifies
  the Node floor with *"`@purista/harness@1.6.0` declares `>=24.15.0`"* while the evidence
  table at `08:13` resolves `1.7.1`.
- **`00-stack.md:20-28`** volunteers that its own version table drifts, names the drift that
  occurred, and states that no check covers it. A spec that documents its own unreliability is
  more useful than one that does not.

---

## Suggested order of attention

| # | Finding | Why first |
| --- | --- | --- |
| 1 | F2 — refutation rung 1 | Mechanical, verified, currently sends a false statement to the stage that decides what a human sees. Cheapest fix in the list. |
| 2 | F1 — five current recall figures | Every user-facing report carries a retired number; no owner exists. |
| 3 | F6 — advisory-lane spend | A configured cost ceiling does not bound the run, by default, since 2026-08-11. |
| 4 | F4 — single-seed rule | Licenses the exact false positive the confirmation study was built to prevent. |
| 5 | F5 / F3 — default flips and the citations promotion | Both are decision-record repairs, not code changes. |
| 6 | F8 / F7 — redaction and injection claims | Restating what the evidence supports; F8's over-redaction detection is the only new work. |
| 7 | F9.1–F9.7 | Contradictions and stale text; each is a small edit with a named consequence. |
