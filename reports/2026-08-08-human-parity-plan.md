# Plan: every step a human reviewer does — built, wired, and measurable

Date: 2026-08-08. Analysis and plan only — no code changed. Grounded in three
read-only audits of the current tree plus this week's measurement record. Every
current-state figure below is a measured number with a ledger entry; every proposed
step names the instrument it needs and what "done" means, because the last three
days demonstrated repeatedly that a capability without an instrument produces
beliefs, not results.

Companion to `reports/2026-08-05-pr-review-parity-analysis.md`, which mapped the
gap. This document is the build-and-measure order for closing it. Differences from
that report reflect what has been measured since: the 70/72-case security corpus,
the model-tier null, the sub-file partitioning kill, and the impact adjudication
verdict.

---

## 1. Where the engine stands against the human checklist, verified today

| # | Human review step | Engine today | Measured state |
|---|---|---|---|
| 1 | Understand intent/context first | ✅ PR title/body ingested as one-way orientation brief (spec 11); on in shipped CI | working as designed |
| 2 | Judge the design/approach | ❌ absent | no capability, no corpus, no ground truth |
| 3 | Correctness of the changed code | ✅ `review`, blocking | in-diff 63–68%, adj. precision 96–98%, 9s median, $0.017/PR median. **At a measured plateau**: attention (4 mechanisms), prompt (5 clauses), model tier — all closed flat or negative |
| 4 | Consequences beyond the diff | ⚠️ `impact check`, in CI, advisory | deterministic core localises 20/27; adjudication precision **lower bound 22.2%** vs 50% promote bar → "ships disabled". **Binding constraint measured: seeding, not the model** — 5/10 cases spent zero model calls, 3 enumerated zero reference files |
| 5 | Security | ✅ same engine | 64.0% recall / 95.0% adj. precision, 72-case advisory corpus, all 10 mechanisms |
| 6 | Performance | ⚠️ `performance` is a finding category; never measured as its own question | no perf corpus exists |
| 7 | Test adequacy | ⚠️ built (spec 29), deterministic, in every report | deliberately never a finding; **never measured** (firing rate unknown) |
| 8 | Readability/naming/maintainability | ❌ killed with evidence | conformance fired 14× its noise budget with **0 true positives in ~300 hand-judged divergences** |
| 9 | Codebase-convention consistency | ❌ same kill | same evidence |
| 10 | Docs/changelog alignment (the PR's docs) | ❌ absent | drift-checking exists only for this repo's own docs |
| P1 | Calibrated severity, blocking vs nit | ✅ two-axis rubric | better than ad-hoc human practice |
| P2 | Questions when uncertain | ✅ "Unresolved — Needs Human Decision" | working |
| P3 | Iteration with the author | ⚠️ closer than assumed | fingerprint dedup across pushes ✅; baseline marks disappeared findings **resolved** ✅; `intent`+`impact` already run per push in CI ✅; **reading author replies: absent**; accuracy of "resolved": **unmeasured** |
| P4 | Knowledge transfer / learning over time | ❌ excluded | by the product owner (this goal explicitly excepts learning) and by the standing no-interaction-telemetry decision |

Reference calibration: the median human reviewer produces ~15% defect-identifying
comments and 20–40% single-inspector detection; a disciplined multi-reviewer
inspection reaches ~60%. Rows 3 and 5 already sit at or above the strong-human
band with far better precision, latency and cost. The gap to "everything a human
does" is **scope** (rows 2, 4, 6, 7, 10, P3), not quality of what exists.

## 2. The plan, in waves

Ordering principle, earned this week at some expense: **instrument before
capability, deterministic before model, pre-register before measure, search the
ledger before pre-registering.** Two "obvious wins" died at ten seeds this week;
one proposed experiment turned out to have been run twice already; one shipped
manifest was invalid under a green suite. The plan therefore never builds a lane
before the thing that can measure it.

### Wave 0 — make what exists visible (days; ~$0 model spend)

The engine already does more than its output admits. No new capability.

| step | what | measured "done" |
|---|---|---|
| 0.1 | **One unified PR report.** The summary comment presents all lanes: blocking findings, impact reference, intent verdicts, test-adequacy note, resolved-since-last-push list | silent-review rate (currently 25% of corpus runs say nothing at all) → 0 by construction: a clean review states what was checked and found clean |
| 0.2 | **"What was checked" statement** replaces empty output — files read, lanes run, budgets hit | fixture-tested; no model cost |
| 0.3 | **CI template enables `changeImpact.enabled: true`** (the free deterministic tier) so GitHub users stop getting a "disabled" advisory step. Library default stays `false` — spec 22's ship-disabled verdict stands for adjudication and is not overridden here | firing-rate + latency delta on the 37-case corpus and 20 self-repo commits, reported before the template change ships |
| 0.4 | **Auto-baseline across pushes in CI** so the resolved-list appears without user setup | accuracy measured in 1.3 before any "addressed ✓" claim is worded assertively |

### Wave 1 — instruments and deterministic root causes (1–2 weeks; ≈$0 model spend)

| step | what | instrument required | measured "done" |
|---|---|---|---|
| 1.1 | **Impact seeding + contract-delta fixes** — the measured binding constraint (zero-seed cases) is deterministic code, not model work | none new; free re-run | seed rate (changed symbols seeded per case) and reach rate (proven dependents present in reference list), before/after |
| 1.2 | **Grow the impact corpus 11 → ~50 proven dependents** with the existing spec 17 harvest machinery (it generalises: one machinery, several manifests) | this IS the instrument; current cell sizes move 20pp per expectation | corpus lands with screening block, disclosure gates, schema-coverage test — same discipline as the security corpus |
| 1.3 | **Fix-recognition measurement — free ground truth already on disk.** Every reverse corpus case is a (vulnerable-parent, fix) pair: review the parent, write a baseline, re-run at the fix; the baseline matcher should mark the finding resolved. Ground truth is mechanical | none to build — corpora + `baseline write` exist | resolved-recognition rate and false-resolved rate over ~70 pairs; this number gates how Wave 0.4 words "addressed" |
| 1.4 | **Test-adequacy measurement.** Pre-register the noise budget FIRST (conformance died at 14× a budget set in advance — that discipline is why its death was clean) | self-repo history + existing corpora; deterministic | firing rate per PR; precision by human adjudication of a sample; promote-to-visible / keep-buried decision by the pre-registered rule |

### Wave 2 — close the measured-below-bar lanes (weeks; small spend)

| step | what | decision rule |
|---|---|---|
| 2.1 | **Impact adjudication re-measure** on the grown corpus, after 1.1 — and only if the new deterministic ceiling makes the answer resolvable (the standing prereg's "deterministic work instead" clause) | spec 22's own bar, unchanged: precision ≥50%, recall ≥40% of what the reference contains, beats deterministic-only, zero provably-unaffected. Promote adjudication default-on only then |
| 2.2 | **Intent precision 53.5% → 60% bar**: the ledger locates a specific calibration defect (`not-contradicted` fires on 1.6–2.8% of obligations against a 39.8% target population). One pre-registered fix attempt; if null, accept and label the lane's measured confidence in its output instead of chasing the bar | pre-registered, one attempt; the 87% self-agreement ceiling is the instrument's limit and every claim stays under it |
| 2.3 | **Performance: corpus before capability.** Harvest a perf-fix corpus (~30–50 cases) with the same machinery, reverse-oriented; measure the EXISTING engine's per-category recall on it first — it already has the category and may already be adequate | only a measured gap justifies any perf-specific work; in-prompt lens family is closed for security and the same result is expected here |

### Wave 3 — the conversation half (new spec required; moderate spend)

The biggest genuinely-human behaviour still absent, and it is buildable within the
standing constraints (stateless per PR; no interaction storage; no learning).

| step | what | measurement |
|---|---|---|
| 3.1 | **Read the PR thread at review time** (the integration already reads comment bodies for dedup markers — the API surface exists). Author replies become **re-verification tasks**, never verdicts: a disputed finding is re-adjudicated against its own evidence by the existing refutation machinery. The thread must never reach the refuter as prose — same one-way threat model as the spec 11 intent brief, because "please ignore this finding" is an injection, not an argument | — |
| 3.2 | **Hold-rate under pushback**: synthetic threads over the advisory corpus (dispute a proven finding with a plausible-but-wrong argument → the engine must hold, citing evidence; dispute with a genuinely correct argument on a known-false finding → it must withdraw). Ground truth is mechanical on the proven side | hold-rate on advisory-confirmed defects (target: ~100%), withdraw-rate on planted-wrong findings, judge pinned |
| 3.3 | **Answer direct questions** on a finding from its stored evidence; refuse beyond it | small human-adjudicated sample; advisory tone, never a new blocking path |

### Wave 4 — design/approach judgment (research-grade; corpus decides)

| step | what | gate |
|---|---|---|
| 4.1 | **Ground truth first**: harvest maintainer "changes requested" reviews that demanded design changes (not style), curate with the advisory-corpus discipline | if inter-curator agreement is poor, the lane is unmeasurable and is NOT built — that outcome is recorded, not worked around |
| 4.2 | Repeatability ceiling before any precision claim (intent's 87% lesson: the self-agreement ceiling caps every later figure and must be known first) | — |
| 4.3 | Advisory forever, same as intent/impact | — |

### Standing research track (no schedule, no promises)

- **The ranking question** — the only route left to raising correctness recall:
  the reviewer reads the right lines and reports a neighbouring real defect. Four
  families are closed; nothing currently proposed addresses selection. Any idea
  here goes: ledger search → measurability precheck → prereg, in that order.
- **Stronger model tier** when a usable endpoint exists (the max-tier candidate
  404s on this key's chat-completions path). The cheaper tier is already
  measured: recall parity, −6pp adjusted precision, 0.49× cost.

## 3. What is explicitly NOT in this plan, with the evidence

| excluded | why |
|---|---|
| Conventions/style/naming lane | 14× noise budget, 0 true positives in ~300 hand-judged; linters own the mechanical subset |
| Learning over time / cross-PR memory | excluded by the product owner in this goal; separately, the no-interaction-telemetry decision stands |
| Usefulness telemetry (parity item C2) | conflicts with the same standing decision; stays dead unless the owner reverses it |
| Any attention/prompt/resampling accuracy attempt | four families measured flat or negative; a proposal must first explain why it is none of them |
| Advisory lanes gaining blocking power | spec-level invariant, deliberate |

## 4. Measurement infrastructure: what must exist that does not

| needed instrument | for | effort | note |
|---|---|---|---|
| Impact corpus at ~50 proven dependents | any impact claim | days (harvest machinery exists) | the single highest-leverage instrument gap |
| Fix-recognition scorer over (parent, fix) pairs | resolved-list accuracy | small | reuses corpora + baseline machinery; zero curation |
| Test-adequacy noise budget + adjudication protocol | spec 29 promotion | small | budget pre-registered before first number |
| Perf-fix corpus | row 6 | days | same harvest pipeline, new query |
| Thread fixtures (dispute/question) | Wave 3 | small | mechanical ground truth on the proven side |
| Design-review corpus | Wave 4 | the gate itself | curation feasibility decides whether the lane exists |
| `eval` CLI coverage for intent (today it is scored by corpus-local scripts) | provenance parity across lanes | small | brings intent under the same engine-pinning guards the other lanes get for free |

## 5. Honest framing of the end state

After Waves 0–3 the engine performs, measurably, every step of a disciplined human
review except two: design judgment (Wave 4 decides whether it is measurable at
all) and learning over time (excluded on purpose). On the steps it performs it is
already faster, cheaper, more consistent, and either at or above the strong-human
detection band — with the one stubborn exception that its correctness recall
(~two-thirds) is bounded by a ranking behaviour that no measured lever moves, and
this plan does not pretend otherwise.
