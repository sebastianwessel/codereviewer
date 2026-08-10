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

## Priority 1 — CLOSED 2026-08-11 by the ledger search it required

The mechanism this section named — a second additive discovery call with the diff
withheld — **is spec 19's un-anchored discovery pass**, built on 2026-07-27,
measured, and removed at +0.83pp (p = 0.82) for +136% cost, on a corpus recorded in
advance as close to best case. The one design row that differs (whole file rather
than bounded windows) makes it weaker, not different: the windowed version's
candidate volume came from the windows, and discovery yield is call-bound.

Dead on arrival by this section's own rule. **$0 spent.** Detail:
`reports/2026-08-11-unanchored-pass-restatement.md`.

The ledger-search gate has now paid twice. It is a hard gate.

**What is closed with it.** Six structural interventions have failed against
later-in-file recall — enumeration sweep, diverse-lens pass, cross-file retrieval,
context scout, un-anchored pass, sub-file partitioning — and five pre-registered
prompt clauses have failed on framing. Neither "show discovery more" nor "tell
discovery differently" has an untried member. **Do not propose a seventh without a
mechanism that is neither.**

### What replaces it: the separator question, at n that can answer it

The largest unclaimed number left is the parked artifact-only findings — roughly
half real, worth ~10.3pp of recall — which cannot be promoted wholesale (genuine
false positives go 3 → 24 per 216 reviews) and could not be separated at n = 12.

The n problem is now solved for free. Pooling the ten sub-file control runs — one
engine, one corpus, one metrics version — gives **135 artifact-only findings, 69
distinct defects, zero label disagreements across seeds**, of which 82 are known
real. The 53 remaining carry no label, because in all ten runs the plausibility
judge never adjudicated an artifact-only false positive.

**Sequence:** adjudicate those 53 through the existing plausibility judge (bounded,
no review run) → pre-register a separator rule over the groundedness fields with all
four cells → if a separator exists, a promotion rule scored against precision, not
recall alone.

Unlike Priority 1, this is not another attempt to make discovery produce more. The
findings already exist and were already paid for.

## Priority 2 — CLOSED 2026-08-11

Every item here is decided and shipped. Kept as a record of what was decided and
why, because three of the five were decisions rather than fixes.

**2.1 Citations — DECIDED ON.** Default flipped to `true` (bceda3a). A product call
about comment quality, made as one: it costs +5.6% input tokens, has no measured
recall effect and no precision harm, and it makes every finding show the source line
it rests on instead of the verifier's prose.

**2.2 Surface what is computed and hidden — DONE.** Discovery diagnostics render as
a "What Discovery Produced" section in `report.md`, which is what separates "the
reviewer proposed little" from "it proposed plenty and later stages removed it".
The fix lane's false-positive judgement surfaces as a run warning (3ff7c71). The
verification lane's corroborations reach the review report and the finding itself.

**2.3 The `proposedBy` cluster — DECIDED KEEP.** Removing it was wrong: the analysis
traced the CLI and concluded no producer exists, but `ReviewWorkflowInput.candidates`
is a published API surface with deliberately tested behaviour. The producer is the
caller. See item A of the flow audit.

**2.4 Remaining audit items — ALL CLOSED.**
- *Analyzer metadata:* the six classification and trace fields are now declared on
  `CandidateFinding`, so a finding can carry them at all, and SARIF maps
  `relatedLocations`/`dataFlow` into locations and code flows. The analyzer join the
  audit implied was REJECTED — spec 15 keeps an ingested alert's metadata on its own
  evidence record, because joining by shared location gives one defect's CWE to
  another defect on the same line.
- *OpenTelemetry:* kept, and the log made honest. Preflight now warns that the
  engine emits no spans rather than claiming setup succeeded. Removing it was tried
  and reverted — it spans 17 doc and spec files.
- *Reactive split:* a half is shown only the hunks inside its own chunk. The split
  now halves the diff as well as the source.
- *Change-intent blocklist:* the exhaustiveness guard is a test enumerating the kind
  enum against the filter, which fails when a kind is added.

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

REVISED 2026-08-11, after the ledger search closed Priority 1: stop trying to make
discovery produce more — eleven attempts across two families have failed — and go
after the findings it already produced and parked, which are half real and cost
nothing more to obtain.
