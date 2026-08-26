# Which 36% does the reviewer miss? — a 10-seed miss analysis

**2026-08-11. No provider call, no eval run, zero spend.** Every number below is
recomputed from JSON already on disk. Read-only.

## 0. What was measured, and what was refused

**Source group (the only one used for rates).** Ten files,
`.codereviewer/eval/ab-subfile/control-{1..10}-report.json`. They are homogeneous
on every axis the repo requires:

| field | value | where |
|---|---|---|
| `metricsVersion` | `2026-08-07.open-redirect-mechanism` | report root |
| `schemaVersion` | `1.0` | report root |
| `provenance.answerKeyDigest` | `2931490f…` (identical in all 10) | report root |
| `provenance.configHash` | `f0a19692…` (identical in all 10) | report root |
| `provenance.providerId` / `modelName` | `openai` / `gpt-5.3-codex` | report root |
| engine | `359161b0f1764eb25e1c04ea1e1e0daf4cdea63e`, `engineDirtyFileCount: 0` | `ab-subfile/control-N/engine.json` |
| `fixtureCount` | 70 | report root |

70 cases, 72 expectations (`caseResults[].expectedFindings`), 720
expectation-observations. Per-seed `metrics.recall`: 66.67, 62.50, 63.89, 62.50,
61.11, 61.11, 65.28, 66.67, 63.89, 66.67 → **mean 64.03%, sd 2.22pp**, i.e. 461 of
720 matched. That reproduces the figure in the ledger's 2026-08-07 security
baseline.

**`inconclusiveExpectedIndexes` is empty in all 700 case-results.** No expectation
left the recall denominator in any seed, so `unmatched = declared − matched`
exactly, and the k-counts below need no denominator correction.

**Bucket-overlap discipline.** Per the ledger warning of 2026-08-08
(`unlistedRealFindingIds ⊂ falsePositiveFindingIds`, four published figures wrong),
every finding population here is built as a **set of `findingId`s** and deduped
before counting. The actionable pool is
`matchedFindings[].findingId ∪ duplicateFindingIds ∪ falsePositiveFindingIds`;
`unlistedRealFindingIds` and `genuineFalsePositiveFindingIds` are never added as
if disjoint. The artifact-only pool (`artifactOnly*`) is kept strictly separate —
it is excluded from `recall` by construction (spec 06, §`recall`).

**Other homogeneous groups: none that add seeds.** All 497 report JSONs under
`.codereviewer/eval/` were grouped by
(`metricsVersion`, `answerKeyDigest`, `configHash`, `modelName`, `fixtureCount`,
engine sha). Findings:

- The 10 copies under `.codereviewer/eval/runs/2026 0807T2*/eval-report.json` are
  **byte-identical duplicates** of the ab-subfile controls (same `generatedAt`,
  identical `caseResults` hash) — they are the same runs re-archived, not extra
  seeds.
- The ab-subfile **treatment** arm (10 runs) has `configHash d4ba79f4` and engine
  `45a75da` — different config *and* different engine. Not poolable.
- Every other group sits on a different answer key (51-, 71-, 72-, 50-, 37-,
  25-case), a different metrics version, or a different model. Not poolable.

So **10 seeds is all there is** for this corpus/config/engine, and that is what
sections 1–3 use. Section 1.4 uses 90 further archived runs for a *robustness
check only* — never pooled into a rate.

---

## 1. The never-found set

### 1.1 The distribution

For each of the 72 expectations, k = number of seeds in which it appears in
`matchedFindings` (equivalently, is absent from `unmatchedExpectedIndexes`):

| k (seeds matched) | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| expectations | **11** | 7 | 0 | 2 | 2 | 5 | 3 | 5 | 3 | 2 | **32** |

- **Never found (k = 0): 11 expectations, 15.3% of the corpus.**
- Variance band (1 ≤ k ≤ 9): 29 expectations, 40.3%.
- Always found (k = 10): 32 expectations, 44.4%.

The distribution is strongly U-shaped. Under a *homogeneous* model — every
expectation carrying the same per-seed probability 0.6403 — the expected number of
k = 0 expectations is **0.003** and of k = 10 is **0.83**. Observed: 11 and 32.
Var(k) = 16.02 against the binomial 2.30, a dispersion factor of **6.95**.

**Shows:** per-expectation difficulty is real and large. The 10-seed design earns
its keep: an expectation missed once is nothing like an expectation missed ten
times.

### 1.2 Two of the eleven were found and demoted

`artifactOnlyMatchedFindings[].expectedIndex` records expectations matched by a
finding the pipeline produced but classified `reporterEligibility = "artifact-only"`
(spec 04: `modelWeakOrRefuted` defaults to `artifact-only`; spec 05: inline
anchoring can also demote). Those findings are excluded from `recall` by design.

Two of the 11 never-found expectations were matched by an artifact-only finding in
**10 of 10 seeds**:

- `feature-image-caption-marked-html-safe-unsanitised` (javascript, xss, implementation)
- `trix-stringpiece-unsanitized-href-from-json` (javascript, xss, cross-file)

**The reviewer found both defects, every time, and the pipeline took them off the
actionable list.** They are not blind spots; they are demotions.

Counting a match in *either* lane: 535/720 = **74.31%**, i.e. **10.28pp of the
36% gap is output the engine produced and then withheld** — the same magnitude the
ledger entry "Silence is refutation, not discovery" already records (10.3pp). This
analysis independently reproduces it and localises it per expectation.

**True never-found in any lane: 9 expectations, 12.5% of the corpus.**

### 1.3 The nine, with their attributes and what happened instead

Miss modes are mutually exclusive per observation, derived from
`discovery.totals.rawFindingCount`, the actionable ID set, `artifactOnlyFindingIds`
and the finding `path`/`line` against `expectedFindings[].lineRange` (±3 lines,
the tolerance `lineAccuracy` uses).

| expectation (caseId) | lang | mechanism | contextDepth | sev | what happened, over 10 seeds |
|---|---|---|---|---|---|
| `admin-api-filter-exposes-password-hash` | js | secret-flow | cross-file | med | 8× only artifact-only output (matching nothing), 1× elsewhere, 1× same file out of range |
| `apollo-raw-configfile-appid-parsed-as-raw` | java | authorization | cross-file | high | 7× only artifact-only output, 3× actionable finding **inside the expected range** |
| `convolution-filter-regex-exponential-backtracking` | python | concurrency-resource | implementation | high | 4× discovery silent, 3× artifact-only only, 3× nothing survived |
| `cors-preflight-header-split-redos` | ts | concurrency-resource | local | med | **10× an actionable finding inside the expected range** — right lines, wrong defect |
| `dns-block-response-null-address-reaches-localhost` | go | unsafe-config | implementation | high | **10× findings only in other files** |
| `hmac-empty-key-accepted-for-signature-verification` | ruby | cryptography | cross-function | high | 8× actionable finding inside the expected range, 2× nothing survived |
| `russh-client-curve25519-shared-secret-unchecked-peer-length` (idx 1) | rust | cryptography | implementation | med | **10× findings only in other files** (idx 0 of the same case matched 10/10) |
| `schema-import-extension-injected-into-generated-imports` | python | injection | analyzer-path-dependent | high | 6× inside range, 1× same file out of range, 2× nothing survived, 1× artifact-only only |
| `tokenizer-tag-names-trimmed-of-trailing-control-chars` | java | xss | analyzer-path-dependent | med | **10× discovery returned nothing at all** |

**Shows:** the nine do not fail the same way. Only one (`tokenizer-tag-names`) is
silence in every seed. Three put an actionable finding **on the defect's own lines**
in most or all seeds, describing something else — the pattern the ledger records
as "security framing, not attention". Two produce output only in other files.

### 1.4 Which attributes separate never-found from always-found

Every attribute available was tested. Fisher exact, two-tailed, on
(k = 0) vs (rest); recall is the group's own hit rate over 10 seeds. Sources:
`eval/corpora/security-advisory-2026/manifest.json` for `language`, `split`,
`expectedFindings[].tier/securityMechanism/contextDepth/severity/matchMode`;
`caseResults[].expectedFindings[].diffScope` from the report; changed-line and
changed-file counts from `.codereviewer/eval/security-cases/security-advisory-2026/<case>/slice.json`
(`diff`, `changedFiles`); file size from the hydrated checkout at
`<case>/repo/<path>`.

**Attributes that cannot separate anything — they are constant across the corpus:**

| attribute | value | consequence |
|---|---|---|
| `tier` | `security` for all 72 | no tier contrast exists |
| `diffScope` | `in-diff` for all 72 | **the out-of-diff question is unaskable here** |
| expectation path ∈ `changedFiles` | true for all 72 | ditto |
| `matchMode` | 71 `path-semantic`, 1 `path-line` | no contrast |

**Attributes measured and NOT separating** (all p > 0.05 raw; ~40 tests were run,
so nothing here survives any multiplicity correction):

| attribute | best level | never / n | p (raw) |
|---|---|--:|--:|
| `securityMechanism` | xss | 3/7 | 0.067 |
| `contextDepth` | `analyzer-path-dependent` | 2/2 | 0.022 |
| `language` | java | 2/6 | 0.226 |
| `severity` | medium | 6/29 | 0.332 |
| `split` (dev / held-out) | — | 3/19 vs 8/53 | 1.000 |
| expectations declared in the case | 1 | 10/68 | 0.493 |
| changed files in the case | 1 | 9/66 | 0.226 |

Continuous attributes, Spearman ρ of k against the attribute, permutation p
(10 000 shuffles):

| attribute | ρ | p |
|---|--:|--:|
| defect file size (lines) | **+0.203** | 0.091 |
| removed lines in the diff | +0.128 | 0.273 |
| hunks | +0.096 | 0.422 |
| expectations in the case | +0.090 | 0.500 |
| changed files | +0.041 | 0.733 |
| answer-key summary length | +0.040 | 0.734 |
| expected line span | −0.019 | 0.878 |
| added lines in the diff | −0.066 | 0.579 |

Medians by population — file size 157 (never) / 455 (band) / 528 (always) lines;
added lines 1 / 2 / 2; removed lines 9 / 6 / 11; hunks 2 / 2 / 2.

**Shows:**
1. **Size does not hurt.** Every size-of-work attribute (file lines, added lines,
   removed lines, hunks, changed files, line span) is flat or points the *wrong
   way* — the sign on file size is positive, i.e. defects in bigger files were
   found slightly *more* often. The never-found set's file sizes are
   39–5489 lines; the largest file in the corpus (5508 lines) is always found.
   Any theory that misses are a context-budget or attention-dilution effect is
   unsupported by this corpus.
2. **The only sub-0.05 cell, `contextDepth = analyzer-path-dependent` (2/2 never
   found, p = 0.022), rests on two expectations** and does not survive Bonferroni
   over the 7 levels of that attribute alone (0.15). It is a hypothesis, not a
   result. Note it is consistent with the ledger's measured analyzer firing base
   rate of 3.0%.
3. `xss` at 40.0% actionable recall is the weakest mechanism — but two of its
   three never-found expectations are the **demotions** of §1.2. On the
   either-lane definition xss rises 40.0% → 68.6%, i.e. **most of the apparent
   xss blind spot is a demotion effect, not a detection failure.** Mechanism
   recall, actionable → either-lane: path-traversal 94.4→96.7, concurrency-resource
   69.3→82.0, cryptography 66.7→66.7, authorization 63.3→68.9, secret-flow
   56.7→68.3, injection 55.0→70.8, ssrf 54.0→58.0, xss 40.0→68.6.

---

## 2. The variance band, and whether it differs from the never-found set

The band is **29 expectations, 40.3% of the corpus** — larger than the never-found
set. 259 of the 720 observations are misses; 127 of them (49%) belong to band
expectations, 90 (35%) to never-found ones, and 42 (16%) to expectations that were
matched by the artifact-only lane in every seed.

### 2.1 No attribute distinguishes the two populations

Fisher exact, never (n = 11) vs band (n = 29), every level with ≥ 3 members
across the two groups — 20 tests, **smallest p = 0.117** (xss), next 0.162
(callee), 0.178 (java), 0.233 (injection). Mechanism, contextDepth, language,
severity and split are all indistinguishable between the two.

### 2.2 A smooth difficulty distribution already predicts the never-found pile

A two-parameter beta-binomial fitted by maximum likelihood to the 72 k-values —
i.e. a model in which each expectation has its own detection probability drawn
from one continuous distribution, with **no separate "blind spot" class** —
gives α = 0.308, β = 0.176 (mean 0.636, U-shaped):

| k | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| observed | 11 | 7 | 0 | 2 | 2 | 5 | 3 | 5 | 3 | 2 | 32 |
| beta-binomial | 12.4 | 4.2 | 3.0 | 2.6 | 2.4 | 2.4 | 2.5 | 2.9 | 3.6 | 5.7 | 30.2 |

χ² = 12.34 on ~8 df, **p = 0.137** — the fit is not rejected. It predicts 12.4
never-found against 11 observed, and 30.2 always-found against 32.

**Infers (labelled inference):** the never-found set is the low tail of one
continuous difficulty distribution, not a qualitatively distinct class of defect.
An intervention aimed at "the blind spot" as a category has no category to aim at;
what the data supports targeting is the *shape* of the difficulty distribution —
i.e. whatever makes a given expectation's per-seed probability low — and §3 plus
§1.2 say that mechanism is selection and demotion, not discovery.

### 2.3 But the difficulty ordering is real and replicates out of sample

**Robustness check, not a pooled rate.** 90 further engine-pinned archived runs
carry `metricsVersion 2026-08-07.open-redirect-mechanism` and
`modelName gpt-5.3-codex` across **12 engine commits and 7 configs**
(ab-impact, defectfix-ab, defectfix-confirm, boundary-ab, intent-ab, cit-ab,
sf-ab, model-probe, ab-subfile treatment). Their `answerKeyDigestByCase` entries
are **byte-identical** to the ab-subfile controls for every shared case (70/70 with
ab-impact, 51/51 with defectfix), so the same expectation is being scored against
the same key. Rates are *not* pooled across engines — the question asked is only
"does the same expectation stay hard under a different engine commit?":

| population (classified on the 10 controls) | hit rate in the 90 external runs |
|---|--:|
| never-found (k = 0) | **28 / 946 = 3.0%** |
| band (1 ≤ k ≤ 9) | 1141 / 2258 = 50.5% |
| always-found (k = 10) | 2333 / 2396 = **97.4%** |

Five expectations are 0 matched in all 100 runs and in the artifact-only lane too:
`convolution-filter-regex-exponential-backtracking`, `cors-preflight-header-split-redos`,
`dns-block-response-null-address-reaches-localhost`,
`hmac-empty-key-accepted-for-signature-verification`,
`tokenizer-tag-names-trimmed-of-trailing-control-chars`
(`admin-api-filter-exposes-password-hash` adds 3 artifact-only matches and 0
actionable ones).

**Shows:** the k = 0 / band / k = 10 split is a stable property of the expectation,
reproducible under 12 engine commits, not an artefact of these ten seeds — even
though §2.1–2.2 find no *attribute* that explains it.

---

## 3. One finding per case — the counts

Per case-run, actionable admitted findings = the deduped ID set
`matchedFindings ∪ duplicateFindingIds ∪ falsePositiveFindingIds`
(700 case-runs = 70 cases × 10 seeds):

| findings per case-run | 0 | 1 | 2 | 3 | 5 |
|---|--:|--:|--:|--:|--:|
| case-runs | 178 | 419 | 92 | 9 | 2 |

Mean **0.914** actionable findings per case-run. Upstream of admission,
`discovery.totals.rawFindingCount` per case-run: 0 → 40, 1 → 462, 2 → 177,
3 → 16, 4 → 3, 5 → 2 (mean 1.266); `candidateCount` mean 1.223;
`callCount` is 1 in 690 of 700 case-runs and 2 in 10.

**The engine emits more than one finding routinely.** 198/700 case-runs (28.3%)
produce ≥ 2 raw discovery findings, and 103/700 (14.7%) survive to ≥ 2 actionable
findings — on cases that declare a *single* expectation.

**The corpus, not the engine, is the ceiling.** 68 of the 70 selected cases declare
exactly one expectation; only 2 declare two (4 of the 72 expectations). Of those two:

- `lettre-boring-tls-hostname-verification-inverted` — 2 findings, **both
  expectations matched, in 10 of 10 seeds.**
- `russh-client-curve25519-shared-secret-unchecked-peer-length` — 1 finding,
  idx 0 matched in 10/10, idx 1 matched in 0/10.

**Answer: the "one finding per case" ceiling is confirmed as a corpus artefact, not
an engine limit.** The engine produced two matching findings for the one case that
had two co-located expectations and where it could; on 94.4% of expectations the
corpus never gave it the chance to demonstrate more. This does not show the engine
has *no* multi-defect weakness — it shows that this corpus cannot detect one, and
that the strongest form of the claim ("the engine emits one finding per case") is
false.

### 3.1 Where the 259 misses actually go

Mutually exclusive, checked in this order per missed observation:

| bucket | n | share |
|---|--:|--:|
| **A. found, but demoted to artifact-only** | 74 | **28.6%** |
| B. discovery returned nothing (`rawFindingCount = 0`) | 40 | 15.4% |
| C. actionable finding in the same file, **inside** the expected range ±3 | 39 | 15.1% |
| C′. actionable finding in the same file, outside the range | 15 | 5.8% |
| D. actionable findings only in other files | 21 | 8.1% |
| E. only artifact-only output, matching nothing | 27 | 10.4% |
| F. spoke, nothing survived to any output | 43 | 16.6% |

Buckets B (15.4%) and F (16.6%) reproduce the 2026-08-08 "what it says instead"
figures exactly, which is a useful cross-check that the two derivations agree; the
remaining partition differs because that analysis judged the nearest finding
semantically while this one splits out the artifact-only matches (A) that were
previously folded elsewhere.

Refutation verdicts over the 700 case-runs (`caseResults[].refutationResults`):
**proved 647, needs-more-evidence 138, refuted 46** (831 total). 135 findings were
classified artifact-only. **A + E + F = 55.6% of all misses are pipeline
disposition, not discovery.**

---

## 4. What this corpus structurally cannot answer

1. **Anything about out-of-diff recall.** All 72 expectations are
   `diffScope: in-diff` and all sit in a changed file. `recallByDiffScope`
   out-of-diff has denominator 0 in every one of the ten runs. The ledger's
   0/27 out-of-diff wall cannot be re-examined, confirmed or refuted here.
2. **Anything about tier.** All 72 expectations are tier `security`, so `recall`,
   `productRecall` and `recallByTier.security` are the same number and no tier
   comparison exists.
3. **Whether a never-found expectation is truly p = 0.** Ten Bernoulli trials
   bound a 0/10 observation only at **p ≤ 25.9%** (95%), and P(0/10 | p = 0.10) =
   0.349. Even with the 90 external runs (0/90 → p ≤ 3.3%) "never" means "rare",
   not "impossible".
4. **Whether the engine has a multi-defect weakness.** Two cases with two
   expectations, one of which succeeded fully. No power. A corpus of cases
   declaring 3+ co-located expectations would be needed.
5. **Which demotion mechanism fires.** The report records
   `reporterEligibility = artifact-only` only through the `artifactOnly*` ID lists;
   it stores no reason. Refuter disposition (`modelWeakOrRefuted`, spec 04) and
   inline-anchoring ineligibility (spec 05) are indistinguishable from the archive.
   Resolving it needs a field, not a run.
6. **Attribute effects at n < 8.** `unsafe-config` (1), `open-redirect` (1),
   `deserialization` (1), `analyzer-path-dependent` (2), `caller` (3),
   `critical` severity (3), `path-line` matchMode (1) — every one of these is a
   headline waiting to be over-read. With 72 expectations and ~40 attribute tests,
   the corpus can only detect effects large enough to move ~10 expectations.
7. **Anything model-comparative.** One model (`gpt-5.3-codex`). Per the ledger, a
   rate is a property of a model.

---

## 5. What follows, with prices

No recommendation below has been executed; each states its cost and what it
resolves. Reference price from these archives: a 10-seed arm on this 70-case
corpus cost **$18.42 review + $3.17 judge = $21.59** (`metrics.costUsd` and
`metrics.scoringCostUsd` summed over the ten controls; seed 1 was cold-cache at
$4.38, seeds 2–10 warm at ~$1.55).

1. **Free, no run: record the demotion reason.** Add the reason for
   `reporterEligibility = artifact-only` to the eval case result. §1.2 and §3.1
   show 28.6% of all misses are demotions; nobody can currently tell whether the
   refuter or the inline-anchoring rule is responsible. Cost: a code change and a
   re-run of whatever measurement wants it — **not a new measurement to establish
   the fact**, which is already established.
2. **Free, no run: stop reading `recall` alone on this corpus.** The either-lane
   rate is 74.31% against 64.03% actionable. Both are true; publishing only the
   first understates what the reviewer *found* by 10.28pp and overstates the
   discovery problem.
3. **Only if the demotion question is settled first**, an A/B on the refuter's
   promotion bar would cost ~$43 (two 10-seed arms) and could resolve whether the
   74 demoted matches can be promoted without wrecking `adjustedPrecision`
   (currently 88.2–100% per seed, `metrics.adjustedPrecision`). **Do not run it
   before item 1** — without the reason field the result is uninterpretable, and
   per the ledger's arm-order entry, no precision delta from this harness is
   citable anyway.
4. **Do not spend on attention, prompt or context-size levers on the strength of
   this analysis.** Every size attribute is flat or inverted (§1.4), which agrees
   with the ledger's four closed attention mechanisms and five null prompt clauses.

---

## Appendix — reproducing every number

No script is left behind; the computation is short and stated here so it can be
re-derived exactly.

- **k per expectation.** For each of the ten `control-N-report.json`, for each
  `caseResults[]`, key each `expectedFindings[].expectedIndex` by
  `(caseId, expectedIndex)`; it is matched in that seed iff it appears in
  `matchedFindings[].expectedIndex`, missed iff in `unmatchedExpectedIndexes`.
  `inconclusiveExpectedIndexes` is empty everywhere. k = number of matched seeds.
- **Either-lane k.** Same, unioning `artifactOnlyMatchedFindings[].expectedIndex`.
- **Actionable findings per case-run.** Size of the deduped ID set
  `matchedFindings[].findingId ∪ duplicateFindingIds ∪ falsePositiveFindingIds`.
  Never add `unlistedRealFindingIds` — it is a subset of `falsePositiveFindingIds`.
- **Miss buckets.** Order: artifact-only match → `rawFindingCount == 0` → any
  actionable finding with `path` equal to the expectation's `path` (inside range
  iff `lineRange[0] − 3 ≤ line ≤ lineRange[1] + 3`) → actionable findings exist
  elsewhere → `artifactOnlyFindingIds` non-empty → nothing.
- **Attributes.** `eval/corpora/security-advisory-2026/manifest.json` →
  `cases[].language`, `cases[].split`,
  `cases[].expectedFindings[i].{tier,securityMechanism,contextDepth,severity,matchMode,lineRange,path}`;
  `.codereviewer/eval/security-cases/security-advisory-2026/<caseId>/slice.json` →
  `diff` (count lines starting `+`/`-`, excluding `+++`/`---`; hunks = lines
  starting `@@`), `changedFiles`; file size = line count of
  `<caseId>/repo/<expectation path>`.
- **Tests.** Fisher exact two-tailed by exact hypergeometric enumeration;
  Spearman ρ via Pearson on average ranks with a 10 000-shuffle permutation p;
  beta-binomial by grid-search MLE over (α, β) ∈ [0.05, 200] geometric, χ² against
  the 11 fitted cell counts on ~8 df.

**Known obstacle for anyone re-running this with the repo's own tooling:**
`codereviewer eval recall-report --report …` (which computes exactly the
always/never/flaky split, with no model call) **cannot read these archives at
HEAD**. `EvalCaseResultReportSchema` is a `strictObject` and the 2026-08-07
archives carry `duplicateFindings`, `falsePositiveFindings`, `unlistedRealFindings`
and `artifactOnlyFalsePositiveFindings`, which commit `7daa692` replaced with the
single `producedFindings` array — while `schemaVersion` stayed `'1.0'`. The command
fails with `config_error: Unrecognized keys`. That is why the numbers above were
computed directly from the JSON.
