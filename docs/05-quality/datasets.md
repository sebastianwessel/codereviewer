# Datasets

Seven corpora exist, and they measure genuinely different things. Quoting a number
without naming its corpus is meaningless — recall on a curated-subset answer key
and recall on an exhaustive one are not the same quantity.

| Corpus | Location | Cases | Expected findings | Hydration | Primarily measures |
| --- | --- | --- | --- | --- | --- |
| Default fixture pack | `eval/fixtures/sample-eval-cases.json` | 7 | **0** | none | False-positive suppression only |
| Code Review Bench-style | `eval/benchmarks/code-review-bench-style/` | 59 | 133 | **required** | Recall/precision on real PRs, changed files only |
| Proof-quality slices | `eval/fixtures/proof-quality-slices/` | 15 | 14 | none | Trustworthy recall on an exhaustive key |
| Real-repository cross-file | `eval/corpora/real-repo-cross-file/manifest.json` | 37 | 87 | **required** | Cross-file recall on full checkouts, and review of multi-file diffs |
| Security advisory 2026 | `eval/corpora/security-advisory-2026/manifest.json` | 72 | 74 | **required** | Security recall per mechanism and per context depth, on advisory-confirmed defects |
| Change-impact dependents | `eval/corpora/change-impact-dependents/manifest.json` | 10 | 11 | **required** | Whether `impact check` names a dependent a change provably broke |
| Fix-lane fixture | `eval/fixtures/typescript/fix-lane/repo/` | 1 (test-only) | — | none | Fix-lane judgment, via a hermetic test |

> **The real-repository and change-impact corpora must never be pooled.** They are
> structural opposites: the real-repository corpus reads a fix backwards and
> requires every expectation **inside** the reviewed diff, while the change-impact
> corpus reads a change forwards and requires every expectation **outside** it.
> Blending them is the measurement error that made this project's headline recall
> uninterpretable for months.
>
> The security-advisory corpus shares the real-repository corpus's orientation and
> its manifest schema, and is still a separate corpus with a separate output root:
> it asks whether the reviewer finds an **advisory-named security defect**, which
> is a narrower question with a differently constructed answer key. Its recall is
> not differenceable against the cross-file corpus's either.

---

## Default fixture pack

**What it is.** `eval/fixtures/sample-eval-cases.json` — the case set loaded when
`eval run` is invoked **without** `--slice-root`.

Seven cases, and **every one of them declares `expectedFindings: []`**. Each
declares exactly one `expectedNoFindingZone` instead:

| Case id | Language | Fixture repo | Assertion |
| --- | --- | --- | --- |
| `typescript-negative` | typescript | `eval/fixtures/typescript/negative` | Formatting-only changes must not produce findings |
| `model-refutation-control` | typescript | `eval/fixtures/typescript/model-refutation-control` | Model-only concerns in valid fallback logic must be refuted or kept non-actionable |
| `javascript-negative` | javascript | `eval/fixtures/javascript/negative` | Valid JavaScript must not produce syntax findings |
| `python-negative` | python | `eval/fixtures/python/negative` | Valid Python must not produce syntax findings |
| `go-negative` | go | `eval/fixtures/go/negative` | Valid Go must not produce syntax findings |
| `rust-negative` | rust | `eval/fixtures/rust/negative` | Valid Rust must not produce syntax findings |
| `java-negative` | java | `eval/fixtures/java/negative` | Valid Java must not produce syntax findings |

**Six languages** — TypeScript, JavaScript, Python, Go, Rust, Java. There is **no
Ruby case**, and there is **no positive diagnostic case anywhere in the pack**.

**What it can measure.** `parseValidity`, `falsePositiveCount`,
`noFindingZoneFalsePositiveCount`, `commentsPerKloc`, cost, latency, and provider
health. It is a fast, cheap noise-suppression smoke test.

**What it cannot measure.** Anything involving recall. With a zero denominator,
`recall`, `productRecall` and `precision` all report their empty value of `1`.
A perfect score here is not a result — it is the absence of one.

> **Matching needs no judge here.** With no expected findings, no case triggers a
> semantic-match call, so the pack is the one corpus that scores fully
> deterministically with no provider at all — and in that configuration
> `scoring.judgeTrustworthy: true` means "there was no semantic authority to
> distrust", not "the judge was verified". Note that if a provider *is*
> configured, both judges are still constructed and still calibrated (23 judge
> calls), so a "free" smoke run is not free.

**The missing slice directory.** Default loading concatenates the JSON case set
with slice cases from `eval/fixtures/slices/<case-id>/slice.json`. **That
directory does not exist in this repository.** The loader treats `ENOENT` as an
empty result, so default discovery yields exactly the seven negative cases above.
Documentation describing a populated `eval/fixtures/slices/` layout is describing
a path that is not there.

---

## Code Review Bench-style pack

**What it is.** `eval/benchmarks/code-review-bench-style/` — 59 committed slice
directories adapting the open Code Review Bench golden-comment shape
(methodology: `withmartian/code-review-benchmark`, MIT) into self-contained
eval slices. Every case is `sourceProfile: captured-pr`.

**Composition:**

- **49 positive cases** carrying **133 expected findings**, captured from PRs in
  five upstream projects: cal.com, Discourse, Grafana, Keycloak, Sentry
  (10 cases each, minus one dropped Sentry case).
- **10 negative cases**, all named `crb-noise-*`. These are **hand-built
  negatives, not real PRs** — synthetic comment-only, format-only, rename-only,
  docstring-only and copy-only diffs written to assert "no actionable finding".
  They carry the pack's provenance metadata but no `prUrl`.
- 59 no-finding zones, one per case.
- Languages: TypeScript 12, Ruby 12, Go 12, Java 12, Python 11.

**Expected-finding shape.** All 133 expectations are **`semantic-only`** — no
path, no line range. Tiers: 45 `runtime-critical`, 43 `logic`, 29 `nit`,
16 `security`.

**Hydration is mandatory.** All 49 positive slices are committed as
*metadata-only placeholders*: their `diff` contains the marker
`Minimal source exists` instead of real code. Running `eval run` against the
committed pack aborts before scoring with
*"Benchmark slices are not hydrated"* — deliberately, because scoring a
placeholder would silently report a false 0% recall. `npm run eval:hydrate`
fetches the public PR diffs and materializes head-side files into
`.codereviewer/eval/benchmark-slices/code-review-bench-style/`; point
`--slice-root` there.
→ [Running an evaluation](running-an-evaluation.md#hydration)

**What it can measure.** Recall and precision at scale on real PR content,
severity accuracy, tiered recall, cost and latency, and per-language segments.

**What it cannot measure.**

- **Line accuracy.** `semantic-only` expectations never set `lineOverlaps`, and
  none declares a `lineRange`, so `lineAccuracy` renders `n/a (0 checked)`.
- **Cross-file defects.** Slices contain only the files the PR changed. A defect
  whose evidence lives in an unchanged file is not on disk, so no reviewer could
  find it.

**Known limitations.**

- **The answer keys are curated subsets.** Golden comments are what a human
  reviewer happened to write, not an enumeration of the defects present. Recall
  is understated and raw precision is badly understated — this pack is exactly
  why `adjustedPrecision` exists.
- **Public benchmark data can be contaminated.** Public golden comments may be in
  model training data. Spec 06 requires results from this pack to be labeled
  `benchmark-semantic` and forbids using them as sole release evidence.
- **The negatives are synthetic**, so noise measured on them is a lower bound —
  a hand-written comment-only diff is easier to stay quiet on than a real one.
- The pack's own README references an `eval:semantic` npm script that no longer
  exists; use `--slice-root` against the hydrated root instead.

---

## Proof-quality slices

**What it is.** `eval/fixtures/proof-quality-slices/` — 15 project-owned slices,
committed **complete**: each has `slice.json`, a real `repo/` tree, and a real
diff. No hydration, no placeholders, no network.

**Composition:**

- 12 positive cases carrying **14 expected findings**; 3 negative
  `refutation-control` cases with no-finding zones.
- Languages: TypeScript 7, Python 3, Go 3, Java 1, Rust 1.
- Categories: 8 `bug`, 4 `security`, 2 `performance`.
- Every case is tagged `proof-quality` and `project-owned`; one is tagged
  `cross-file` and ships a second, unchanged file in its `repo/` tree.

**Expected-finding shape.** All 14 are **`path-line`** — full path plus line
range. This is the only corpus that exercises the `path-line` gate.

**What it can measure.** This is the only corpus with a **deliberately exhaustive
answer key**: the defects in each slice were authored, so the key is complete
rather than curated. That makes recall here trustworthy in a way recall on the
other corpora is not, and makes it the only corpus on which `lineAccuracy` is a
real measurement. The refutation-control cases test that a model-only concern in
valid code gets refuted rather than admitted.

**What it cannot measure.**

- **Realism.** The slices are authored fixtures with the defect as the point of
  the file. They cannot show whether a defect survives being buried in ten
  thousand lines of unrelated production code.
- **Scale.** 14 expected findings; a single finding moves recall by ~7 points.

**Known limitations.** Small; authored by the same project that is being
measured, so the defect classes reflect what the authors thought to test for.

---

## Real-repository cross-file corpus

**What it is.** `eval/corpora/real-repo-cross-file/manifest.json` — 37 cases
pinning **real upstream repositories, checked out in full** at the commit
immediately before an upstream fix landed. Defined by `specs/17`.

### Why full checkouts exist

This is the load-bearing point of the corpus. Changed-files-only slices cannot
test a cross-file defect **at all**: if the evidence lives in an unchanged file,
the evidence is not on disk, no reviewer however good could find it, and any
"cross-file recall" measured against such a slice is a property of the dataset,
not of the engine. Agentic cross-file discovery (`specs/16`) is unevaluable on
them.

A hydrated case here yields a working tree containing the repository's unchanged
files, so a finding that depends on a callee body, an interface, or a constructor
in an untouched file is reachable — exactly as it would be for a developer.

**16 of the 87 expected findings are labeled `contextDepth: cross-file`**, plus
four `cross-function`, one `callee` and one `caller`; only 4 are `local`. (The
labels are carried by security-category findings only, which is why the other 61
findings have none.)

### Why multi-file cases exist

The second load-bearing point, added after the first baseline. 29 of the cases
change exactly one file, and on such a case task clustering, context packing,
per-task budget on a wide diff and any dilution of attention across files are not
merely weak — they are **never exercised**. Real pull requests are not
single-file, so eight cases now carry reviewed diffs spanning 2 to 6 files. Two
of them (`traefik-…-nil-check`, `laravel-eloquent-dictionary-key-not-normalized`)
repeat the same defect in every file they touch, so a review that reports the
first file and stops scores visibly differently from one that works the whole
diff. See `specs/17` §Diff Shape.

### Shape

- **Manifest committed, checkouts not.** A corpus of full repositories is orders
  of magnitude larger than this repository and never enters its history.
  Working trees are produced on demand into the git-ignored artifact directory.
- Each case pins the **fix commit** and its **parent**. The parent is checked out
  as the working tree (the pre-fix state, which still contains the defect); the
  fix commit supplies the reviewed diff, read backwards.
- Fetches are depth-limited to the pinned commit, so a case costs one commit, not
  a repository history. Hydration performs **git fetches only** — no model call,
  no provider spend.

### Composition

- 37 cases, 87 expected findings, **all `split: held-out`**.
- 27 upstream projects, including fastify, gin, tokio, django, netty, rack,
  werkzeug, starlette, typeorm, aspnetcore, libuv, plug, traefik, laravel, vite,
  pydantic, grpc-go.
- 12 languages: Go 8, Python 6, Ruby 5, JavaScript 4, TypeScript 3, C# 3, PHP 2,
  Rust 2, and one each of Kotlin, C, Elixir, Java.
- Licenses: MIT 23, Apache-2.0 7, BSD-3-Clause 7 (permissive allowlist enforced).
- Tiers: 48 `logic`, 26 `security`, 13 `runtime-critical`. No nits.
- Severities: 29 `high`, 46 `medium`, 12 `low`. No `critical`.
- Findings per case: 7 cases with one, 16 with two, 10 with three, 3 with four,
  1 with six. Expectations per case is a curated property, not a by-product of
  capture — see `specs/17` §Expectations Per Case for why, and for the rule that
  no expectation may be promoted from engine output.
- Reviewed diff shape: **29 single-file and 8 multi-file cases** (2, 2, 2, 2, 3,
  5, 6, 6 files), 57 reviewed files in total.
- Expected-finding shape: all 87 are **`path-semantic`** (path required, no line
  gate) — though each still carries a `lineRange` field.
- **8 no-finding zones**, one each on 8 cases, all line-ranged and all inside a
  reviewed path (see below).

The corpus changed twice on **2026-07-27**. Five cases were removed because their
reviewed diff deleted a comment that gave the defect away, and eleven cases
captured to make the iterative review loop measurable were adjudicated against the
same rule, of which six were kept and five dropped — see *Anti-contamination*
below. Every recall figure published before that date was measured against a
different answer key.

Ten of the 37 cases now carry **two or more in-diff expectations in the same
file**, and five more carry two or more spread across different files. That is
what makes rounds-to-clean measurable at all: a defect outside the diff cannot be
brought into scope by repairing anything. Counts recomputed from the manifest and
the hydrated diffs, not measured.

### No-finding zones on this corpus

Every case here contains a known defect, so without declared clean regions
`noFindingZoneFalsePositiveCount` was pinned at zero and answered nothing about
false alarms. Eight cases declare one line-ranged zone each, over code that was
read at the parent commit and is structurally unrelated to the case's defect:
delegating interface accessors (`golang-jwt`), pure serializers (`werkzeug`),
date-formatting lookup tables (`plug`), a future constructor (`tokio-util`), a
`FromIterator` impl (`axum`), the one-line HTTP verb predicates (`rack`), three
mutex-guarded readers (`puma`), and a nil-skipping name lister (`gin`). Two more
zones went with the `apisix` and `nestjs` cases when those were removed for
answer-key disclosure.

Two invariants are enforced by test (`real-repo-corpus.schema.test.ts`), because
a wrong zone manufactures false "false positives" rather than measuring them:
a zone must name a **reviewed path**, and must carry a **`lineRange`** that does
**not overlap** any expected finding in the same file. Zones were additionally
cross-checked against every archived `eval-report.json` so that no region the
plausibility judge has credited as an `unlistedReal` defect is declared clean.

These zones are a conservative negative control: they fire only if the reviewer
starts flagging code that is plainly fine. They do not make this corpus a
false-alarm benchmark — see the limitation below.

### Anti-contamination, enforced as validation

The manifest encodes spec 06's policy as validated data, so a violation fails
loading instead of silently inflating a score:

| Rule | Enforcement |
| --- | --- |
| **Temporal cutoff** | The manifest declares `modelTrainingCutoff` (currently `2026-01-01`). A `held-out` case whose fix commit predates it is rejected. Re-setting the cutoff each model generation invalidates older held-out cases — that is the intended effect. |
| **Chronological split** | Cases are `dev` or `held-out`. Improvements are decided on `held-out`. A held-out case may not predate the newest dev case. |
| **Split integrity is declared, not assumed** | The chronological rule compares nothing when one split is empty, so it used to pass while checking nothing. The manifest now declares `splitIntegrity`, and it is cross-checked: claiming `chronological-split` with one split empty is rejected, and a `single-split` corpus must carry a written note saying what its figures mean. This corpus is `single-split`. |
| **Answer-key exclusion** | No field reaching the reviewed input may carry a CVE id, advisory text, or the fix commit message. |
| **Answer-key exclusion in the generated diff** | Hydration scans the **generated diff** for answer-key wording and fails the case, on a freshly generated diff and on one reused from an existing checkout alike. An upstream fix that also added an advisory reference puts the answer inside the model's input when read backwards. Curation found this in five candidate cases — one had already entered the corpus. |
| **Removed-comment disclosure** | Advisory vocabulary cannot catch a plain engineering comment. A case reviews the fix backwards, so a comment the fix *added* is a **removed** line the reviewer is shown. Hydration flags removed comment lines carrying prose (a comment marker plus five or more words) and **fails the case until a curator resolves each flagged comment** in `removedCommentDisclosureReview`. The rule is fuzzy, so it warns rather than hard-fails; the advisory scan stays a hard failure because it is specific. On the eleven convergence candidates captured on 2026-07-27 it flagged **eight**, five of which were genuinely disclosing and were dropped. |
| **Dedup** | A token-normalized diff fingerprint is recorded per case. |
| **Provenance** | License, source and capture date required; non-permissive licenses rejected. |

Hydration is idempotent and integrity-checked: a checkout on the wrong commit is
repaired, an interrupted one is rebuilt from an empty directory, and a checkout
whose case the manifest no longer defines is **pruned** (an eval loads a slice
root by directory, so a leftover would silently re-enter the next measurement).
Pruning is skipped when `--case` filters are in effect.

### What it can and cannot measure

**Can:** cross-file recall as a genuine property of the engine; security recall
by mechanism and by context depth; the obvious-vs-hard split; the multi-finding
stopping behaviour described in [Metrics](metrics.md#3-recall-on-an-incomplete-answer-key-understates-badly).

**Cannot:**

- **Line accuracy.** All expectations are `path-semantic`, and only a `path-line`
  expectation can satisfy the line check, so nothing here enters the denominator:
  `lineAccuracy` reports `n/a (0 checked)`. It used to count these expectations
  in the denominator while leaving the numerator unreachable, and so reported
  `0.0%` — a metric that structurally could not pass, displayed as one that had
  failed. Line placement on this corpus is measurable only through the diagnostic
  `linePlacementRate`, which scores every matched expectation carrying a
  `lineRange` regardless of match mode.
  → [the full explanation](metrics.md#location-and-priority-accuracy)
- **Nit-tier behaviour.** No nit expectations exist; `nitRecall` reports its
  empty value of `1`.

**Known limitations.**

- **The answer key is still curated.** 87 findings across 27 real repositories
  cannot be exhaustive; recall is a lower bound and `adjustedPrecision` is the
  precision to read. In the multi-file cases the incompleteness is deliberate in
  places: `laravel-eloquent-dictionary-key-not-normalized` lists three of the six
  files it touches, because the other three repeat the listed root cause.
- **Most published baselines predate the current key.** The 2026-07-26 run
  scored 30 cases and 42 findings; the key then grew to 58 findings with the
  multi-file cases and to 80 by curating expectations per case, shrank to 74
  across 31 cases when five disclosing cases were removed, and grew again to
  **87 across 37 cases** with the convergence capture on 2026-07-27. Any
  comparison against a run on today's 37/87 corpus is a comparison of different
  denominators, and the comparison tooling refuses it outright: it compares the
  per-case answer-key digest and will not report a delta across a changed key.
  Two figures now ARE on today's corpus and key: the 2026-08-02 pinned-engine
  baseline (three runs, engine `6781a26`, 61.1% in-diff recall) and the current
  2026-08-05 pinned-engine baseline (three runs, engine `db78900`, 68.3%
  in-diff recall, sd 2.89pp) — see [Current
  results](current-results.md#current-headline). Every earlier figure in this
  documentation remains not comparable to a run on today's corpus.
- **Checkouts are untrusted input.** Repository content is reviewed, never
  executed; the eligibility gate and redaction apply to it as to any repository.
- **Cost.** Reviewing full repositories is the expensive corpus. The 30-case run
  cost on the order of one to two dollars of provider spend; the corpus is now 37
  cases, and the eight multi-file ones are the widest diffs in it, so budget more
  rather than less. The 2026-07 growth from 58 to 80 expected findings added no
  cost at all — provider spend follows cases, not expectations, which is exactly
  why expectations per case is the lever the corpus grows on.
- **Held-out only, and therefore iteration-contaminated.** There is no `dev`
  split, so every baseline, A/B, and prompt change this project has measured was
  decided on these same 37 cases — precisely the role a dev set exists to fill.
  The cases are post-cutoff, so this is not *training* contamination, but the
  effect on a "held-out" claim is the same: **read every figure from this corpus
  as a dev-set figure.** It does not satisfy any held-out acceptance criterion,
  including the pre-registered decision rule for analyzer-signal ingestion. The
  manifest states this in `splitIntegrity.contaminationNote`. The fix is
  capturing genuinely newer cases and re-labelling the current set as `dev`;
  re-labelling cases without new material would manufacture a held-out set.
- **No fully clean case.** Every case carries a defect. The manifest schema
  requires `expectedFindings` to be non-empty, and the case model is a fix
  commit reviewed backwards from its parent, which has no meaning for a pull
  request that fixes nothing. A defect-free upstream change therefore cannot be
  expressed here today; the eight zones are a partial substitute measured on
  regions, not on whole changes. What it would take is recorded in
  `specs/17-real-repository-eval-corpus.md` §No-Finding Zones And Clean Cases.

---

## Security-advisory corpus

**What it is.** `eval/corpora/security-advisory-2026/manifest.json` — 72 cases, 74
expected findings, 34 upstream projects, every one of the seven supported languages
and all ten security mechanisms. Same manifest schema, same hydration script and
same orientation as the real-repository corpus above: the tree is checked out at the
commit **before** an upstream security fix, and the fix is reviewed backwards so the
reviewed diff adds the vulnerable code.

**Where the ground truth comes from.** Each case is a security defect because a
**reviewed GitHub Security Advisory published after the training cutoff** says so —
never because a curator thought the code looked wrong, and never because a scanner
flagged it. Selection was on weakness class, language, fix size and severity alone;
whether any analyzer fires played no part, so recall measured here describes the
reviewer rather than a scanner.

**Its split is real, and it is the only one here that is.** Every fix is post-cutoff.
Dev is every fix committed before 2026-06-01 (15 cases), held-out every fix on or
after (36). That is the boundary `parseRealRepoCorpusManifest` actually verifies —
the cross-file corpus is `single-split` and its figures are dev-set figures by its
own admission. Once an A/B is decided on the dev half, only the held-out half backs
an acceptance claim.

**What it can measure.** Security recall **per mechanism** and **per context depth**,
which no other corpus here can: the cross-file corpus's security expectations are
incidental to what it was built for, and its XSS, SSRF and cryptography rows were
empty or near-empty denominators.

**What it cannot measure.**

- **A per-mechanism rate.** The denominators are one to four expected findings each.
  Publish the counts or publish nothing; a percentage over three expectations is a
  direction. Repeating a run triples the denominator without adding information.
- **Precision as a number.** The answer key is incomplete by construction — an
  advisory names one defect and the file may hold others — so precision is a bracket
  whose upper bound this corpus cannot narrow. In the first baseline every unmatched
  finding was judged a real defect, and there were zero genuine false positives.
- **Anything differenceable against another corpus's recall.**

**Curation cost, recorded because it is not obvious.** Reviewing a fix backwards
turns every explanatory comment the fix **added** into a removed line the reviewer
reads, and fix authors comment security repairs precisely. The hydration disclosure
gate flagged 15 of 38 curated candidates in the first round — a **34% loss**. A second
round briefed with that lesson pre-screened and lost 8 of 29. Budget roughly two
candidates adjudicated for every case that survives: 111 were adjudicated to reach 50. A clean `reviewIntent` is
not sufficient: the manifest's answer-key check reads curator prose and cannot read
the diff. Both gates are required.

**A third channel, checked once and clean.** Neither gate reads the rest of the
working tree, which the reviewer can reach through its read/list/grep tools. All 50
checkouts were scanned for their own GHSA and CVE identifiers: zero hits. That is a
property of the orientation — the tree predates the fix, so the advisory did not
exist yet — but worth re-checking for any project that publishes advisories ahead of
fixes.

**Baseline.** See [Current results](current-results.md#security-headline).

---

## Change-impact dependents corpus

**What it is.** `eval/corpora/change-impact-dependents/manifest.json` — 10 real
upstream changes, checked out **in full** at the commit that introduced a
breakage. Defined by `specs/22`. It exists to measure `impact check`, which the
corpora above structurally cannot: they all score defects the reviewer was pointed
at, and this one scores whether a dependent **outside** the change was named.

**There is still no number.** A scorer now exists — `eval impact`, see
[Running an evaluation](running-an-evaluation.md#eval-impact) — but nothing in this
repository quotes a result from it. Until a run is published, treat any figure you
see for this corpus as unmeasured.

### Shape — the inverse of the real-repository corpus

- Orientation is **forward**: `base = introducingCommit^`,
  `head = introducingCommit`. A real change reviewed as it was made, not a fix read
  backwards.
- Reviewed paths **P** are the files the change touches. Expectations live in **Q**
  where `Q ⊄ P` — outside the diff, by construction.
- Every change is **locally plausible**: if the diff alone revealed the problem the
  case would belong in the real-repository corpus instead.
- Manifest committed, checkouts not. `npm run eval:impact-corpus:hydrate` performs
  git fetches only — no model call, no spend.

### The evidence bar

A case is admissible only when upstream history **proves** the dependent broke: a
later commit that repairs it and quotes the introducing commit's full object name,
a revert, or an issue naming the caller-side symptom. **A curator's inference that
something might break is not admissible**, and the manifest schema enforces this
by refusing an evidence entry that repairs no expected dependent. No expectation
is sourced from this project's own engine output, which would convert recall into
similarity-to-our-own-engine.

### Composition

- **12 cases, 13 expected dependents** (a 2026-08-08 harvest added 9 cases, but 7 failed the hydrator's contamination gate and were dropped; only 2 survived).
- Original composition: from django (9, BSD-3-Clause) and grpc-go
  (1, Apache-2.0). Languages: Python 9, Go 1.
- Reachability: 3 `caller-of-changed-symbol`, 2 `callee-of-changed-code`,
  1 `attribute-owner`, **5 `whole-repo-search`**. The first three are the directly
  reachable population; the last shares no import edge, call or identifier with its
  change and is retained so that recall on it is reported rather than dropped.
- Contamination: **2 held-out, 8 dev**. Held-out needs the change itself to
  postdate the cutoff (`2026-01-01`) and the repair lands 3–12 months later still,
  so the window is narrow by construction. **Report split, never pooled.**
- Compatibility class: all 11 are `breaks-at-runtime`. Severity is carried as
  descriptive metadata only — impact findings pass their own admission gate, which
  applies no severity threshold, so nothing here is gated on it.

### What it can and cannot measure

**Can:** whether a predicted destination file is a dependent upstream actually had
to repair, split by reachability class and by contamination risk; whether the
deterministic reference list already contains that file, which is the baseline arm
`specs/22`'s remove-criterion is scored against; and what adjudication removed
relative to that list.

The scoring unit is the **destination file**, not the site — `specs/22` records the
measured reason (identical predictions scored at file rather than method
granularity moved precision 28.2% → 60.9%). Three arms are always reported
together, because the comparison between them is the only thing that answers the
remove-criterion.

**Cannot:**

- **Precision, trustworthily.** 11 dependents across 10 changes is not an
  enumeration of everything each change broke, so an unlisted prediction is not
  thereby wrong. `eval impact` reports precision as a **bracket** whose lower bound
  is raw precision and whose upper bound is permanently `not measurable on this
  corpus` — no judge can fix an answer key that is not an enumeration, so unlike
  the diff reviewer's bracket there is nothing to measure the upper end with.
- **Whether a removal was right.** The scorer counts removals that dropped a proven
  dependent, because those are provably wrong. It does **not** count "correct
  removals": a dropped file absent from the answer key might have been noise or a
  dependent nobody listed, and this corpus cannot tell.
- **`breaks-on-build`.** Every case is a behavioural break. A change that deletes a
  declaration outright is rarely merged without its callers, and the commit-message
  convention that makes the evidence link resolvable does not surface the ones that
  are.
- **Anything on its own.** A single run decides nothing here, and 11 dependents
  make that stricter rather than looser.

**Why it is small.** 101,542 commit bodies screened across 27 repositories, 166
candidates through the mechanical filters, 10 accepted. The binding constraint is
commit-message convention, not defect rarity: the link is mechanically resolvable
only where a project writes the causing commit's full object name, and django's
mandated `Regression in <sha>.` line produced 9 of the 10. The rejection reasons
are recorded in the manifest under `screening.rejections`.

---

## Fix-lane fixture

**What it is.** `eval/fixtures/typescript/fix-lane/repo/` — two files:

- `src/discount.ts`, carrying a genuine defect;
- `src/validate.ts`, carrying **false-positive bait** (an intentional `== null`
  idiom that looks wrong and is not).

**How it is used.** It is **not** referenced by `sample-eval-cases.json` and is
not loaded by `eval run`. It is exercised by the hermetic test
`fix-lane-fixture.test.ts`, which drives the spec-12 investigation-and-fix lane
with a content-aware scripted provider that reads the file through the mediated
`repo_read` tool. The genuine defect must be judged `real` with an apply-checked
fix; the bait must be judged `false-positive` with no fix. No real provider is
contacted.

**What it measures.** That the fix-lane outcomes actually feed the fix-lane
metrics end to end (`fixJudgmentAccuracy`, `fixFalsePositiveDetectionRate`,
`fixProduceRate`, `fixApplyFailureRate`).

**What it cannot measure.** Real fix-lane quality: the provider is scripted, so
this is a wiring test with one positive and one negative, not an evaluation.

---

## Choosing a corpus

| Question | Corpus |
| --- | --- |
| Does a change add noise? | Default fixture pack, then `crb-noise-*` |
| Did recall regress, at scale? | Code Review Bench-style (hydrated) |
| Is recall *trustworthy*, with an exhaustive key? | Proof-quality slices |
| Is line placement correct? | Proof-quality slices (**only** corpus with `path-line` keys) |
| Does cross-file reasoning work? | Real-repository cross-file |
| Does `impact check` name a dependent a change broke? | Change-impact dependents |
| Are security mechanisms covered? | **Security advisory 2026** — the only corpus with a denominator in every mechanism |
| Does the reviewer find a defect that needs another file? | Security advisory 2026 (per context depth), then Real-repository cross-file |

---

## See also

- [Running an evaluation](running-an-evaluation.md) — hydration and invocation.
- [Metrics](metrics.md) — what each corpus's shape does to each metric.
- [Comparing runs](comparing-runs.md#eval-slice-manifest) — proving two local packs are identical.
- Specs: `specs/06-evaluation-and-quality-gates.md` §Eval Dataset Contract,
  `specs/17-real-repository-eval-corpus.md`,
  `specs/22-change-impact-review.md` §Evaluation,
  `specs/15-security-focused-review.md` §The Security Corpus.
