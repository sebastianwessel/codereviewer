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
local review-comment drafts, an evaluation runner with quality gates, and three
independently runnable advisory commands (`intent check`, `impact check`,
`conformance check`) that are off by default and cannot fail a pipeline.

Explicitly **not** implemented:

- network PR-comment publishing;
- CI-native check annotations;
- a GitHub Action;
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

The deterministic security-signal evidence layer (spec 15, Mechanism 2) has no
implementation yet, so there is no `security.signals.enabled` key — a key with no
behavior behind it would be a switch that lies about doing something. It ships
alongside the layer, not before it. Similarly, the evaluation block has no
`enabled` key: case selection is driven by `eval run` CLI flags, and the SARIF
reporter has no `sarif.redact` key, since it redacts unconditionally regardless.

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

- **The current headline, and the only figure that should be quoted for the review
  stage:** **46.0% recall at 100% adjusted precision, ~$2.24**, on a 37-case
  real-repository corpus with the engine pinned. It supersedes every earlier
  figure. → [Current results](../05-quality/current-results.md)
- **The known quality limitation is enumeration, and it now has a measured
  split.** Of 87 expected findings, the 60 inside the diff were found at **66.7%**
  and the 27 sitting elsewhere in a changed file were found at **0 of 27**. Not
  "low" — zero, over a full denominator. Every one of those 27 was in a file the
  reviewer had been shown **in full**, so it needed no retrieval, no larger
  context window and no bigger model. It is an attention failure, not an
  information failure, and it is the reason the iterative review-fix-re-review
  loop matters more than any single-pass tuning.
  → [What limits recall](../05-quality/what-limits-recall.md)
- **The three advisory stages have no accuracy measurement at all.**
  `intent check`, `impact check` and `conformance check` are implemented and
  runnable; none of them has been scored against an answer key. Treat their output
  as a prompt for a human, not as a result. (`intent check`'s *precision* has been
  diagnosed offline, which is a different thing from an accuracy measurement — the
  diagnosis found the dominant failure to be a question mismatch rather than
  judgement quality.)
- **A single run is not a result.** Seed-to-seed variance on the real-repository
  corpus is about 5 percentage points of recall (sd ≈ 4.8pp). A headline figure is
  a mean, never the best run, and an effect below roughly 10pp cannot be resolved
  at three seeds. Several recorded experiments are smaller than the instrument
  that measured them.
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
| Structural signal languages | Support signals exist for TypeScript/JavaScript (TypeScript compiler) and Python, Go, Rust, Java, Ruby (ast-grep). Other languages still get a full model review — just with fewer structural hints. Core contracts stay language-neutral. |
| **TypeScript/JavaScript signals cover exports only, not every declaration** | The extractor emits a fact for an **exported** symbol — ESM `export`, and since 2026-07-30 also CommonJS (`module.exports = { … }`, `module.exports = name`, `exports.x`, a named function or class expression). A **top-level declaration that is never exported remains invisible**, as does an anonymous `module.exports = function () {}`, which names nothing a peer set or reference lookup could match. Consumers affected by the remaining gap: the support-signal packet in `review`, changed symbols in `impact check`, declarations in `conformance check`. Note that `INV-ESM-001` constrains *our own* source to ESM; it says nothing about what we can review. |
| CommonJS support was added after measurement | Before 2026-07-30 the extractor recognised ESM only, so a CommonJS file produced **no facts at all** and all three consumers above degraded *silently* — reporting "nothing to say" rather than "cannot see". `fastify`'s 701-line `lib/route.js` produced zero facts; four real JavaScript repositories yielded **6 declarations in total**. After the fix the same four yield **891 exports across 415 files**. Evidence: [signal coverage report](../../reports/2026-07-30-signal-coverage-and-conformance-yield.md). |
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
