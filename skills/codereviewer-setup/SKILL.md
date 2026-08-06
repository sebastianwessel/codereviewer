---
name: codereviewer-setup
description: Set up the CodeReviewer engine in a repository — pick a provider, write a minimal config, verify it without spending money, wire a CI job, and only then turn on gates. Also covers running and reading its three stages (review, intent check, impact check). Use when asked to install, configure, adopt, run, tune, or add CodeReviewer to a project, or to wire AI code review into a pipeline.
---

# Setting up CodeReviewer in a repository

You are configuring a semantic code review engine for someone else's repository.
The engine costs real money per run and can block their merges, so the order of
operations matters more than the config file you end up with.

**The one rule that governs everything below: never enable a gate before you have
seen a run.** A gate you have not watched fire is a gate that will fire on the
wrong thing, in someone else's pull request, on a Friday.

## What you are setting up

Three independently runnable stages. They share no context and no output.

| Stage | Command | Blocks a pipeline? | Costs money? |
| --- | --- | --- | --- |
| Review | `review` | Yes — exit `1` on gate failure | Yes |
| Intent | `intent check` | No, never — always exits `0` | Yes, when enabled and a provider resolves |
| Impact | `impact check` | No, never | No by default — deterministic. Only `changeImpact.adjudication.enabled` makes it call a provider, and that is off separately from the command |

Advisory is a spec requirement for the two `check` stages, not a default: there
is no `blocking` key to find, and writing one exits `2`.

Set up `review` first and alone. The advisory two are additions for a team that
already trusts the review output, not part of an initial install.

The remaining commands:

- `config validate` — free, step 4 below.
- `baseline write` — step 6 below.
- `drift check` — a maintenance gate for **this engine's own repository**
  (it scans `README.md`, `docs/`, `specs/` and a generated schema path). Do not
  wire it into a target project.
- `eval run` / `eval compare` / `eval recall-report` / `eval slice-manifest` —
  the measurement harness for engine development. Never part of a user setup;
  `eval run`'s regression-gate keys (including `minProductRecall`) have nothing
  to do with the review quality gate.

## The flag surface, in full

Only these flags are parsed. An unknown flag is **rejected before the command
does any work** (exit `2`, `usage_error`, naming the flag) — a flag one command
accepts is still unknown to another.

| Command | Flags |
| --- | --- |
| `config validate` | `--config` |
| `review` | `--config`, `--base-ref`, `--head-ref`, `--file` (repeatable), `--files a,b,c`, `--debug`, `--log-level`, `--log-file` |
| `baseline write` | `--config`, `--report` |
| `impact check` | `--config`, `--base-ref`, `--head-ref`, `--format json\|markdown` |
| `intent check` | `--config`, `--base-ref`, `--head-ref`, `--format json\|markdown` |

Both spellings work: `--base-ref main` and `--base-ref=main` are equivalent, on
every flag. That was not always true — four parsers accepted the joined form by
name and then silently dropped it, so a run proceeded on defaults at exit `0` —
and it was fixed by teaching every parser both forms rather than by rejecting one.

`--config`, `--debug`, `--log-level` and `--log-file` are global; the last three
only take effect on `review` and `eval run`, which build a logger. `--file` /
`--files` bypass git diffing entirely. There is no `--help`, no `--version`, no
`--repo`, and no mode/depth/severity/threshold flag on `review` — those are
config keys or environment variables.

## It is language-neutral

Deterministic support signals are extracted by **one AST engine, ast-grep**, for
seven languages: TypeScript (`.ts .tsx .mts .cts`), JavaScript
(`.js .jsx .mjs .cjs`), Python (`.py`), Go (`.go`), Rust (`.rs`), Java
(`.java`), Ruby (`.rb`). A TypeScript-compiler-based extractor once existed and
was deleted.

Files in any other language still get a **full model review** — they simply
arrive with fewer structural hints. Do not describe this as a
TypeScript/JavaScript tool, and do not tell a Python or Go team it is not for
them.

## What it measurably does

Say this before the user invests in the setup. The report says it too, in its
own opening paragraph.

On a 37-case real-repository corpus with the engine pinned (`db78900`):

- **In-diff recall mean 68.3%** over three runs — 66.7 / 66.7 / 71.7, sd 2.89pp —
  about 7 in 10 defects sitting inside the diff.
- **0 of 27** for defects sitting elsewhere in a changed file. A measured zero
  over a full denominator, and by design: this stage is diff-scoped.
- **Adjusted precision mean 96.2%** — roughly 19 in 20 of what it reports stands
  up. Raw precision 77.8%.
- **$1.97 for a cold-cache run, $0.82 warm.** Quote both: the spread is more
  than 2x, and an A/B whose second arm inherits the first's warm cache is
  measuring the cache.
- Two runs over the same commit do not produce the same report.

The adjusted-precision figure is **not** comparable to the 99.1% an earlier
baseline recorded. The eval's scoring version changed in a way that alters which
findings are credited for identical review output, so the two numbers answer
slightly different questions. Publish 96.2% as the current rate; never present it
as a fall from 99.1%.

Judge any change to this stage against the **wider** of the two spreads on
record — 2.89pp, not the earlier 0.96pp — because under-stating the band is what
manufactures false positives. That is caution about a three-run estimate, not a
claim that stability regressed; the ledger explicitly declines to call the
difference established.

**Every one of those rates was measured on `openai/gpt-5.3-codex`.** A rate is a
property of a model, not of the engine. If the user configures a different
provider or model, the rates above do not describe their setup and must not be
quoted at them — the report itself prints the warning, naming both the measured
model and the one the run used, and every report carries a `- Model:` line.

`intent check` has its own measured rates, printed in its own report: about 1 in
29 obligations it calls *evidenced* is still outstanding at head, and about 1 in
10 genuinely outstanding obligations never appear on the list. `impact check`
has one measurement — its deterministic reference report localises 20 of 27
out-of-diff expectations inside a symbol it flagged — which is coverage, not
detection. Its optional adjudication layer has **no** measurement at all; see
step 9.

Consequences for how you set it up:

- It complements review; it does not replace it. Do not let anyone reduce human
  review because this is running.
- Because it finds what the change points at, **re-running after each round of
  fixes is worth more than any single-run tuning**. Wire it to run on every push
  to the branch, not just the first.
- A quiet report is the normal case, not a broken install.

## Step 1 — Check the ground

```bash
node --version          # must be >= 24.15.0 (.nvmrc pins 24.15.0)
git rev-parse --git-dir # must be a git repository
```

Confirm you are at the **repository root**. The CLI reviews `process.cwd()` and
has no `--repo` flag; config, `.env`, the baseline, and all artifacts resolve
under it.

Then decide how the CLI will be invoked. The package declares a `codereviewer`
bin (`dist/cli/main.js`) and is publishable, but **no version has been published
to npm**, so there is no `npm install -g` and no `npx`. Run it from a source
checkout:

- **A** — the target repo *is* the engine checkout: `npm run cli -- <args>`
  (runs TypeScript through `tsx` and loads `.env`).
- **B** — separate repos: build the engine once (`npm run build`) and invoke
  `node <engine>/dist/cli/main.js <args>` with the target repo as the working
  directory.

Most setups are B. Confirm which one applies before writing CI, because the
invocation line differs.

## Step 2 — Pick a provider

Ask which one the organisation already has credentials and an approval path for.
Do not pick on model quality — pick on what they can legally send code to.

| `provider.id` | Adapter package | Credentials read from |
| --- | --- | --- |
| `openai` | `@purista/harness-openai` | `OPENAI_API_KEY` |
| `openai-compatible` | `@purista/harness-openai` | `OPENAI_API_KEY` + a required `provider.baseUrl` |
| `bedrock` | `@purista/harness-bedrock` | `AWS_REGION`, plus the standard AWS credential chain |
| `azure` | `@purista/harness-azure-foundry` | `AZURE_AI_ENDPOINT`, `AZURE_AI_API_KEY` |

Adapters are optional peer packages imported dynamically; only the one for the
configured provider is loaded, so install exactly one. Inside the checkout,
`npm run provider:install:openai` / `:bedrock` / `:azure` are thin wrappers
around `npm install`.

Only `AWS_REGION` is checked for `bedrock`; the credentials themselves come from
the AWS credential chain, so a role or OIDC works and static access keys are not
required. Prefer OIDC in CI.

`openai-compatible` must implement the OpenAI **Responses** API — a
chat-completions gateway fails on the first call. A missing adapter is a
**config** error (`provider_adapter_missing`, exit `2`), and its message names
the `npm install` command; a missing credential is `provider_credentials_missing`
(exit `2`) and names the variable, never the value. A missing `provider.baseUrl`
on `openai-compatible` is rejected at config load, and again at resolution as
`provider_base_url_missing` (exit `2`).

`provider.model` is free text and is never validated against a catalogue. A
wrong name surfaces as a provider error on the first call, which is one reason
step 4 exists.

## Step 3 — Write the smallest config that works

Naming a provider and a model is enough. Everything else has a measured default.

```json
{
  "provider": {
    "id": "openai",
    "model": "gpt-5.3-codex"
  }
}
```

Write that to `.codereviewer/config.json` and stop. Resist adding keys. A
missing config file is not an error — defaults validate on their own, and the
run records a `config-file-missing` warning.

Two things you must **not** do here:

- **Do not put credentials in the config file.** They are read from the
  environment by the adapter. Add `.env` to `.gitignore` if you create one.
- **Do not pre-tune.** Every default in this engine was set by measurement, and
  several were measured *against* the intuitive value. A limit you set because
  it felt safe is a limit that will degrade the answer silently.

If you need to justify a key beyond those two, read
[references/config-recipes.md](references/config-recipes.md) — it lists the small
set of keys that are legitimately project-specific (mostly `paths.exclude`), the
ones people reach for wrongly, and the ones that do not exist.

## Step 4 — Verify without spending anything

Two free checks, in order.

```bash
codereviewer config validate
```

Prints the fully merged configuration with secrets masked, and exits `0`. Every
object is a strict schema, so a typo exits `2` with the offending key named —
that is the fastest way to catch a hand-written config.

Then prove the plumbing with a run that makes **no provider call at all**:

```bash
codereviewer review --base-ref <base> --head-ref HEAD
```

…with the `provider` block temporarily removed (or before you add it). Without a
provider the run does intake, deterministic signals, planning, admission,
reporting and the gate — everything but model discovery. It costs nothing.

Check three things in the output:

1. Exit code `0` and a `runId` on stdout.
2. `report.md` → **Scope of this search** shows the file count you expected.
3. `report.md` → **Skipped Files** contains nothing surprising.

If the file count is wrong, fix `paths.include` / `paths.exclude` now.
Discovering it after a paid run is the same information for money.

Common failure here: `merge_base_unavailable` (exit `3`) — a shallow clone. Full
history is mandatory; there is no fallback, deliberately.

## Step 5 — Run it for real, once, and read the report

Restore the provider block, set the credential in the environment, and run the
same command. Then **actually read `report.md`** with the user. This is the step
people skip and the reason gates get enabled badly.

`review` writes one run directory under `paths.artifactDir`
(default `.codereviewer/runs/<runId>/`): `report.json`, `report.md`,
`report.sarif`, `run-summary.json`, `context-ledger.json`, `shared-context.json`,
`observability.json` — plus `error.json` on a failed run.

Point them at these `report.md` sections, in this order:

- **Actionable Findings** — what it wants them to act on.
- **Unresolved - Needs Human Decision** — suspicions the engine could neither
  prove nor disprove. Excluded from the gate on purpose. A team that never reads
  this section gets the strict half of a precision-first design without the
  compensating half.
- **Rejected Candidates** and **Refutation Results** — where the volume went, if
  the report feels thin.
- **Scope of this search** — the run id, the `- Model:` line, the refs, and how
  much source was actually read. Coverage means *the source reached a model*,
  never *every defect was found*.
- **Changed source files with no test file in this change** — a deterministic,
  free observation, not a finding. It has no severity, counts toward no
  threshold, cannot affect the gate, and has no configuration key to turn on or
  off. Explain the limit rather than letting them infer a stronger claim: it
  compares only the files this change touched, so **a file it names may already
  be covered completely by an existing test the change had no reason to touch —
  it cannot see that test and does not say the file is untested.** The section is
  absent entirely when nothing is unpaired; an empty section would read as a
  clearance.
- **Cost And Timing** — what the run actually cost. Cost is reported as
  `unavailable` when token counts or model prices are missing, never as free. A
  warm cache can move the figure by more than 2x with no change to the review.

Ask them one question: *would you have wanted these comments on your PR?* If the
answer is no, tune before you gate — see
[references/tuning-decisions.md](references/tuning-decisions.md). If the answer
is yes, continue.

## Step 6 — Take a baseline before the gate blocks anything

The default gate is strict: `maxCritical: 0`, `maxHigh: 0`. On any repository
with existing debt that fails immediately, for reasons nobody on the team caused.

Run a review on the default branch, then:

```bash
codereviewer baseline write            # newest completed run in the run index
codereviewer baseline write --report .codereviewer/runs/<runId>/report.json
```

It writes the fingerprints of the source report's admitted findings to
`baseline.path` (default `.codereviewer/baseline.json`). Commit that file. With
`baseline.failOnNewOnly` (default `true`), only findings that are `new` or
`unknown` can fail the gate.

The source report is validated against the report contract. A file that is not a
review report fails with `baseline_source_invalid` (exit `3`) rather than
producing an empty baseline and exit `0`; no report found or readable at all is
`baseline_source_unavailable` (exit `3`).

Fingerprints anchor on the **content** of the reported line, not its number, so
edits elsewhere in the file do not resurrect a suppressed finding — but editing
the anchored line does, which is the intended signal.

Skip this step only if the repository is genuinely new.

## Step 7 — Wire CI as advisory first

Add the job **non-blocking**, and leave it that way for at least a week of real
pull requests.

The job shape is the same on every platform:

1. Check out with **full history** (`fetch-depth: 0` / `GIT_DEPTH: 0` /
   `git fetch --unshallow`). Without it the merge base cannot resolve.
2. Install the engine and exactly one provider adapter.
3. Run `review --base-ref origin/<target-branch> --head-ref HEAD`.
4. Upload the whole `.codereviewer/runs/` directory, `if: always()`.
5. **Do not fail the job on exit `1` yet.**

Working YAML for GitHub Actions, GitLab CI and Bitbucket Pipelines is in
[references/ci-templates.md](references/ci-templates.md), including the security
notes that matter (fork pull requests, untrusted PR titles, token scope).

Branch on the **exit code**, never on parsing stdout:

| Code | Meaning |
| --- | --- |
| `0` | Completed, gate passed |
| `1` | Completed, a gate failed — a quality signal, not a crash |
| `2` | Configuration, provider setup, credential, or usage error |
| `3` | Repository / filesystem error (usually a shallow clone) |
| `4` | Provider runtime error |
| `5` | Internal invariant violation — file a bug with `error.json` |

Exit `5` includes `quality_gate_missing`: a completed run whose report carries no
gate result. **An absent gate is an error, never a silent pass.** If you ever see
it, the run directory is the evidence; do not retry around it.

Set a cost tripwire while it is advisory, so a pathological change fails loudly
rather than quietly spending:

```json
{ "review": { "maxCostUsd": 5 } }
```

It is checked *after* the run completes (`cost_budget_exceeded`, exit `1`) — a
tripwire, not a mid-run brake, and it cannot be enforced at all when the provider
reported no token counts.

## Step 8 — Promote to a required check

Only after the team has seen a week of runs and agrees the findings are worth
acting on.

The review quality gate has exactly five keys, and these are all of them:

```json
{
  "qualityGate": {
    "maxCritical": 0,
    "maxHigh": 0,
    "maxMedium": 5,
    "failOnProviderError": true,
    "failOnNewOnly": true
  }
}
```

`maxCritical` and `maxHigh` default to `0`; `maxMedium` is unset by default,
meaning medium findings never fail the gate; `failOnProviderError` defaults to
`true`; `failOnNewOnly` is unset and falls back to `baseline.failOnNewOnly` at
runtime. Anything else under `qualityGate` exits `2`.

Then:

- Make the job a **required status check** so exit `1` blocks the merge instead
  of posting an advisory comment somebody scrolls past.
- Keep re-running on every push to the branch. Each round of fixes moves the
  diff, which moves what the reviewer is pointed at.
- Keep the baseline current on the default branch.

If the team is not ready to block, leave it advisory. An ignored red check is
worse than an honest advisory one.

## Step 9 — Advisory stages, later or never

Add these only once `review` is trusted, one at a time.

| Stage | Enable with | Cost |
| --- | --- | --- |
| `impact check` | `changeImpact.enabled` | Free — no provider call |
| `impact check` adjudication | `changeImpact.adjudication.enabled` (separate switch) | 1 call per behavioural (dependent, changed symbol) pair, capped by `changeImpact.adjudication.maxCalls` (default `40`) |
| `intent check` | `intentFulfilment.enabled` **and** a `contextSources` provider | 1 extraction call + 1 call per obligation + 1 explanation call |

### Impact adjudication is off separately, and unmeasured

`changeImpact.enabled` gives the deterministic reference report and nothing else.
`changeImpact.adjudication.enabled` is the only part of the stage that can reach
a provider, and it is a **second switch on purpose**: turning the command on must
never silently start spending for someone who asked for a reference list. Leave it
off, and say why if asked to enable it.

Adjudication triages the reference list down to the dependents shown to rely on
the part of the contract that changed. Structural outcomes — a removed, relocated
or newly added declaration — are settled in code and cost nothing; only a
behavioural change ("does this call site touch the part that moved?") costs a
call, and a pair the model could not settle is counted as unadjudicated and
reported nowhere.

**It has no performance number. None exists, and none may be invented.** Its spec
records the calibration in advance: published prior art for this task sits around
28% precision, adjudication is *expected* to reduce recall relative to the raw
reference list, and a first measurement near those figures would be a normal
result rather than a broken one. Do not recommend it as an improvement — present
it as an unmeasured experiment whose value is not established.

Both stages require the literal subcommand `check` and accept
`--config`, `--base-ref`, `--head-ref`, `--format json|markdown`. Stdout is one
JSON document by default; `--format markdown` puts the rendered report there
instead. Either way a **completed** run also writes
`impact-report.{md,json}` / `intent-report.{md,json}` into a run directory under
`paths.artifactDir` (`impact-<uuid>` / `intent-<uuid>`), and prints that path to
stderr. Those directories are **not** in the run index, so `baseline write`
never sees them.

Runs that mapped nothing write nothing: `impact check` when `disabled`;
`intent check` when `disabled`, `no-intent`, `unusable-intent` or
`provider-unavailable`. `no-intent` is the ordinary outcome for a change with a
thin description — wire the pipeline to write the ticket/PR body into
`.codereviewer/context/` first, or the stage has nothing to read.

Neither can fail a pipeline. Do not build a CI step that reads their JSON and
exits non-zero on it; that reintroduces a gate the measurement says is not
accurate enough to gate on.

## What this tool deliberately does not do

Say these plainly rather than letting a user discover them.

- **It does not publish anything.** No PR comments over the network, no check
  annotations, no GitHub Action.
  `reporting.reviewComments.enabled` writes *draft* comment artifacts to disk;
  posting them is a separate pipeline step with its own token scope.
- **It does not call a tracker or a forge API.** Change-intent context is
  filesystem-only: the pipeline fetches it and writes it into
  `.codereviewer/context/`, so the pipeline owns the credentials and the engine
  holds none.
- **It does not apply fixes.** The `fix` lane (off by default) only enriches
  advisory `fixProposal` metadata; it never edits the repository, and never
  changes category, severity, admission, or the gate.
- **It does not replace human review, a linter, a type checker, or SAST.** It
  assumes those already run.
- **It does not find defects outside the diff.** 0 of 27, measured. `impact
  check` is the stage aimed at that population, and it reports references, not
  findings.
- **It has no whole-run timeout, and is not resumable.** `provider.timeoutMs`
  (default `120000`) bounds one call and is the only deadline. A failed run
  writes partial artifacts and the next invocation re-plans from scratch.
- **It never truncates source silently.** Budget pressure splits work into more
  tasks; an oversized packet is a hard pre-call failure
  (`task_packet_budget_exceeded`, exit `4`), not a trim.

## Things not to do

- **Do not enable a gate you have not watched run.** The whole point of steps 4–8.
- **Do not quote the accuracy rates at a user on a different model.** They were
  measured on `openai/gpt-5.3-codex`; changing provider or model invalidates them.
- **Do not turn on optional passes to "improve recall".** Several were built,
  measured, and shipped off *because* they did not help. If you want to change
  one, measure it — a single run that looks better is not a result.
- **Do not set byte caps, obligation caps, or line caps to be safe.** Every one
  of them degrades the answer silently when it binds. They are runaway guards,
  not rations.
- **Do not commit `.env`.** The loader reads it *after* the process environment,
  so a stray `.env` in a CI image silently overrides the real secrets.

## Finishing

Report back to the user with: which provider and model were configured, the exact
config file written, whether a baseline was taken, whether CI is advisory or
blocking, what the first real run cost, and what it found. If any step was
skipped, say which and why. If the configured model is not
`openai/gpt-5.3-codex`, say that the published accuracy rates were not measured
on it.
