# Status And Limitations

An honest account of what is finished, what is unproven, and what is switched
off. Read this before you adopt the tool or quote a number from it.

---

## It is not published

`package.json` declares `"private": true` at version `0.1.0`, and there is no
publish step. **There is no npm package.**

- `npm install -g @sebastianwessel/codereviewer` does not work.
- `npx @sebastianwessel/codereviewer …` does not work.

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
local review-comment drafts, an evaluation runner with quality gates.

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

Several capabilities are implemented but disabled by default, and in the two
most interesting cases that is **because measurement said so**, not because they
are unfinished. Enabling them is a deliberate, measured choice.

| Config key | Default | Why it is off |
| --- | --- | --- |
| `review.crossFileRetrieval.enabled` | `false` | Agentic cross-file discovery — the discovery agent may read other files through mediated tools. **Measured net negative.** Built, hardened, and measured three times; recall fell each time (flat at four cases, 66.7% → 44.4% at nine, 68.8% → 56.3% at sixteen) while precision stayed perfect. |
| `review.contextScout.enabled` | `false` | A cheap scout call picks which out-of-change symbol bodies to pre-fetch, keeping the reviewer single-shot and tool-free. Built as the answer to the above; **measured neutral**. |
| `security.dedicatedPass.enabled` | `false` | A second, security-only discovery call per task. Additive by construction, but it costs an extra discovery call per task and has not cleared a held-out A/B showing net recall gain without an authorization regression. |
| `review.unanchoredPass.enabled` | `false` | Additional discovery calls over bounded units of a changed file with the diff withheld, so the reviewer reads the file instead of answering the change. Additive by construction and bounded per file and per run, but it costs **one call per unit** — the most expensive option here — and the A/B that would decide whether it ships enabled has not been run. |
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

**Consequence of the defaults:** out of the box, discovery is a single
general pass per review task, with no tools and no scout. That is the
configuration the current quality figures describe.

Defaults that are **on**: `aiReview.requireRefutation` (a literal `true` — not a
toggle), `aiReview.deterministicSignalMode: 'support'`, `baseline.enabled`,
`drift.enabled`, and the strict quality gate (`maxCritical: 0`, `maxHigh: 0`).

---

## Quality numbers: what can and cannot be claimed

- **There is no published baseline.** Expected-finding matching moved to a
  judge-only semantic matcher and the previous lexical matcher was removed, so
  every previously published number is void and not comparable to anything the
  engine produces today. A new baseline has to be recorded deliberately.
- **A single run is not a result.** Four seeds of one identical configuration on
  the real-repository corpus gave recall 81.3%, 87.5%, 81.3%, 75.0% — mean 81.3%,
  standard deviation 4.4 percentage points. A headline figure is the mean across
  seeds, never the best run; a change smaller than roughly twice that deviation
  cannot be distinguished from noise on one seed.
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
| Structural signal languages | Deep support signals exist for TypeScript/JavaScript (TypeScript compiler) and Python, Go, Rust, Java, Ruby (ast-grep). Other languages still get a full model review — just with fewer structural hints. Core contracts stay language-neutral. |
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
