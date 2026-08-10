# Status And Limitations

An honest account of what is finished, what is unproven, and what is switched
off. Read this before you adopt the tool or quote a number from it.

---

## It is not published yet

The package is now *publishable* — `private` is gone, the metadata is complete,
and a release workflow publishes on a version bump — but **nothing has been
published**. Version `0.1.0` is not on the registry, so:

- `npm install -g @sebastianwessel/codereviewer` does not work.
- `npx @sebastianwessel/codereviewer …` does not work.

The first release is deliberately blocked on a **licence**: the repository
declares none, and the release gate fails without both a `LICENSE` file and a
`license` field. A public package with no licence is all-rights-reserved, which
is not a default anyone should inherit by accident. See
[releasing.md](../09-contributing/releasing.md).

The only supported way to run it today is **from a source checkout** — see
[Install and run](../02-getting-started/install-and-run.md). The package does
declare a `codereviewer` bin pointing at `dist/cli/main.js`, which is what a
future published release would install; an npm package is recorded as a release
artifact "when publishing is enabled by a future release ticket".

Because no public release exists, contracts are still allowed to change: the
report and config schemas start at `1.0`, and pre-`1.0` breaking changes are
made by updating the specs first. Obsolete inputs fail fast rather than being
translated.

---

## Release scope (R1)

Implemented: local CLI review of a checked-out git repository, base/head diff and
explicit file-list intake, deterministic support signals, language-neutral
contracts, provider resolution for OpenAI/OpenAI-compatible/Bedrock/Azure through
optional packages, holistic discovery + refutation, JSON/Markdown/SARIF reports,
local review-comment drafts, an evaluation runner with quality gates, two
independently runnable advisory commands (`intent check`, `impact check`) that
are off by default and cannot fail a pipeline, and a reference GitHub Actions
integration (`.github/workflows/code-review.yml` plus `scripts/github/`) that
posts and edits a pull-request summary comment and inline review comments
through the GitHub API. That integration is not part of the published npm
package — the engine itself (`src/`) still makes no network call and holds no
forge credentials; publishing lives entirely in the separate script the
workflow invokes. See [GitHub integration](../04-guides/github-integration.md).

Explicitly **not** implemented:

- CI-native check annotations (the GitHub Action reports pass/fail through the
  job's exit code and posts findings as ordinary PR comments — it does not
  request `checks: write` or create Checks-API annotations);
- automatic fix application;
- full-codebase trend dashboards;
- a remote API server, browser UI, authentication system, database, or
  long-lived daemon;
- any product-owned replacement for CodeQL/linters/formatters/tests/builds.

---

## Capabilities that ship switched off

Several capabilities are implemented but disabled by default, and in the most
interesting cases that is **because measurement said so**, not because they are
unfinished. Enabling them is a deliberate, measured choice.

| Config key | Default | Why it is off |
| --- | --- | --- |
| `security.dedicatedPass.enabled` | `false` | A second, security-only discovery call per task. Additive by construction, but it costs an extra discovery call per task and has not cleared a held-out A/B showing net recall gain without an authorization regression. |
| `contextSources.enabled` | `false` | External change-intent ingestion (ticket/PR context). Off unless you configure providers. |
| `verification.enabled` | `false` | A separate agentic flow that verifies specific claims — see [two flows](../03-concepts/two-flows.md). |
| `fix.enabled` | `false` | Advisory finding-investigation and fix-proposal lane. |
| `reporting.reviewComments.enabled` | `false` | Writes inline review-comment draft artifacts. |
| `skills.enabled` | `false` | Mounted reviewer skill directory with bounded read/list/grep tools. |
| `observability.openTelemetry.enabled` | `false` | No-content telemetry export. |
| `security.signals.enabled` | `false` | Ingests already-produced analyzer artifacts (SARIF 2.1.0) as evidence — spec 15, Mechanism 2. Its recall contribution is still unmeasured, but its **reach** now is: a public analyzer flags the vulnerable line of a real advisory 3.0% of the time, which bounds the layer below the threshold it would have to clear (below). It also does nothing without `security.signals.artifacts`, and a run that enables it with no artifact configured is rejected rather than quietly reviewing nothing. |

**What the security-signal layer does and does not do.** It reads analyzer
artifacts you already produced; it never runs an analyzer, and no analyzer is a
dependency of this package. An ingested alert seeds no finding on its own — it
enters the discovery packet as an untrusted third-party claim, and anything
reported afterwards is an ordinary candidate that still passes refutation and the
admission gate.

**Its recall contribution is unmeasured, and its ceiling is now measured.**
On 2026-08-06, a public analyzer ruleset was run over all 37 cases of the
real-repository corpus and produced 924 alerts. Changed-side attribution — the
rule that a pull request is not blamed for pre-existing repository debt — held
**all 924** back as pre-existing, so **0** reached the reviewer. That is the
attribution rule working rather than a defect, but it left the layer's effect
without a number.

On 2026-08-07 the question was asked the other way round, on material chosen so
the channel could not be empty by construction: **132 publicly confirmed
vulnerabilities**, each with a fix commit that deletes or modifies the vulnerable
line, scanned at the vulnerable revision under twelve public rulesets. An alert
lands on a line the fix changed in **4 cases (3.0%)**, and in only **2** does the
alert describe the weakness the advisory is about.

That bounds the layer rather than measuring it. Ingestion can only change a review
where an alert is admitted, so at a 3.0% admission rate its recall lift cannot
exceed 3 percentage points even if every admitted alert converted a miss into a
find. Keep the layer off unless you already run an analyzer — and note the 3.0% is
a property of the analyzer used (Semgrep OSS with public rules), not of the layer:
a stronger scanner may sit well above it. **Do not read the layer as improving
security recall; nothing has shown that it does.** Spec 15 records the full
measurement, and `reports/2026-08-07-analyzer-firing-base-rate.md` the method.

The evaluation block has no `enabled` key: case selection is driven by `eval run`
CLI flags, and the SARIF reporter has no `sarif.redact` key, since it redacts
unconditionally regardless.

**Consequence of the defaults:** out of the box, discovery is a single general
pass per review task — no security pass, no extra sweep, no pre-selected extra
context — but that pass *does* hold the mediated read/list/grep tools, and a task
covering more than two changed files is split across several calls. That is the
configuration the current quality figures describe.

**One default was reversed on measurement, and the reversal is worth reading.**
`review.crossFileRetrieval.enabled` shipped `false` for months on a recorded
verdict of "measured net negative", from three runs in which recall fell. That
verdict was measuring a bug, not the feature: every retrieved file was cut at a
per-read cap with the model never told, so the reviewer concluded things were
absent from code it had only partly seen. With the cut removed, two further runs
put it ahead on recall, adjusted precision and cost alike. The gain is **not**
statistically significant and no specific improvement is claimed — but a default
that is free, harmless and directionally positive does not need a significance
test to be permitted, and if a regression ever appears this is the first switch to
flip.

A `review.contextScout` block once existed and was removed along with the
capability; a config that still sets it now fails validation with exit code `2`.
The record is in
[context scout (removed)](../03-concepts/optional-capabilities/context-scout.md).

An `invariantConformance` block and a third advisory command, `conformance
check`, existed until 2026-08-02. Both were removed after the capability's own
firing-rate measurement, on `openai/gpt-5.3-codex`, put it at **7.0 reports per
PR-sized range against a pre-registered kill criterion of ≈0.5**, with **zero
true positives across roughly 300 hand-judged divergences**. A config that still
sets the block fails validation with exit code `2`. The record is in
[invariant-conformance review (removed)](../03-concepts/optional-capabilities/invariant-conformance.md).

Defaults that are **on**: `aiReview.requireRefutation` (a literal `true` — not a
toggle), `aiReview.deterministicSignalMode: 'support'`,
`review.crossFileRetrieval.enabled`, `baseline.enabled`, `drift.enabled`, and the
strict quality gate (`maxCritical: 0`, `maxHigh: 0`).

There are also **no proactive byte caps anywhere** by default —
`review.contextMaxBytes` and `review.crossFileRetrieval.maxBytesPerRead` are both
unset — and **no whole-run time bound**. `provider.timeoutMs` (default `120000`)
bounds a single network call and is the only deadline that exists.

---

## Quality numbers: what can and cannot be claimed

Every model-backed number in this section was measured on `openai/gpt-5.3-codex`.
A rate is a property of the model that produced it, so none of it is evidence
about any other provider or model — quote the model with the figure or do not
quote the figure. The `impact check` figure below is the one exception: it was
measured on the command's deterministic core, which makes no provider call, so its
coverage is model-independent. That core is what runs by default; the command's
adjudication layer (`changeImpact.adjudication.enabled`, off by default) does call
a model and is **unmeasured** — no figure for it exists or may be quoted.

- **The current headline, and the only figure that should be quoted for the review
  stage:** **66.1% in-diff recall**, measured 2026-08-06 on
  `openai/gpt-5.3-codex` with the engine pinned at `c3c0c3d`, on a 37-case
  real-repository corpus over three runs (the control arm of a
  `refutationRetrieval` A/B, run at shipped defaults). No sd is restated for
  this pin; do not carry the earlier 2.89pp onto it. It supersedes the
  2026-08-05 baseline's 68.3% — the difference is small and the run cannot
  separate it from noise, since the two engine pins differ by a large,
  unisolated span of work — and, further back, the 2026-08-02 baseline's
  61.1%. Adjusted precision is **96.1%**, comparable to the 2026-08-05 pin's
  96.2% under the same metrics version; raw precision is **74.5%**. Cost per
  run at this pin is **$1.15**; the earlier **$1.97 cold-cache** / **$0.82–0.83
  warm-cache** figures predate a since-landed change that runs review as a
  single process and a dependency bump, and should not be quoted as current.
  → [Current results](../05-quality/current-results.md)
- **Out-of-diff recall is a scope boundary, not an unqualified deficiency, and
  it now has a measured split.** `review` answers "does this change introduce a
  defect", and its attention is scoped to the reviewed diff by design — a
  different job from a full repository audit ("does this codebase contain a
  defect, changed or not"), which is not built. Of 87 expected findings, the 60
  inside the diff were found at **66.1%** (2026-08-06) and the 27 sitting
  elsewhere in a changed file were found at **0 of 27** — unchanged from the
  2026-08-05 and 2026-08-02 baselines, and previously replicated as **0 of 81**
  against an independently labeled answer key. Not "low" — a measured zero,
  repeatedly. Every one of those 27 misses was in a file the reviewer had been
  shown **in full**, so it needed no retrieval, no larger context window and no
  bigger model: this is diff-scoped attention holding exactly as designed, not a
  context or retrieval gap that more budget would close. A latent, pre-existing
  defect in the untouched part of a changed file is therefore out of scope
  today — it is a real defect a reader may still want surfaced, and this
  document makes no commitment to build a mode that finds it. It is also the
  reason the iterative review-fix-re-review loop matters more than any
  single-pass tuning: each fix changes the diff, which can pull a nearby defect
  into scope on the next pass.
  → [What limits recall](../05-quality/what-limits-recall.md)
- **`impact check` now has one measurement.** Scored against the 27 out-of-diff
  expectations — the population it exists for — it localises **20 of 27 (74.1%)**
  inside a symbol it flagged as changed (measured 2026-08-02; not re-measured at
  the 2026-08-05 or 2026-08-06 pins). That is COVERAGE, not detection: it reports
  risk and never claims a defect, so the figure is not comparable to the review
  stage's recall.
- **Every `intent check` figure below predates 2026-08-06**, when the lane gained a
  fourth status, `not-contradicted`, for obligations asking that something *not* be
  done — 33 of the 83 classified false positives (39.8%) were of that shape, and
  under the previous three statuses no answer that could be right was available for
  them. The change moves those obligations off the headline outstanding count.
  **No accuracy measurement of any kind exists after it**, so none of the precision
  or recall numbers here describes the current engine, and a re-measurement is owed
  before any of them is compared across that date.
- **`intent check` is the most-measured stage here, and none of its numbers
  describe the engine that ships.** Four scored rounds over two corpora put
  end-to-end outstanding recall at **81.2%** and outstanding precision at
  **51.5%** on intent written *before* the change — but every one of those runs
  predates the 2026-08-01 removal of the citation-aptness stage and the
  `evidenced`/`not-evidenced` rename, and none carries an engine provenance
  sidecar, so the corpus's own scorer now refuses to score them. Re-read under the
  outstanding list the current engine builds, the same stored runs give **78.3%
  recall at 55.6% precision** — the removed stage was adding 18 entries of which
  15 were already done.
- **That 55.6% was measuring a question the lane is not asked, and the corrected
  figure is 95.4%.** The answer key graded every obligation on whether it HOLDS AT
  HEAD; spec 23 says plainly that the lane can only answer "do these lines evidence
  this obligation?". "Outstanding precision" was never one of spec 23's three named
  metrics — the scorer invented it, and its numerator asked the head question of an
  answer given to the diff question. One case carries 33 obligations, zero genuine
  leftovers, and 18 flagged, because it judges the second of two commits against
  clauses the first satisfied. A second hand label was added over 153 rows and both
  precisions are now reported side by side, never one instead of the other:
  **lane precision 95.4% (146/153)** on what it is asked, **list precision 55.6%**
  on what a reader assumes the list means. The relabel is not tuning to the engine:
  the same labels surfaced 8 genuine misses the old metric could not see, and
  convict the lane harder on a metric that did not previously exist —
  **40% (8/20) of hand-labelled `evidenced` rows cite something that is not
  evidence**, including specification prose the commit itself rewrites. Spec 23
  ranks a confident satisfaction claim as the expensive error, so that 40% is now
  the stage's real open defect, not the precision headline.
- **That lane's repeatability is now measured, and it is the limit on every figure
  above.** Three cases run twice against one pinned engine, identical inputs:
  **87.0% verdict agreement** on statements both runs produced, and only **83.6%**
  of statements reproduced at all. The same three cases across the rename scored
  **86.7%** — the lane disagrees with *itself* as much as it disagrees with its
  predecessor. No single-run intent figure, published here or elsewhere, has a
  variance band, and a difference smaller than that gap cannot be attributed to
  anything. Its dominant *precision* failure remains a question mismatch — the run
  correctly reporting "this diff does not evidence it" against an answer key
  asking "does it hold at head" — rather than judgement quality.
- **A single run is not a result.** A headline figure is a mean, never the best
  run. Run-to-run variance on the real-repository corpus was first measured at
  one pinned engine on 2026-08-02 at **sd 0.96pp** on in-diff recall and 0.66pp
  blended, over three runs — but the 2026-08-05 re-baseline, same corpus and
  run count, measured **sd 2.89pp** on in-diff recall instead, three times
  wider, cause not yet understood. The 2026-08-06 pin that now supersedes
  2026-08-05's headline recall figure did not restate an sd of its own (its
  three per-run values span 60.0–70.0%). **Use 2.89pp, from the 2026-08-05
  pin, as the most recently stated band** until a fresh one is published —
  but do not read it as the 2026-08-06 figure's measured variance. Both
  supersede the **±4.8pp** figure this project used for months, which was
  estimated from too few samples and made single-run comparisons unreadable in
  both directions. Read any experiment recorded against the old band as what
  it was: several are smaller than the instrument that measured them, and the
  wider band also hid real effects.
- **Every run recorded before 2026-08-01 was produced by an unpinned engine.** The
  harnesses pinned the repository under test but invoked the engine from the live
  working tree, and nothing in a scored artefact recorded which engine produced
  it. Runs from before the fix carry no provenance sidecar and are reported as
  unknown-engine, not as agreeing; treat small deltas among them as
  correspondingly weaker.
- **`recall` on the public benchmark understates heavily.** Its answer key is
  incomplete: in one measured run the engine produced 86 plausibility-confirmed
  real defects the key did not list against 48 matched ones. Benchmark `recall`
  and real-repository-corpus recall are therefore not comparable to each other.
  `adjustedPrecision` is the trustworthy precision figure.
- **Rates computed over matched findings** (`severityAccuracy`, `lineAccuracy`,
  the severity-weighted scores) are not comparable between runs whose recall
  differs, because the denominator itself changed.
- **The judge is scored, and can fail.** If semantic-judge agreement falls below
  `evaluation.minJudgeAgreement` (default `0.9`), the run reports
  `scoring.judgeTrustworthy: false` and its quality metrics must be treated as
  untrustworthy.
- **Public benchmark results are sanity checks, not release evidence** —
  contamination risk is real and public golden comments often lack line metadata.

See [Quality and evaluation](../05-quality/) for definitions and comparison
workflow.

---

## Operational limitations

| Limitation | Detail |
| --- | --- |
| Node version | Requires Node.js `>= 24.15.0` (`.nvmrc` pins `24.15.0`). |
| Repository root is the working directory | The CLI reviews the repository at the current working directory; config, `.env`, instructions, skills, baseline, and artifacts all resolve under that root. There is no `--repo` flag. |
| Full git history required | Intake resolves a merge base; a shallow clone without the divergence point fails with `merge_base_unavailable` (exit 3) rather than diffing something misleading. |
| Runs are not resumable | Review execution is stateless and one-shot. A failed run writes partial artifacts (`run-summary.json`, `context-ledger.json`, `shared-context.json`, `observability.json`, `error.json`) and the next invocation re-plans and re-executes from scratch. |
| Coverage fails closed | A completed report requires `coverage.status = complete`. Budget pressure splits work into more tasks; it never silently truncates required source. Packet overflow is a hard pre-call failure (`task_packet_budget_exceeded`), not a trim. |
| Structural signal languages | Support signals exist for TypeScript, JavaScript, Python, Go, Rust, Java and Ruby, all through one ast-grep engine. Other languages still get a full model review — just with fewer structural hints. Core contracts stay language-neutral. |
| TypeScript/JavaScript signals cover declarations, not only exports | The extractor emits a `declaration` fact for every **named behavioural** declaration — function, generator function, class, abstract class, method, and a `const`/`let` bound to an arrow function, function expression, class or generator — whether or not it is exported, plus a `public-symbol` fact when the same line is exported. Exports are recorded separately, ESM and, since 2026-07-30, CommonJS alike (`module.exports = { … }`, `module.exports = name`, `exports.x`, a named function or class expression). What remains invisible: `interface` and `type` declarations, which have no body to hold a behavioural pattern, and an anonymous `module.exports = function () {}`, which names nothing a peer set or reference lookup could match. Note that `INV-ESM-001` constrains *our own* source to ESM; it says nothing about what we can review. |
| CommonJS support was added after measurement | Before 2026-07-30 the extractor recognised ESM only, so a CommonJS file produced **no facts at all** and both consumers above degraded *silently* — reporting "nothing to say" rather than "cannot see". `fastify`'s 701-line `lib/route.js` produced zero facts; four real JavaScript repositories yielded **6 declarations in total**. After the fix the same four yield **891 exports across 415 files**. Evidence: [signal coverage report](../../reports/2026-07-30-signal-coverage-and-conformance-yield.md). |
| Provider adapters are separate installs | Only the adapter for your configured provider is imported. Bedrock and Azure adapters must be installed explicitly. |
| Files that are skipped | Deleted, binary, oversized (`review.maxFileBytes`, default 500000), and excluded paths are recorded as skipped, not reviewed. Lock files, minified bundles, source maps, and snapshots are excluded by default. |
| Cost data can be missing | Token/cost metadata is recorded when the provider supplies it. Missing pricing data is reported as unavailable, never as free. |

---

## Known behavioral caveat

Refutation is strict by design, and the strictness has a measured cost in recall
— see [Why precision first](why-precision-first.md). Suspicions the refuter can
neither prove nor disprove are not discarded: they land in the report's
**"Unresolved - Needs Human Decision"** section, excluded from the quality gate.
If you never read that section, you are getting the strict half of the tradeoff
without the compensating half.

---

## See also

- [What it is](what-it-is.md)
- [Install and run](../02-getting-started/install-and-run.md)
- [Optional capabilities](../03-concepts/optional-capabilities/)
- [Reference](../06-reference/)
