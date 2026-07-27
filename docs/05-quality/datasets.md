# Datasets

Four corpora exist, and they measure genuinely different things. Quoting a number
without naming its corpus is meaningless — recall on a curated-subset answer key
and recall on an exhaustive one are not the same quantity.

| Corpus | Location | Cases | Expected findings | Hydration | Primarily measures |
| --- | --- | --- | --- | --- | --- |
| Default fixture pack | `eval/fixtures/sample-eval-cases.json` | 7 | **0** | none | False-positive suppression only |
| Code Review Bench-style | `eval/benchmarks/code-review-bench-style/` | 59 | 133 | **required** | Recall/precision on real PRs, changed files only |
| Proof-quality slices | `eval/fixtures/proof-quality-slices/` | 15 | 14 | none | Trustworthy recall on an exhaustive key |
| Real-repository cross-file | `eval/corpora/real-repo-cross-file/manifest.json` | 36 | 80 | **required** | Cross-file recall on full checkouts, and review of multi-file diffs |
| Fix-lane fixture | `eval/fixtures/typescript/fix-lane/repo/` | 1 (test-only) | — | none | Fix-lane judgment, via a hermetic test |

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

**What it is.** `eval/corpora/real-repo-cross-file/manifest.json` — 36 cases
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

**18 of the 80 expected findings are labeled `contextDepth: cross-file`**, plus
three `cross-function`, one `callee` and one `caller`; only 2 are `local`. (The
labels are carried by security-category findings only, which is why the other 55
findings have none.)

### Why multi-file cases exist

The second load-bearing point, added after the first baseline. 29 of the cases
change exactly one file, and on such a case task clustering, context packing,
per-task budget on a wide diff and any dilution of attention across files are not
merely weak — they are **never exercised**. Real pull requests are not
single-file, so seven cases now carry reviewed diffs spanning 2 to 6 files. Two
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

- 36 cases, 80 expected findings, **all `split: held-out`**.
- 29 upstream projects, including fastify, gin, tokio, django, netty, rack,
  werkzeug, starlette, undici, typeorm, aspnetcore, libuv, apisix, plug, traefik,
  laravel, vite, pydantic, grpc-go.
- 13 languages: Go 8, Python 6, JavaScript 4, TypeScript 4, Ruby 3, PHP 2,
  Rust 2, Java 2, and one each of Kotlin, C, C#, Lua, Elixir.
- Licenses: MIT 21, Apache-2.0 9, BSD-3-Clause 6 (permissive allowlist enforced).
- Tiers: 44 `logic`, 25 `security`, 11 `runtime-critical`. No nits.
- Severities: 27 `high`, 40 `medium`, 13 `low`. No `critical`.
- Findings per case: 11 cases with one, 12 with two, 9 with three, 3 with four,
  1 with six. Expectations per case is a curated property, not a by-product of
  capture — see `specs/17` §Expectations Per Case for why, and for the rule that
  no expectation may be promoted from engine output.
- Reviewed diff shape: **29 single-file and 7 multi-file cases** (2, 2, 2, 3, 5,
  6, 6 files), 55 reviewed files in total.
- Expected-finding shape: all 80 are **`path-semantic`** (path required, no line
  gate) — though each still carries a `lineRange` field.
- **10 no-finding zones**, one each on 10 cases, all line-ranged and all inside a
  reviewed path (see below).

### No-finding zones on this corpus

Every case here contains a known defect, so without declared clean regions
`noFindingZoneFalsePositiveCount` was pinned at zero and answered nothing about
false alarms. Ten cases now declare one line-ranged zone each, over code that was
read at the parent commit and is structurally unrelated to the case's defect:
delegating interface accessors (`golang-jwt`), pure serializers (`werkzeug`),
date-formatting lookup tables (`plug`), a future constructor (`tokio-util`), a
`FromIterator` impl (`axum`), a declarative config schema (`apisix`), a builder's
constructor/`build`/getter surface (`nestjs`), the one-line HTTP verb predicates
(`rack`), three mutex-guarded readers (`puma`), and a nil-skipping name lister
(`gin`).

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
| **Chronological split** | Cases are `dev` or `held-out`. Improvements are decided on `held-out`. |
| **Answer-key exclusion** | No field reaching the reviewed input may carry a CVE id, advisory text, or the fix commit message. |
| **Answer-key exclusion in the generated diff** | Hydration scans the **generated diff** for answer-key wording and fails the case. An upstream fix that also added an advisory reference puts the answer inside the model's input when read backwards. Curation found this in five candidate cases — one had already entered the corpus. |
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

- **Line accuracy.** All expectations are `path-semantic`, so `lineOverlaps` is
  never credited — yet they *do* carry `lineRange`, so the denominator is not
  empty. `lineAccuracy` reports `0.0%` over a non-zero check count and means
  nothing here.
  → [the full explanation](metrics.md#location-and-priority-accuracy)
- **Nit-tier behaviour.** No nit expectations exist; `nitRecall` reports its
  empty value of `1`.

**Known limitations.**

- **The answer key is still curated.** 80 findings across 29 real repositories
  cannot be exhaustive; recall is a lower bound and `adjustedPrecision` is the
  precision to read. In the multi-file cases the incompleteness is deliberate in
  places: `laravel-eloquent-dictionary-key-not-normalized` lists three of the six
  files it touches, because the other three repeat the listed root cause.
- **The published baseline predates both key expansions.** The 2026-07-26 run
  scored 30 cases and 42 findings; the key then grew to 58 findings with the
  multi-file cases and to 80 by curating expectations per case. Any comparison
  against a run on today's 36/80 corpus is a comparison of different
  denominators, and the comparison tooling refuses it outright: it compares the
  per-case answer-key digest and will not report a delta across a changed key.
- **Checkouts are untrusted input.** Repository content is reviewed, never
  executed; the eligibility gate and redaction apply to it as to any repository.
- **Cost.** Reviewing full repositories is the expensive corpus. The 30-case run
  cost on the order of one to two dollars of provider spend; the corpus is now 36
  cases, and the seven multi-file ones are the widest diffs in it, so budget more
  rather than less. The 2026-07 growth from 58 to 80 expected findings added no
  cost at all — provider spend follows cases, not expectations, which is exactly
  why expectations per case is the lever the corpus grows on.
- **Held-out only** — there is currently no `dev` split to iterate on, so
  repeated tuning against this corpus erodes its held-out status.
- **No fully clean case.** Every case carries a defect. The manifest schema
  requires `expectedFindings` to be non-empty, and the case model is a fix
  commit reviewed backwards from its parent, which has no meaning for a pull
  request that fixes nothing. A defect-free upstream change therefore cannot be
  expressed here today; the ten zones are a partial substitute measured on
  regions, not on whole changes. What it would take is recorded in
  `specs/17-real-repository-eval-corpus.md` §No-Finding Zones And Clean Cases.

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
| Are security mechanisms covered? | Real-repository cross-file, then Code Review Bench-style |

---

## See also

- [Running an evaluation](running-an-evaluation.md) — hydration and invocation.
- [Metrics](metrics.md) — what each corpus's shape does to each metric.
- [Comparing runs](comparing-runs.md#eval-slice-manifest) — proving two local packs are identical.
- Specs: `specs/06-evaluation-and-quality-gates.md` §Eval Dataset Contract,
  `specs/17-real-repository-eval-corpus.md`.
