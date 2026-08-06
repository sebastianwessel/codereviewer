# Install And Run

How to get the CLI running from a source checkout, configure a model provider,
and confirm the setup — before you review anything real.

---

## There is no package to install yet

The project is **not published to npm**. The release pipeline exists and the
package builds a clean tarball, but no version has been released, so
`npm install -g` and `npx` do not work. You run it from a git checkout.

---

## Prerequisites

| Requirement | Notes |
| --- | --- |
| Node.js `>= 24.15.0` | Enforced by `engines`. `.nvmrc` pins `24.15.0`; run `nvm install && nvm use` if you use nvm. |
| npm | Bundled with Node. |
| git | Required for diff-based review; git usage is read-only. |
| A model provider (optional) | Without one, the run performs everything except model-backed discovery. |

---

## Step 1 — Clone and install

```bash
git clone <repository-url> codereviewer
cd codereviewer
npm install
```

`npm install` pulls the harness runtime, the ast-grep parsers, and — because it
is a devDependency of this repository — the OpenAI adapter
`@purista/harness-openai`.

Verify the toolchain:

```bash
npm run typecheck
npm test          # hermetic; never calls a real model provider
```

---

## Step 2 — Choose how you invoke the CLI

There are two supported entry points. Which one you want depends on **which
repository you are reviewing**, because the CLI always reviews the repository at
its current working directory — there is no `--repo` flag.

### A. Reviewing this repository (development loop)

Run through the repo's own script, which executes TypeScript directly via `tsx`
and loads a local `.env`:

```bash
npm run cli -- review --base-ref origin/main --head-ref HEAD
```

Everything after `--` is passed to the CLI. npm runs scripts from the package
root, so this always reviews the checkout itself.

### B. Reviewing another repository

Build once, then invoke the built entry point from inside the target repository:

```bash
# in the checkout
npm run build            # tsc -> dist/

# in the repository you want reviewed
cd /path/to/your-project
node /path/to/codereviewer/dist/cli/main.js review --base-ref origin/main --head-ref HEAD
```

A shell alias makes this bearable:

```bash
alias codereviewer='node /path/to/codereviewer/dist/cli/main.js'
```

> **Working directory is the repository root.** Config, `.env`, instruction
> files, skills, the baseline, and the artifact directory all resolve *under the
> current working directory*, and paths are contained to it. Run the CLI from the
> root of the repository you intend to review.

---

## Step 3 — Configure

Configuration merges lowest-to-highest precedence:

```text
built-in defaults
  → .codereviewer/config.json
  → process environment
  → .env (repository root)
  → CLI flags
```

Everything is optional; the engine runs on built-in defaults. A missing config
file is normal (the run records a `config-file-missing` warning). Unknown keys
are rejected.

### File config

**Naming a provider and a model is enough.** Every other default was set by
measurement, and several were set *against* the value that felt safe — so the
recommended starting config is exactly this, in `.codereviewer/config.json` in the
repository being reviewed:

```json
{
  "provider": {
    "id": "openai",
    "model": "gpt-5.3-codex"
  }
}
```

`provider.model` is free text and is never checked against a catalogue; a wrong
name surfaces as a provider error on the first call. Add keys beyond this block
only when you have a reason — the [configuration guide](../04-guides/configuration.md)
is organised as one recipe per reason.

### Environment config

The `review` command reads a `.env` file from the repository root automatically.
In this checkout, `.env.example` documents the supported variables:

```bash
cp .env.example .env     # inside the checkout; .env is gitignored
```

For another repository, create `.env` there by hand — `.env.example` lives in the
checkout, not in your project.

Supported environment variables (this is the complete list of keys mapped into
config):

| Variable | Maps to |
| --- | --- |
| `CODEREVIEWER_REVIEW_MODE` | `review.mode` — `local` \| `ci` \| `pr` \| `full` |
| `CODEREVIEWER_REVIEW_DEPTH` | `review.depth` — `fast` \| `balanced` \| `thorough` |
| `CODEREVIEWER_BASE_REF` | `review.baseRef` |
| `CODEREVIEWER_HEAD_REF` | `review.headRef` |
| `CODEREVIEWER_PROVIDER_ID` | `provider.id` — `openai` \| `openai-compatible` \| `bedrock` \| `azure` |
| `CODEREVIEWER_PROVIDER_MODEL` | `provider.model` |
| `CODEREVIEWER_PROVIDER_BASE_URL` | `provider.baseUrl` (required for `openai-compatible`) |
| `CODEREVIEWER_PROVIDER_REASONING_EFFORT` | `provider.reasoningEffort` |
| `CODEREVIEWER_AI_DETERMINISTIC_SIGNAL_MODE` | `aiReview.deterministicSignalMode` — `support` \| `disabled` |
| `CODEREVIEWER_CONFIG_PATH` | Config file location |
| `CODEREVIEWER_ARTIFACT_DIR` | `paths.artifactDir` |
| `CODEREVIEWER_SKILLS_DIR` | `skills.directories` |
| `CODEREVIEWER_LOG_LEVEL` | `observability.logging.level` |
| `CODEREVIEWER_OPENTELEMETRY_ENABLED` / `_ENDPOINT` / `_HEADERS` | OpenTelemetry export |
| `CODEREVIEWER_COST_INPUT_PER_MILLION` / `_CACHED_INPUT_PER_MILLION` / `_OUTPUT_PER_MILLION` | Pricing overrides for cost estimation |

Provider **credentials** are read from the environment by the adapter itself:
`OPENAI_API_KEY`; `AWS_REGION` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`;
`AZURE_AI_ENDPOINT` / `AZURE_AI_API_KEY`. Secrets are never written to logs,
traces, or reports.

---

## Step 4 — Install a provider adapter (only the one you use)

Adapters are optional peer packages, imported dynamically. The base install
contains no provider SDK.

| Provider | Package |
| --- | --- |
| OpenAI and OpenAI-compatible | `@purista/harness-openai` (already a devDependency of this checkout) |
| AWS Bedrock | `@purista/harness-bedrock` |
| Azure AI Foundry | `@purista/harness-azure-foundry` |

Install with npm, or use the repository's convenience scripts (they are thin
wrappers around `npm install`, available only inside the checkout):

```bash
npm install @purista/harness-bedrock
# equivalently, from inside the checkout:
npm run provider:install:bedrock
```

---

## Step 5 — Validate the configuration

```bash
npm run cli -- config validate
# or: node /path/to/codereviewer/dist/cli/main.js config validate
```

It prints the effective configuration with secrets redacted, and exits `0`.
A configuration error exits `2` with a JSON error on stderr.

---

## Command inventory

| Command | Purpose | Can it block? |
| --- | --- | --- |
| `review` | Run a review. See [Your first review](first-review.md). | **Yes** (exit `1`) |
| `intent check` | Map a stated intent to the change. Needs `intentFulfilment.enabled` plus a `contextSources` provider. | No — nothing it reports sets a non-zero exit. It does exit `4` when an input limit binds, rather than judging part of the input |
| `impact check` | Reference report for the changed symbols, plus the dependents shown to rely on what changed. Needs `changeImpact.enabled`. Makes no provider call unless `changeImpact.adjudication.enabled` is also set. | No |
| `config validate` | Print the effective, redacted configuration. | — |
| `baseline write` | Write `baseline.path` from a completed report. | — |
| `drift check` | Run the deterministic documentation/spec/implementation drift check on its own. | Yes (exit `1`) |
| `eval run` | Run the evaluation harness over fixtures or a slice pack. | Yes (exit `1`) |
| `eval compare` | Diff two eval arms (repeatable `--base`, `--head`). | — |
| `eval recall-report` | Per-expected-finding recall report from saved eval reports (`--report`, repeatable). | — |
| `eval slice-manifest` | Deterministic manifest of a local slice pack (`--slice-root`). | — |

Anything else exits `2` with a usage error. Each of the two advisory commands
requires the literal subcommand `check`, accepts `--base-ref`, `--head-ref` and
`--format` beyond `--config`, and reports its own disabled state as a warning
inside an exit-`0` report rather than as an error:

```bash
codereviewer impact check --base-ref origin/main --head-ref HEAD
```

```json
{
  "schemaVersion": "1.1",
  "status": "disabled",
  "warnings": ["Change-impact review is disabled. Set changeImpact.enabled to true to run it."]
}
```

Full contracts: [CLI reference](../06-reference/cli.md).

### `review` flags

| Flag | Meaning |
| --- | --- |
| `--base-ref <ref>` | Base ref for the diff. Defaults to `review.baseRef` (`main`). |
| `--head-ref <ref>` | Head ref. Defaults to `review.headRef` (`HEAD`). |
| `--file <path>` | Review an explicit file. Repeatable. Bypasses the git diff. |
| `--files <a,b,c>` | Comma-separated explicit file list. |
| `--config <path>` | Config file path (default `.codereviewer/config.json`). |
| `--log-level <level>` | `trace` \| `debug` \| `info` \| `warn` \| `error` \| `fatal` \| `silent`. Default is `silent`. |
| `--debug` | Shorthand for `--log-level debug`. |
| `--log-file <path>` | Append JSONL logs to a file under the repository root. |

> `review` has **no** `--review-mode` / `--review-depth` / `--max-concurrent-tasks`
> flags — those exist only on `eval run`. Set mode, depth, and concurrency through
> config or environment variables.

---

## Next

- [Your first review](first-review.md) — run it end to end and understand the output.
- [Reading a report](reading-a-report.md) — what each section of `report.md` means.
- [Guides](../04-guides/) — configuration, providers, instructions and skills.
- [Reference](../06-reference/) — full CLI, configuration, environment, and exit-code contracts.
- [Status and limitations](../01-overview/status-and-limitations.md) — what is off by default and why.
