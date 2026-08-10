# The out-of-diff mechanism was already built, measured and removed

Date: 2026-08-11. **Spend: $0.** No provider call was made.

The 2026-08-11 forward plan named one mechanism worth proposing against the
out-of-diff wall, and made a ledger search the mandatory first step. The search
found the mechanism. It is `specs/19-unanchored-discovery-pass.md`, built in July,
measured, and removed.

## The proposal and the thing already measured

| | forward plan, 2026-08-11 | spec 19, 2026-07-27 |
| --- | --- | --- |
| second discovery call | yes | yes |
| diff withheld | **entirely** | **entirely** |
| additive, never displaces | yes | yes |
| same generic instructions | yes | yes |
| merged through the semantic merge | yes | yes |
| same refutation and admission | yes | yes |
| off by default until measured | yes | yes |
| unit of review | whole changed file | **bounded windows of the file** |

One row differs.

## What it measured

`real-repo-cross-file`, 36 cases / 80 expectations, base n=6 against pass-enabled
n=3. From `reports/2026-07-27-unanchored-pass-ab-result.md`:

| | base | pass enabled |
| --- | ---: | ---: |
| recall | 46.25% | 47.08% |
| candidates / run | 74.7 | 117.0 (+56%) |
| refutation kill rate | 1.3% | 16.0% |
| adjusted precision | 0.804 | 0.792 |
| **cost / run** | **$1.92** | **$4.53 (+136%)** |

Paired over 80 expectations: **+0.83pp, 95% CI [−3.13, +4.79], 10 gained / 9 lost,
p = 0.82.**

Two things make this hard to argue with. The corpus was recorded **in advance** as
close to the best case for the change — median 7 changed lines, median 2 hunks, 17
of 36 cases single-hunk — with the spec's own words, *"a pass that does not help
here will not help anywhere."* And the mechanism demonstrably worked: candidates
rose 56%, the refuter absorbed them without adjusted precision moving, the merge
collapsed 19.3 restatements per run. The build was sound and the hypothesis was
wrong. The write-up closes by asking that it be retained *"so the next person who
proposes decomposed discovery finds the measurement rather than repeating it."*

## Why the one differing row does not rescue it

The whole-file variant is not a smaller change than the windowed one. It is a
**weaker** one, and two measured facts say so.

1. **The windowed version's candidate volume came from the windows.** It made many
   calls, each emitting roughly one finding. A whole-file pass makes ONE extra call
   per file. Discovery yield is call-bound — measured — and the engine emits ~1.17
   findings per case. So the whole-file variant buys about one extra candidate per
   file where the windowed one bought 42 per run, and 42 per run yielded ~0 net
   expectations.
2. **Against the 5/5 ceiling this was supposed to be scored on, one extra candidate
   per file cannot find five specific defects.** The instrument that made this
   worth revisiting is the same instrument that shows the variant cannot clear it.

The honest reading of the difference: spec 19 confounded "remove the anchor" with
"window the file", and windowing was independently rejected on 2026-08-07 (−2.9pp
at 1.30x cost). Removing a harmful confound from a null does not make it a win when
the remaining mechanism is also the one that supplied the effect size.

## Verdict

**Dead on arrival, by the forward plan's own rule.** No pre-registration, no
precheck, no spend. The plan's Priority 1 is closed with the mechanism it named.

## What this costs and what it is worth

$0, against a $0.20 precheck plus a ~$11 full run had the search not happened —
and against the far larger cost of a second null on a question already answered.
This is the second time the "search the ledger before pre-registering" rule has
paid; it should be treated as a hard gate, not a courtesy.

## What is now closed

Six structural interventions have failed against later-in-file recall: enumeration
sweep, diverse-lens pass, cross-file retrieval, context scout, un-anchored pass, and
sub-file partitioning. Five pre-registered prompt clauses have failed on framing.
**Neither "show discovery more" nor "tell discovery differently" has an untried
member left.**
