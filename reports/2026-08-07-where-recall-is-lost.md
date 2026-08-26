# Where security recall is actually lost

Derived 2026-08-07 from the six A/B runs already paid for (control `b7456ac` and
treatment `b8ad0ec`, three seeds each, 50 cases). **No new provider calls.** Every
figure is pooled over 300 case-runs.

## A correction to an earlier claim in this session

An earlier note put the "reported nothing" rate at **26.7%**. That was wrong. It
summed only some of the finding buckets in a case result, so a case whose findings
landed in a bucket the sum omitted read as silent.

The unambiguous measure is discovery's own telemetry — `rawFindingCount == 0`, the
model literally returning an empty findings array. That is **27 of 300 case-runs =
9.0%**.

## The pipeline is not where findings are lost

| | pooled over 300 case-runs | per case-run |
| --- | --- | --- |
| discovery calls | 306 | 1.02 |
| raw findings from discovery | 372 | 1.24 |
| candidates after dedup/merge | 366 | 1.22 |
| dropped raw → candidate | 6 | **1.6%** |
| merged away | 18 | 0.06 |
| rejected at admission | 44 (18 duplicate, 16 refuted, 10 below-threshold) | 0.15 |

Nothing downstream is eating recall. **Discovery produces 1.24 findings per
case-run and almost all of them survive.** Any lever that works has to change what
discovery produces, not what happens to it afterwards.

## The failure is silence, and silence has a shape

Empty-return rate by the context depth of the case's expectation:

| context depth | empty returns | rate |
| --- | --- | --- |
| analyzer-path-dependent | 6/12 | 50.0% |
| **callee** | **9/36** | **25.0%** |
| **implementation** | **10/66** | **15.2%** |
| cross-function | 1/48 | 2.1% |
| cross-file | 1/84 | 1.2% |
| local | 0/42 | 0% |
| caller | 0/12 | 0% |

**Cross-file is not where the reviewer goes quiet — it is 1.2%.** It speaks on
cross-file cases and says something else. Silence concentrates almost entirely on
`callee` and `implementation`: the depths where the defect turns on *what a called
function or a framework API actually does*.

Two cases are silent in all six runs and three in at least four of six; 42 of 50
cases are never silent. So this is a property of a specific class of case, not a
general flakiness.

## The mechanism, and it is a contradiction inside one prompt

`modelHolisticReviewerInstructions` ends its precision clause with:

> do NOT speculate about callers, configuration, tests, or behavior **not present in
> reviewText**.

`crossFileRetrievalInstructions`, appended when retrieval is enabled — which it is,
by default, since 2026-08-01 — says the opposite for the same situation:

> the changed code calls an imported function, implements an interface, or relies on
> a permission, schema, or constant that is defined in a file you cannot see, and the
> defect depends on how that definition actually behaves. In that situation, **read
> the definition before deciding, instead of guessing or staying silent**.

For a `callee` or `implementation` defect the required behaviour is by definition
*not present in reviewText*. One clause says do not speculate about it; the other
says go and read it rather than staying silent. The measured outcome is that the
model resolves the conflict toward silence exactly where the two clauses disagree,
and stays voluble everywhere else.

This is a defect in the prompt independent of any corpus: two instructions in one
prompt give opposite directions for the same situation.

## What fixing it can and cannot buy

**Bounded.** Silence is 9.0% of case-runs. Even converting *every* empty return into
a correct match — which nothing supports — caps the recall gain at about **9
percentage points**. The security corpus resolves about **8 points** at three seeds.

So the effect is right at the edge of what the instrument can see. That is stated
before measuring, not after: a null here would be genuinely ambiguous between "no
effect" and "an effect this corpus cannot resolve", and the honest reading of a
small positive is "consistent with the bound", not "proved".

## What this closes

The standing note that cross-file misses "were never silent" was measured on the
older 37-case corpus and is **still true here** — cross-file silence is 1.2%. What
is new is that silence exists at all, and lives somewhere else: one step down the
call, or one step into a library.

It also disposes of two hypotheses without further spend:

- **Not volume.** 1.24 findings per case-run against a key naming ~1.02, with 1.6%
  pipeline loss. More findings per call is not obviously the lever.
- **Not the missing-weakness-class hypothesis**, which was pre-registered, measured
  and rejected the same day (7 gained / 8 lost, p = 1.0000). The clause it added
  addressed targeting; the dominant failure on these cases is not targeting.

## Addendum 2026-08-07: the matcher is not under-crediting

Derived from the 20 confirmation runs, no new spend. If the semantic judge were
rejecting correct findings, measured recall would understate the reviewer and there
would be a cheap correction available. There is not.

Across **406 missed expectation-observations**, where the engine's own findings fell
relative to the expected lines:

| | | |
| --- | --- | --- |
| no finding in that file at all | 307 | **75.6%** |
| same file, more than 50 lines away | 82 | 20.2% |
| same file, within 50 lines | 17 | 4.2% |
| same file, within 10 lines | **0** | **0%** |
| inside the expected range | **0** | **0%** |

**Not one missed expectation had a finding on or near its lines.** There is no
population of "the engine found it and the judge said no", so the matcher is sound
and the ~61% figure is not understating anything. This also removes the cheapest
imaginable win: there was nothing to correct.

### The "which file" reading above was wrong, and the correction is the finding

The paragraph originally here concluded that three quarters of misses were "no
finding in that file", and that the lever was therefore **which file inside a case
gets the attention**. Testing that before acting on it killed it, for two reasons.

**First, the corpus cannot support it.** 46 of 51 cases declare a *single* reviewed
path. There is no file to choose between.

**Second, the 75.6% was another incomplete bucket sum** — the same mistake as the
26.7% corrected at the top of this report. It counted findings only from the
unlisted-real, false-positive and duplicate buckets, so a case whose finding matched
a *different* expectation read as "no finding in that file". Using discovery's own
`rawFindingCount`, which is unambiguous, the picture inverts:

| | share of the 406 missed expectation-observations |
| --- | --- |
| single-file case, engine spoke **in that same file** | **67.0%** |
| single-file case, engine said nothing at all | 22.2% |
| multi-file case, engine spoke elsewhere | 10.3% |
| multi-file case, engine said nothing | 0.5% |

**Two thirds of all misses are cases with one reviewed file, where the engine read
that file, produced a finding, and the finding was not the advisory's defect.** It is
looking in exactly the right place and reporting something else.

### What is now established, three independent ways

- The reviewer **trades** findings rather than adding them — the first paired test
  showed 7 gained against 8 lost across unrelated mechanisms.
- It emits **1.24 findings per case-run** against a key naming **1.02**, losing 1.6%
  downstream. It is picking roughly one thing.
- In **67%** of misses it picks that one thing from the correct file and picks
  wrongly.

The constraint is **selection within a file**: which of the defects visible in a file
the reviewer judges most worth reporting. Not retrieval, not volume, not file
choice — each of those is now closed by measurement rather than by argument.

That is a target, not a solution, and this analysis does not test a fix for it.

