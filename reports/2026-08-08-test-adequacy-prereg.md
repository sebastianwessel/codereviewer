# Pre-registration: the test-adequacy signal's noise budget

**Written before the signal has ever been measured.** No provider calls are involved
at any point — the signal is deterministic, so this costs nothing but is registered
anyway, because the rule has to exist before the number does.

## What is being measured

Spec 29's signal reports **changed source files with no paired test file in the same
change**. It is built, deterministic, rendered in `report.json` and `report.md`, and
explicitly *never a finding*: no severity, no gate, no review comment.

It has never been measured. Nobody knows how often it fires or whether what it
reports is worth a reader's attention.

## Why a budget, and why now

The conformance lane (spec 24) was killed for firing **7.0 reports per range against
a ~0.5 noise budget — 14× over — with zero true positives across ~300 hand-judged
divergences**. That kill was clean *only because the budget was set before the
measurement*. Test adequacy is the next advisory signal in line for promotion to a
more visible surface, and the same discipline applies before it gets there.

This registration exists specifically to stop me promoting it to the pull-request
summary on the strength of a number I liked after seeing it.

## Population

Two populations, both already on disk, no new curation:

1. **Self-repo history** — the last 200 commits of this repository, each treated as
   a change. Real changes by real authors, including the many that legitimately
   ship without tests (docs, specs, reports, config).
2. **The advisory corpus** — 72 reverse-oriented cases. Every one of these adds
   vulnerable code, so a reviewer *would* want a test; this is the population where
   firing is most defensible.

The two answer different questions and are **not pooled**: (1) measures noise in
ordinary work, (2) measures usefulness where a test is genuinely owed.

## Metrics, fixed now

- **Firing rate**: share of changes where `unpairedPaths` is non-empty.
- **Volume when it fires**: median and p90 length of `unpairedPaths`.
- **Unknown rate**: share of changed files landing in
  `unknown.unsupportedLanguageFileCount` / `notAnalysedFileCount` — a signal that
  cannot see a file must not be read as that file being fine.
- **Adjudicated usefulness** on a sample of 20 firings from population (1): would a
  reviewer plausibly ask for a test here? Judged by reading the change, by me,
  recorded case by case so the judgement is checkable rather than asserted.

## Decision rule

**Promote to the pull-request summary** only if all three hold:

1. firing rate on self-repo history is **≤ 40%** of changes — above that it is
   wallpaper and readers learn to skip it;
2. median `unpairedPaths` when it fires is **≤ 5** — a list longer than that is not
   read;
3. adjudicated usefulness on the 20-case sample is **≥ 50%** — at least half the
   firings name a file a reviewer would genuinely want a test for.

**Keep exactly where it is** (report.json + report.md, never the summary, never a
finding) if it misses any of those. This is the expected outcome and is not a
failure: the signal is cheap, honest, and already correctly placed.

**Remove it** only if it fires on essentially everything (**> 80%**), which would
make it pure noise carrying a maintenance cost.

## Committed in advance

- The budget above is not revised after seeing the numbers. If the result is close
  to a threshold, it misses.
- No prompt, no model, no provider call is added to this signal whatever the result.
  Spec 29's "deterministic, never a finding" property is not on the table; the only
  question is which surface it belongs on.
- If it fires far more on the advisory corpus than on self-repo history, that is
  reported as a property of the corpora, **not** as evidence the signal is good.
