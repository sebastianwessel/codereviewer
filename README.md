# CodeReviewer

A command-line code review engine that looks for **semantic defects** — the
wrong-branch, missing-guard, leaked-handle, broken-contract class of bug that
compiles cleanly and passes lint.

It is built precision-first. A whole-file discovery pass proposes candidate
defects, an independent refutation pass tries to disprove each one, and a
deterministic gate — not a model — decides what becomes a finding. It writes
JSON, Markdown and SARIF to a local directory. It never publishes anything, never
modifies your code, and never executes it.

---

## What it measurably does, and does not do

Measured on a 37-case corpus of real repositories, checked out in full at the
commit before the upstream fix, with the engine pinned at a known commit and zero
provider errors, against `openai/gpt-5.3-codex`. 2026-07-31; it supersedes every
earlier figure this project has published. **Every model-backed rate and cost
quoted on this page is a property of that model**, not of the engine — a
different model changes what is found and what is proved, not only what it costs.
The one exception is `impact check`, which makes no provider call, so its figure
below is model-independent.

| | |
| --- | ---: |
| Recall, in-diff | **~61%** |
| Adjusted precision | **~99%** |
| Cost | **~$2.20** per 37-case run |

Mean of three runs at one pinned engine, with the dependency tree pinned too.
Run-to-run standard deviation is **0.66pp** on recall, so a difference under about
2pp between two runs is not a difference.

A rate is also a property of the configuration it was measured in: **none of the
figures on this page were measured with change-intent context enabled**, which
became a default on 2026-08-11. That flip changes what discovery is shown, so it
could move these numbers in either direction, and the A/B that would say which is
owed rather than done.

Split by where the defect lives:

| Where the defect is | Expected | Recall |
| --- | ---: | ---: |
| Inside the diff | 60 | **~61%** |
| Elsewhere in a changed file | 27 | **0.0%** |

Quote the in-diff figure, not a blended one. `review` is diff-scoped by design, and
the 27 defects elsewhere are what `impact check` exists for — it localises **74.1%**
of them. Averaging the two scores one stage against another's job.

Read that second row before you adopt the tool. **The engine finds defects the
change points at, and does not find ones elsewhere in the file** — and all 27
misses sat in files it had already been shown *in full*, so this is not a
retrieval or context-size problem that a bigger model or a wider window fixes.
A prompt reframing was pre-registered and measured against it: out-of-diff stayed
at exactly 0 of 27 while raw findings rose, so it is not a wording problem either.

An earlier version of this table claimed **46.0% recall at 100% adjusted
precision**. That figure was measured before engine pinning recorded the
dependency tree, and re-running the same commit against a verified tree returned
~42% blended and ~95% precision. The gap was the environment, not the code. Any
number here measured without a recorded `dependencyDigest` should be treated as
unverified.

So, plainly:

- **What it reports is almost always real.** Adjusted precision is ~99% across
  three runs. It is not a triage queue.
- **It does not find everything.** Fewer than half the known defects, and none of
  the ones the diff does not point at.
- **It complements review; it does not replace it.** Nor a linter, a type
  checker, tests, or SAST — it assumes those already run.
- **Re-running after each round of fixes is worth more than any tuning.** Each fix
  moves the diff, which moves what the reviewer is pointed at.

The full record — including the interventions that were built, measured, and
rejected — is in [Current results](docs/05-quality/current-results.md) and
[What limits recall](docs/05-quality/what-limits-recall.md).

### Two advisory stages, none of them measured

Alongside the defect search, `review` runs two advisory lanes in the same
process: intent (does the change do what the ticket said?) and impact (who
depends on what changed?). Both are **on by default since 2026-08-11**, and both
remain independently runnable as `intent check` and `impact check`. Neither can
fail a pipeline — that is a spec requirement, not a default.

**They have no accuracy measurement at all.** They are shipped and runnable; they
are not validated. Treat their output as a prompt for a human, not a result.
Defaulting them on was a product decision about what a review should answer, and
it makes no claim about how well they answer it.

A third, `conformance check`, was removed on 2026-08-02: its own firing-rate
measurement put it at 7.0 reports per PR-sized range against a pre-registered
kill criterion of ≈0.5, with zero true positives across roughly 300 hand-judged
divergences. The record is in
[invariant-conformance review (removed)](docs/03-concepts/optional-capabilities/invariant-conformance.md).

---

## Install

> Requires Node.js `>= 24.15.0`. **Nothing is published to npm yet** — the
> package is publishable and a release workflow publishes on a version bump, but
> no version has reached the registry, so there is no `npm install -g` and no
> `npx` today. You run it from a source checkout.

```bash
git clone <repository-url> codereviewer && cd codereviewer && npm install
```

If you want to review a *different* repository, build once and invoke the built
entry point with that repository as the working directory:

```bash
npm run build
cd /path/to/your-project
node /path/to/codereviewer/dist/cli/main.js review --base-ref origin/main --head-ref HEAD
```

The CLI always reviews `process.cwd()`; there is no `--repo` flag. The examples
below assume an alias:

```bash
alias codereviewer='node /path/to/codereviewer/dist/cli/main.js'
```

Inside the checkout itself, `npm run cli -- <args>` does the same thing without a
build step.

---

## 30-second start

From inside the repository you want reviewed:

**1.** Run it with no provider first. This costs nothing and makes no network
call — it proves your refs, paths and scope are right before you spend anything.

```bash
codereviewer review --base-ref origin/main --head-ref HEAD
```

```json
{ "runId": "run-fb8f5cc8…", "qualityGatePassed": true, "artifactDir": ".codereviewer/runs/run-fb8f5cc8…" }
```

Open `.codereviewer/runs/<run-id>/report.md` and check that **Coverage** lists the
files you expected and **Skipped Files** holds no surprises.

**2.** Name a provider and a model in `.codereviewer/config.json`. That is the
whole configuration — every other key has a default, and the defaults are the
product rather than a starting point.

```json
{
  "provider": { "id": "openai", "model": "gpt-5.3-codex" }
}
```

**3.** Check it, then review for real.

```bash
export OPENAI_API_KEY=sk-…
codereviewer config validate     # prints the merged config, secrets masked
codereviewer review --base-ref origin/main --head-ref HEAD
```

Exit `0` means the quality gate passed, `1` means it failed — a quality signal,
not a crash. The full list is in
[Exit codes](docs/06-reference/exit-codes-and-error-codes.md).

Next: [Your first review](docs/02-getting-started/first-review.md) walks the same
path with the failure modes, and [Reading a report](docs/02-getting-started/reading-a-report.md)
covers what each section of `report.md` means.

There is also a packaged [setup skill](skills/codereviewer-setup/SKILL.md) an AI
agent can follow to do the whole install — provider choice, config, CI wiring and
gate ordering — in the right order.

---

## Commands

| Command | What it does | Can it block? |
| --- | --- | --- |
| `review` | The review. Discovery → refutation → admission → report → quality gate, plus both advisory lanes below in the same process. | **Yes**, exit `1` |
| `intent check` | Maps a stated intent to the change: obligations, and the changed lines that evidence each. Also a lane inside `review`. | No, always exits `0` |
| `impact check` | Deterministic reference report for the symbols the change touched. Makes no provider call. Also a lane inside `review`. | No |
| `config validate` | Prints the fully merged configuration with secrets masked. | — |
| `baseline write` | Writes the fingerprints of a completed report's findings to the baseline. | — |
| `drift check` | The deterministic docs/spec/generated-artifact drift check, on its own. | Yes, exit `1` |
| `eval run` | The measurement harness. Its default `stable` gate checks only parse validity and provider errors — both mechanical, neither subject to seed variance. `--gate-profile strict` restores the old all-or-nothing bar. | Yes, exit `1` |
| `eval compare` / `recall-report` / `slice-manifest` | Read and diff saved eval reports. Free — no provider call. | — |

There is no `--help`; an unrecognised flag exits `2` with the flag named, on
purpose. Full reference: [CLI](docs/06-reference/cli.md).

---

## Configuration in one line

Naming a provider and a model is enough. Most defaults were set by measurement —
several of them measured *against* the intuitive value — and the rest were set by
a product decision that is labelled as one. Which kind a given default is matters
more than its value, so the [optional-capability decision
table](docs/03-concepts/optional-capabilities/README.md) says for every switch
whether a measurement, an absent measurement, or a product judgement put it where
it is.

Configuration merges lowest-to-highest: built-in defaults → `.codereviewer/config.json`
→ process environment → `.env` → CLI flags. Every object is a strict schema, so a
typo exits `2` with the key named rather than being silently ignored.

Defaults worth knowing:

| Default | Value |
| --- | --- |
| Cross-file retrieval | **on** |
| Change-intent context, impact lane, intent lane, inline comments | **on** — the four flipped on 2026-08-11 for the product, with no accuracy claim |
| Fix lane, verification, skills, review conversation, dedicated security pass, signal facts, impact adjudication | **off** — each for a reason recorded in the decision table |
| Discovery partitioning | 2 changed files per call |
| Proactive byte caps | none, anywhere |
| Time bounds | `provider.timeoutMs` only — there is no whole-run deadline |
| Quality gate | strict: `maxCritical: 0`, `maxHigh: 0` |
| Severity floor | `medium` |

→ [Configuration recipes](docs/04-guides/configuration.md) ·
[Configuration reference](docs/06-reference/configuration/README.md)

---

## Provider setup

Adapters are optional peer packages; the base install pulls in no provider SDK
and only the one you configure is imported.

```bash
npm run provider:install:openai    # OpenAI and OpenAI-compatible
npm run provider:install:bedrock   # AWS Bedrock
npm run provider:install:azure     # Azure AI Foundry
```

Credentials are read from the environment by the adapter — `OPENAI_API_KEY`;
`AWS_REGION` plus the AWS credential chain; `AZURE_AI_ENDPOINT` and
`AZURE_AI_API_KEY` — never from the config file.

→ [Providers](docs/04-guides/providers.md)

---

## How quality is measured

A review engine that cannot be measured is a matter of opinion, so measurement is
part of the project rather than a report card bolted on afterwards.

Every evaluation case is a real code change with a curated list of the defects it
contains. The engine reviews it blind and its findings are compared against that
list by a **model judge** that is itself calibrated against human-labelled pairs —
because the same defect can be described two correct ways, and lexical matching
scores paraphrase as failure.

Two properties matter more than any single figure:

- **Recall against an incomplete answer key understates quality.** A curated key
  lists the defects a curator found, not every defect present. A second
  *plausibility* judge rules on each finding the key did not list, and confirmed
  ones are reported as **unlisted-real** rather than counted as mistakes. That is
  why **adjusted precision** is the precision figure quoted here; raw precision is
  its lower bound.
- **Seed-to-seed variance is real and measured.** On the real-repository corpus
  the same configuration run repeatedly varies by about 5 percentage points of
  recall. A single run that beats another by a few points has not demonstrated
  anything.

Run the harness yourself:

```bash
npm run eval:benchmark
```

Read `scoring.judgeTrustworthy` in the report first: a run whose judge falls below
the configured calibration agreement declares its own metrics untrustworthy.

→ [How quality is measured](docs/05-quality/README.md) ·
[Running an evaluation](docs/05-quality/running-an-evaluation.md)

---

## Documentation

The documentation is ordered from high level to deep — each section assumes the
ones before it. Start at [docs/README.md](docs/README.md).

| Section | Read it for |
| --- | --- |
| **[01 Overview](docs/01-overview/)** | What this is, why precision-first, how it fits your pipeline, and an honest [status and limitations](docs/01-overview/status-and-limitations.md) page |
| **[02 Getting started](docs/02-getting-started/)** | [Install and run](docs/02-getting-started/install-and-run.md) · [your first review](docs/02-getting-started/first-review.md) · [reading a report](docs/02-getting-started/reading-a-report.md) |
| **[03 Concepts](docs/03-concepts/)** | The [review lifecycle](docs/03-concepts/review-lifecycle.md), one page per pipeline stage, the [two flows](docs/03-concepts/two-flows.md), the [trust model](docs/03-concepts/trust-model.md), and the [optional-capability decision table](docs/03-concepts/optional-capabilities/README.md) |
| **[04 Guides](docs/04-guides/)** | [Configuration](docs/04-guides/configuration.md) · [Providers](docs/04-guides/providers.md) · [Instructions and skills](docs/04-guides/instructions-and-skills.md) · [Tuning noise and recall](docs/04-guides/tuning-noise-and-recall.md) · [Controlling cost](docs/04-guides/controlling-cost.md) · [CI/CD](docs/04-guides/ci-cd.md) |
| **[05 Quality](docs/05-quality/)** | [How quality is measured](docs/05-quality/README.md) · [Metrics](docs/05-quality/metrics.md) · [Judges](docs/05-quality/judges-and-calibration.md) · [Datasets](docs/05-quality/datasets.md) · [Current results](docs/05-quality/current-results.md) · [What limits recall](docs/05-quality/what-limits-recall.md) |
| **[06 Reference](docs/06-reference/)** | [CLI](docs/06-reference/cli.md) · [Configuration](docs/06-reference/configuration/README.md) · [Environment](docs/06-reference/environment.md) · [Exit and error codes](docs/06-reference/exit-codes-and-error-codes.md) · [Artifacts](docs/06-reference/artifacts.md) |
| **[07 Security](docs/07-security/)** | [Threat model](docs/07-security/threat-model.md) · [Prompt injection](docs/07-security/prompt-injection-and-untrusted-input.md) · [Permissions](docs/07-security/permissions-and-path-containment.md) · [Data handling](docs/07-security/data-handling-and-redaction.md) · [Secrets](docs/07-security/secrets-and-credentials.md) |
| **[08 Operations](docs/08-operations/)** | [Troubleshooting](docs/08-operations/troubleshooting.md) · [Partial and failed runs](docs/08-operations/partial-and-failed-runs.md) |
| **[09 Contributing](docs/09-contributing/)** | [Repo map](docs/09-contributing/repo-map.md) · [Spec-driven workflow](docs/09-contributing/spec-driven-workflow.md) · [Tests and checks](docs/09-contributing/running-tests-and-checks.md) · [Adding evaluation cases](docs/09-contributing/adding-evaluation-cases.md) |
| **[Skills](skills/)** | [Setup skill](skills/codereviewer-setup/SKILL.md) — for an AI agent installing this into a repository |
