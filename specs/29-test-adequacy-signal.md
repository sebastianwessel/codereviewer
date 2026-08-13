# 29: Test-Adequacy Signal

Status: Approved
Date: 2026-08-05

## Purpose

Report, for a change, **which of the source files it modified have no test file
paired with them in the same change**. Deterministic, free, and computed from
material the engine already produces.

It exists because of a gap rather than a hypothesis. A thorough human reviewer asks
*"does this change carry tests?"* on every pull request. Of every dimension such a
reviewer covers, this was the only one with no implementation and no spec here —
while `discoverDeterministicSignalTestMappings` had been pairing changed source
files with changed test files all along, handing the result to the model packet as
context and using it for nothing else.

Numbering continues from 28. Numbers 14 and 18–21 remain unused; no number is
reused.

## Why This Is A Neutral Fact, Not A Finding

**It sees only the changed file set.** A changed production file may be covered
completely by a test that this change had no reason to touch, and nothing in the
input can tell that apart from a file with no test at all. Everything below follows
from that one sentence.

The precedent is spec 23's extra scope, which reports a changed file no obligation
cites as *"a path and a line count and nothing else"* — deliberately, because
anything more would assert something the capability cannot know. This reports a
path and nothing at all, for the same reason and with the same restraint. Spec 23's
wording rule applies here verbatim: **nothing this signal emits — count, path or
prose — may be phrased so that "no test moved with this file" reads as "this file
is untested".**

So the signal is, and MUST remain:

- **never a finding.** It has no id, no title, no description, no proposer.
- **never a defect and never a severity.** There is nowhere in its contract to
  record one.
- **never gate-affecting.** It is not compared against a threshold, it cannot fail
  a quality gate, and it cannot change an exit code.
- **never an inline comment**, and never part of the SARIF interchange. SARIF is a
  defect format and a review comment is an annotation on a line; this is neither a
  defect nor tied to a line.
- **never model-judged.** It costs nothing and calls no provider.

The economics are the same ones spec 23 sets out for advisory output. If the signal
says something, a reviewer spends a few seconds; if it says nothing, it has
asserted nothing false and cost nothing.

**This section used to end *"There is no state in which it misleads — provided the
disclosure below travels with it."* That claim was measured false on 2026-08-08 and
is withdrawn.** The repair is precise about *which* part misleads, because the
imprecise version is also wrong:

- **The list itself is not false.** *"No test file paired with this file in this
  change"* is literally true of all 113 firings, including the 84.1% where the commit
  did change a test. Pairing failed; that is what the list reports.
- **The rendered explanation of WHY it did not pair is false for the dominant case.**
  The report attributes non-pairing to location — *"a change that keeps its tests in a
  tree of their own pairs nothing here"* — while the measured cause is a **stem
  mismatch for a test sitting in the same directory**: both relations require a shared
  normalised stem, so `intake-service.ts` does not pair with `repository-intake.test.ts`
  beside it. A reader given a location story concludes *"this team keeps its tests
  elsewhere, fine"*, an inference unavailable to the 84.1% whose test is right there
  under another name.
- **The mandated disclosure names the minority mode.** *"A file listed here may
  already be covered by an existing test the change did not need to touch"* is the
  untouched-pre-existing-test case. The measured dominant mode is different: the test
  moved **in this very change** and was not recognised. Nothing in the disclosure
  covers it.

So the state in which it misleads is a real and common one, and it is a defect of the
prose around the fact rather than of the fact. The correct claim is the narrower one:
**the signal asserts nothing false about any file it names, and the disclosure that
travels with it MUST name the measured dominant cause first** (see *Requirements*).
The measured numbers are under *Measured, 2026-08-08*.

## No Configuration Key

There is **no toggle for this capability**, and there MUST NOT be one.

A configuration key buys the ability to turn something off, and the reasons to turn
something off here are spend, latency, noise and risk. This signal has no spend and
no latency; it is one pass over a list already computed. It renders nothing when it
has nothing to say, so it cannot add noise. It cannot block anything, so it carries
no risk to switch away from. A key would be a switch nobody needs, and this project
has already shipped and then removed several of those — spec 23 states the general
rule that a dead switch is worse than its absence, because it reads as a decision
still open.

## What This Signal Does NOT Know

Stated here so no implementation can quietly widen the claim.

- **It does not know whether a file is tested.** It knows whether a test file *in
  this change* pairs with it. An existing, untouched, entirely adequate test is
  invisible to it and always will be, because the input is the diff.
- **It does not know whether a test is any good.** Nothing here inspects a test's
  assertions, its coverage, or whether it exercises the changed lines at all. A
  paired file is a file with a test *named after it*, not a file with a test *for
  this change*.
- **It does not know about a file it cannot classify.** A language the
  deterministic registry has no adapter for, or a file that never reached the
  registry, is **unknown** — a state the contract represents separately, and which
  MUST NOT be reported, rendered or counted as "no test".
- **It does not know about the rest of the repository.** No search, no retrieval,
  no index. That is what makes it free, and it is the boundary that makes the three
  points above unavoidable rather than fixable.

### Test *quality* is a different capability, and this spec does not authorise it

Raising this to a model-judged assessment of whether the tests a change carries are
*adequate* — do they exercise the changed branch, do they assert anything, would
they fail before the fix — is a **separate, unmeasured capability**. It is not
approved here, and nothing in this spec may be cited as approval for it.

It would be a different thing in every respect that matters: it would cost money
per file, it would produce a judgement rather than a fact, and it would therefore
need a corpus, a pre-registered decision rule and a false-positive budget before it
could be shown to anyone. This project's record on judgement stages built without
one is in specs 20, 21, 24 and 25 — four capabilities withdrawn after measurement,
one of them with zero true positives across ~300 hand-judged cases. A fifth attempt
starts with a measurement, not with an extension of this spec.

## Requirements

- The signal MUST be **deterministic and free**: no model call, no provider
  resolution, no network, no additional filesystem read.
- It MUST be computed from the pairing the deterministic signal registry already
  discovers, over **exactly the file set that registry analysed**. Considering a
  wider set would report a file whose test could not have been discovered even if
  the change contained it.
- It MUST be **language-neutral**. No extension list, no language name, and no
  per-language branch in its logic. Which files are source, which are test-side and
  which cannot be classified are all answered by the deterministic
  language-support registry — the same registry that decides which files can be
  analysed at all. Spec 15's Non-Negotiable applies.
- It MUST reuse the engine's single definition of "is this a test file"
  (`shared/test-discovery.ts`). A second definition of testhood is forbidden.
- It MUST NOT fire for any of the following, and each MUST be a deliberate,
  separately tested exclusion:
  - a change with **no source files at all** (documentation-only, configuration-only);
  - a **test-only change**;
  - a **test-side file that holds no test case of its own** — a fixture, a harness,
    a shared assertion helper;
  - a **file the change deleted**: it has nothing at head that could carry a test;
  - a file in a **language the registry does not support**: a file it cannot parse
    is unknown, not untested;
  - a **file that never reached the registry** — too large, binary, excluded by
    pattern, over the file cap: the pairing was computed without it, so its absence
    from the pairing says nothing.
- **Unknown MUST be representable and MUST be distinguishable from "no test
  needed".** This codebase has a documented, recurring defect class in which a
  missing value produces a plausible optimistic answer instead of an error; a
  signal that rendered "unknown" as a confident zero would be a new instance of it.
- The report MUST state, wherever the signal is rendered and in the same place as
  the list itself, that **a file it names may already be covered by an existing
  test the change did not need to touch**. A footnote elsewhere does not satisfy
  this.
- **The disclosure MUST name the measured dominant cause of non-pairing, and MUST
  name it before the pre-existing-test case.** That cause is a differently-named test
  *inside this same change* — 84.1% of firings on the only population ever measured
  (*Measured, 2026-08-08*). Any prose that explains non-pairing by where tests live
  is asserting a cause that was measured to be the minority one, which is the same
  error as asserting a cause that was never checked.
- **When `changedTestFileCount > 0` the rendering MUST qualify the list with that
  fact**, in the same place as the list: the change did carry tests and they did not
  pair by name. The contract already carries the field, so this costs a sentence and
  no new data.

  > **Known divergence, recorded 2026-08-13 and owed as a change.** The renderer does
  > not satisfy the two requirements above. `src/domains/reporting/markdown-reporter.ts`
  > prints `changedTestFileCount` and then explains non-pairing as *"a change that
  > keeps its tests in a tree of their own pairs nothing here"* — the location story,
  > for every firing, whatever the count is. This is recorded rather than quietly
  > softened into a requirement the code already meets: the reader-facing defect is
  > the point of the finding, and a spec that lowered its bar to match the renderer
  > would be the same manoeuvre this spec refused when it declined to loosen pairing
  > after seeing a failing number.
- The rendered report MUST show **nothing at all** when there is nothing to
  observe. An empty section under a heading reads as a clearance, which is the
  error the review report is arranged against throughout.
- The signal MUST be **subordinate to the findings**: it is rendered after them,
  never above them, and never in the summary a skimming reader takes away.
- The JSON contract field MUST be **optional**, and absent MUST mean *this run did
  not compute it* — a different claim from a computed result whose counts are zero.
- Its contract MUST carry **no free-text field**, no id and no severity. The shape
  is what keeps it a fact; a renderer that has to remember is not a guarantee.

## Contract

Reported on the review report as `testAdequacy`:

| field | meaning |
| --- | --- |
| `consideredFileCount` | changed files the question could be asked of: analysed by the registry, in a supported language, not themselves test material |
| `pairedFileCount` | of those, the ones a test file **in this change** pairs with |
| `unpairedPaths` | the rest, sorted. A path and nothing else |
| `changedTestFileCount` | test-side files the change touched, so the list above can be read against it |
| `unknown.unsupportedLanguageFileCount` | changed files in a language the registry has no adapter for |
| `unknown.notAnalysedFileCount` | changed files that never reached the registry |

`consideredFileCount` equals `pairedFileCount` plus the length of `unpairedPaths`,
enforced by the schema: the count and the list are two views of one partition, and
a producer allowed to let them disagree publishes a total a reader cannot
reconstruct.

Deleted paths appear in none of these fields, including the unknown counts.

## Measured, 2026-08-08 — And Why It Stays Off The Summary

Measured for the first time against a budget pre-registered before the numbers
existed (`reports/2026-08-08-test-adequacy-prereg.md`), over 200 self-repo commits,
deterministically and at zero cost.

| metric | measured | budget | |
| --- | --- | --- | --- |
| firing rate | **56.5%** (113/200) | ≤ 40% | fails |
| median unpaired when fired | 2 | ≤ 5 | passes |
| usefulness (objective proxy) | **≤ 16%** | ≥ 50% | fails |

**The signal is NOT promoted to the pull-request summary.** Two of three criteria
fail. Its placement below — `report.json` and `report.md` only — is now confirmed by
measurement rather than assumed.

**Two ways the evidence recorded is not the evidence registered, stated because the
decision is the right one and does not need them hidden.**

- **The usefulness endpoint was substituted after the fact.** The pre-registration
  fixed it as *"would a reviewer plausibly ask for a test here? Judged by reading the
  change, by me, recorded case by case"* over a 20-firing sample. What was measured is
  *"did the same commit change any test file"* — a different quantity, chosen after
  the run because it is cheaper and more objective. It is a defensible substitution
  and it moves the result in the **unfavourable** direction, so it did not manufacture
  a pass; but a bar cleared or missed by a metric chosen after the numbers exist is
  not the bar that was pre-registered, and this spec says so rather than letting
  "≤ 16% against ≥ 50%" read as the registered comparison.
- **Only one of the two registered populations was measured.** The pre-registration
  named self-repo history *and* the 72-case advisory corpus — the latter as *"the
  population where firing is most defensible"*, every case adding vulnerable code a
  reviewer would want a test for. It was never run. The firing rate and the usefulness
  proxy above therefore describe ordinary repository work only, which is the
  population the signal looks **worst** on by construction. Nothing here establishes
  what it does where a test is genuinely owed, and no figure may be quoted as if it
  did.

Neither gap is a reason to revisit the placement decision: two criteria failed on the
population that was measured, and the unmeasured population could only move the
usefulness criterion, not the firing rate. They are recorded because the next person
to ask "has this been measured?" deserves the answer *"on one of two populations, on
a proxy endpoint"* rather than *"yes"*.

### Pairing is by STEM, and that is the dominant firing mode

**95 of 113 firings (84.1%) are on commits that changed a test file.** The change was
tested; the test simply does not share the source file's stem.

Both relations require a shared normalized stem: `direct` maps a test to itself, and
`same-directory` requires same directory **and** same stem. Nothing pairs a source
file with a differently-named test beside it. So `intake-service.ts` does not pair
with `repository-intake.test.ts`, which sits next to it and tests it.

That is this spec working as written — pairing follows "each language's own
convention", and naming a test after its module is that convention. The measurement
establishes that **the convention does not hold in this repository**, and probably
not in others where tests are named for the subject rather than the file.

`same-directory` is therefore a misleading name for the relation: it reads as "a test
in the same directory" and means "same directory and same stem", which is a looser
spelling of `direct` rather than a different relation.

**Loosening pairing to any test in the directory is explicitly NOT the fix.** It
would convert a failed pre-registered bar into a pass, go near-silent in any
repository with a top-level `tests/` tree, and is unmeasured. Revisiting the pairing
model requires its own measurement.

### Nearly half of changed files cannot be asked about

**703 of 1541 changed files (45.6%) land in `unknown`** — docs, specs, reports, JSON,
YAML — and 70 of 200 commits contain no considered file at all. The schema keeps
`unknown` apart from `unpaired`, so nothing is misreported, but the signal's scope is
much narrower than "changed files" and any reading of its firing rate carries that
denominator.

## Where It Surfaces

Two places, and deliberately only two.

- **The JSON report** (`report.json`), because it is the machine-readable contract
  and the only artefact a later evaluation can read back.
- **The Markdown report** (`report.md`), because that is the artefact a human
  actually reads, rendered near the end, after every findings section.

Not SARIF, which is a defect interchange format. Not the review-comment drafts,
which are annotations on specific lines. Not the quality gate. Not the summary.

## Verification Matrix

| Requirement | Test |
| --- | --- |
| Reports a changed source file with no test file in the same change | `test-adequacy-signal.test.ts`: reports a changed source file with no test file in the same change |
| Does not report a source file whose test is in the same change | `test-adequacy-signal.test.ts`: does not report a source file whose test file is in the same change |
| Pairs by each language's own convention, with no language named in logic | `test-adequacy-signal.test.ts`: pairs by each language own convention, not by one language convention |
| Language-neutral: no language id and no extension literal in the module | `test-adequacy-genericity.test.ts`: no source names a language the registry owns; no source tests a file extension of its own |
| Reuses the single test-file definition rather than adding a second | `test-adequacy-genericity.test.ts`: classification is delegated to the registry rather than redefined |
| Exclusion — a change with no source files at all | `test-adequacy-signal.test.ts`: does not fire for a change with no source files at all |
| Exclusion — a test-only change | `test-adequacy-signal.test.ts`: does not fire for a test-only change |
| Exclusion — a test-side file holding no test case | `test-adequacy-signal.test.ts`: does not report a test-side helper that holds no test case |
| Exclusion — a file the change deleted | `test-adequacy-signal.test.ts`: does not report a file the change deleted, and `completion-state.test.ts`: records the test-adequacy signal on the completed report |
| Exclusion — an unsupported language is unknown, never untested | `test-adequacy-signal.test.ts`: reports a file in an unsupported language as unknown, never as untested |
| Exclusion — a file that never reached the registry is unknown | `test-adequacy-signal.test.ts`: reports a changed file that never reached the registry as unknown |
| A test file does not pair with itself | `test-adequacy-signal.test.ts`: a test file does not pair with itself into the considered set |
| Deterministic output, independent of intake order and path separator | `test-adequacy-signal.test.ts`: orders the unpaired paths…; normalizes a Windows-style path… |
| Absent is distinguishable from a computed zero | `review-report.schema.test.ts`: carries the optional test-adequacy signal, and distinguishes absent from zero |
| The counts cannot disagree with the list | `review-report.schema.test.ts`: rejects a test-adequacy signal whose counts disagree with its own list |
| The contract cannot carry a severity or any other finding field | `review-report.schema.test.ts`: the test-adequacy signal cannot carry a severity or any other finding field |
| The rendered report discloses what the signal cannot know | `markdown-reporter.test.ts`: reports source files with no test in the change, and says what it cannot know |
| Subordinate to the findings | `markdown-reporter.test.ts`: the signal is subordinate to the findings a reviewer came for |
| Unknown is rendered apart from unpaired | `markdown-reporter.test.ts`: separates what went unpaired from what could not be asked |
| Nothing is rendered when there is nothing to observe | `markdown-reporter.test.ts`: renders no heading when there is nothing to observe or nothing was computed |
| Reaches the JSON contract | `json-reporter.test.ts`: carries the test-adequacy signal through to the JSON contract |
| Reaches neither SARIF nor the review-comment drafts | `json-reporter.test.ts`: the test-adequacy signal reaches neither SARIF nor the review-comment drafts |
| Computed on the completed run, advisory only | `completion-state.test.ts`: records the test-adequacy signal on the completed report |
| No model call and no configuration key | the whole suite is hermetic and free; no key exists to test |
