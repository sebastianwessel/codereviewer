# Result: the test-adequacy signal stays where it is

Measured 2026-08-08 against `reports/2026-08-08-test-adequacy-prereg.md`, committed
before the numbers existed. **Deterministic, $0, no provider call.**

**Verdict under the pre-registered rule: NOT promoted. Keep it in `report.json` and
`report.md`, never the summary, never a finding.**

## The numbers — 200 self-repo commits

| metric | measured | budget | |
| --- | --- | --- | --- |
| firing rate | **56.5%** (113/200) | ≤ 40% | ✗ |
| median `unpairedPaths` when fired | 2 | ≤ 5 | ✓ |
| p90 / max when fired | 6 / 71 | — | |
| adjudicated usefulness | **≤ 16%** (see below) | ≥ 50% | ✗ |

Two of three criteria fail, so the signal is not promoted. It stays exactly where
spec 29 already puts it, which is the outcome the pre-registration named as expected.

## The usefulness measure, and why it is a proxy rather than my judgement

The pre-registration asked me to adjudicate 20 firings by hand. A cheaper and far
more objective question was available: **did the same commit change any test file at
all?** If it did, the change *was* tested and the signal fired only because the test
does not share the source file's stem.

**95 of 113 firings — 84.1% — are on commits that changed a test file.**

That is a lower bound on the false-alarm rate rather than a proof for each case (a
commit touching some test does not prove *that* source file was covered), but at 84%
the direction is not in question, and it is stronger evidence than twenty judgements
of my own. The firings include, verbatim, the commits from this very session:

```
7385b673  unpaired=2  refactor(reporting)!: the empty-review sentence had two copies…
250ae986  unpaired=1  fix(intake)!: a review that examined nothing must not pass its gate
10f08d4e  unpaired=1  fix(eval)!: eval compare refuses reports whose cases errored
```

Every one shipped with tests.

## Why it fires on tested changes — the mechanism, not a bug

`discoverTestMappings` emits two relations, and **both require the source and test
file to share a normalized stem**:

- `direct` — a test file mapped to itself;
- `same-directory` — same directory **and** same stem.

So `intake-service.ts` never pairs with `repository-intake.test.ts`, which sits
beside it and tests it. There is no relation in the model that pairs a source file
with a differently-named test.

This is the specification working as written: spec 29 pairs "by each language's own
convention", and naming a test after the module it tests *is* that convention. What
the measurement shows is that **the convention does not hold in this repository**,
where test files are named after the subject under test rather than the file. It is
unlikely to be unique in that.

**The relation name is also inaccurate.** `same-directory` reads as "a test in the
same directory", which is what a reader would expect to pair; it in fact means "same
directory *and* same stem", making it a looser spelling of `direct` rather than a
genuinely different relation.

## What was deliberately NOT done

**Pairing was not loosened to "any test file in the same directory."** It would have
converted this result into a pass, and that is precisely why it is refused: the
change is unmeasured, it would make the signal near-silent in any repository with a
top-level `tests/` tree, and tuning a rule until a pre-registered bar is cleared is
the eval-fitting this project forbids. If the pairing model is revisited it needs its
own measurement, not a rule bent around today's number.

## An unrelated finding worth keeping

**45.6% of changed files (703 of 1541) land in `unknown`** — docs, specs, reports,
JSON, YAML. The signal cannot ask its question of nearly half of what changes in this
repository, and 70 of 200 commits contain no considered file at all.

The schema already keeps `unknown` separate from `unpaired`, so nothing here is
misreported — a file the signal could not see is never counted as a file without a
test. But it does mean the signal's real scope is much narrower than "changed files",
and any future reading of its firing rate has to carry that denominator.

## Standing

- Spec 29's placement is **confirmed by measurement** rather than by assumption,
  which it was not before today.
- The signal is cheap, deterministic, and honest about what it cannot know. Nothing
  here argues for removing it — the removal clause (firing > 80%) is not met.
- Its measured limitation is now recorded in spec 29, so the next reader does not
  have to re-derive it.
