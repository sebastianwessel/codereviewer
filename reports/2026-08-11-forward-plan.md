# Forward plan, written from what is measured

Written 2026-08-11 after a session that produced seven nulls, one sharp positive
finding, and three shipped defect fixes. Every number below is measured and
recorded in `eval/../reports/eval-results-ledger.md`; nothing here is projected.

## The state, in four facts

1. **Recall ~63%, adjusted precision ~99%** on the 72-case security corpus,
   `openai/gpt-5.3-codex`. A precise reviewer with a recall ceiling.
2. **Seven interventions, all null.** Five prompt clauses, four attention
   mechanisms, model tier, signal-facts context, and the citation spine. The last
   is the informative one: the mechanism *provably engaged* (findings carrying
   evidence went 0% → 90%) and the verifier's behaviour did not change.
   **"Give a stage better input" is exhausted as a strategy.**
3. **The out-of-diff wall is real, and is now the only gap with a sharp
   instrument.** Five defects the engine finds 13/15 of the time when they are the
   diff are found **0/5** when the identical defect sits in the same file outside
   the hunk. Retrieval, context size and difficulty are all retired as
   explanations.
4. **"One finding per file" is unestablished.** Every mechanical cause is
   inactive — the candidate cap is never reached, nothing is suppressed, the model
   stops far short of any output budget — and 97% of corpus cases contain exactly
   one defect, so ~1 finding is the correct response. n=1 on the clean test.

## Priority 1 — Out-of-diff attention, with the instrument that now exists

**Why now and not before.** Four mechanisms were already measured flat here. All
four predate this evidence and were scored against expectations whose findability
was unknown, so a flat result was uninterpretable — it could always have meant
"those were hard". The `multi-defect-2026` corpus removes that: five defects with a
proven in-diff hit rate and a **known ceiling of 5/5**. A null now means something.

**Before anything is built, search the ledger.** Pre-registration does not protect
against re-running an experiment already recorded, and this project has done that
once. In particular the withdrawn *context scout* and the rejected *extra discovery
passes* (a sweep and a lens, both at +40–47% cost) must be read first, and any
proposal that is a restatement of either is dead on arrival.

**The mechanism worth proposing, stated so it is falsifiable.** Every previous
attempt told the reviewer to look outside the diff, or gave it more to look at.
Both are the closed family. The untried shape is to **remove the anchor rather than
add an instruction**: a second, additive discovery call over the changed file with
the diff withheld entirely, so there is no hunk to anchor on and the whole file is
the subject. It is structurally the dedicated security pass — additive candidates,
same refutation, same admission — with a different framing of what the call is
*about*, not of what it should attend to.

Honest prior: additive passes have been rejected once on cost. This one must be
priced against the 5/5 ceiling before any full run, and abandoned at the smoke if
the ceiling is not moved.

**Sequence:** ledger search → measurability precheck on the 5-case corpus (~$0.20)
→ pre-registration with all four cells → 3 seeds/arm on the security corpus if and
only if the precheck moved the 5.

## Priority 2 — Work that needs no further measurement

These are product and hygiene decisions, not experiments. None should wait on
Priority 1.

**2.1 Decide citations on readability.** Built, tested, off. It makes every finding
show the exact source line it rests on instead of the verifier's prose. Costs +5.6%
input tokens, no recall effect, no precision harm. This is a product call about
comment quality and should be made as one — the recall study neither measured nor
was designed to measure it.

**2.2 Surface what is computed and hidden.** From the flow audit: discovery
diagnostics (`rawFindingCount`, the suppression counters) reach `report.json` and
no human surface, though they are exactly what explains an under-reporting run; and
the fix lane's verdict that an admitted finding is a *false positive* reaches only
`fix-report.json`, which nothing reads — so a human sees a finding presented as
real while the fix lane privately disagreed. Both are small changes with no
measurement risk.

**2.3 Decide the `proposedBy` cluster.** Four mechanisms branch on a value only
ever set to one thing: `supportSignalCandidates`, `isModelProposedCandidate`, the
"support signals skip refutation" cost optimisation, and an entire admission
branch. Either wire a deterministic-signal candidate producer or delete all four
and their specs. This is a design decision and must not be taken as a side effect
of something else — but it should be taken.

**2.4 Close the remaining audit items.** Analyzer CWE/ruleId cannot reach a finding
(SARIF degrades for analyzer-corroborated findings); OpenTelemetry logs success
while exporting nothing and has no packages installed; the reactive split
double-sends one file's diff while ledgering it once; the change-intent refutation
exclusion is a blocklist with no exhaustiveness guard.

## Priority 3 — Curation, which unblocks the last open question

**More both-in-diff pairs.** `multi-defect-2026` has exactly one case where two
defects both sit in the changed lines, and its two expectations overlap in range —
the hardest possible version. Widening the search beyond the current 46 repos for
files carrying two separately-advisory'd defects in *non-overlapping* regions of one
hunk is what turns n=1 into a study. This is curation work with a known method, not
research.

Until it exists, **"one finding per file" must not be described as a known limit**,
in any doc, report or commit message.

## Priority 4 — Cost and performance, measured not assumed

The one-process change was verified to cut git subprocesses 6→4 and file reads
14→7 for two advisory lanes, and to leave quality flat (64.9% vs a 63.1–63.5%
prior). What was never re-measured is the cold/warm per-pull-request cost profile
after that change. The cache probe exists; it should be re-run and the ledger's
cost figures refreshed, because they predate both the one-process change and the
dependency bump.

## What this plan deliberately does not do

- **No further "show stage X more" experiments.** Seven nulls across both stages.
- **No promotion of the parked artifact-only findings** — 52% real, but promoting
  wholesale takes genuine false positives from 3 to 24 per 216 reviews.
- **No mining of the engine's own unlisted-real findings into answer keys**, however
  convenient a corpus that would build.
- **No claim about precision from the A/B harness** without balanced arm order; the
  order artifact is measured and three seeds cannot balance it.

## The one-line version

Stop feeding the stages; go after where the reviewer *looks*, using the first
instrument that can tell a real failure from a hard case — and in parallel ship the
things that need a decision rather than an experiment.
