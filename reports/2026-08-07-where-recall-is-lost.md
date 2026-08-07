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
