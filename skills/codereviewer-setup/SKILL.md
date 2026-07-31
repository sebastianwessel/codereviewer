---
name: codereviewer-setup
description: Set up the CodeReviewer engine in a repository — pick a provider, write a minimal config, verify it without spending money, wire a CI job, and only then turn on gates. Use when asked to install, configure, adopt, or add CodeReviewer to a project, or to wire AI code review into a pipeline.
---

# Setting up CodeReviewer in a repository

You are configuring a semantic code review engine for someone else's repository.
The engine costs real money per run and can block their merges, so the order of
operations matters more than the config file you end up with.

**The one rule that governs everything below: never enable a gate before you have
seen a run.** A gate you have not watched fire is a gate that will fire on the
wrong thing, in someone else's pull request, on a Friday.

## What you are setting up

Four commands, all real:

| Command | Blocks a pipeline? | Costs money? |
| --- | --- | --- |
| `review` | Yes — exit `1` on gate failure | Yes |
| `intent check` | No, never — always exits `0` | Yes, when enabled and a provider resolves |
| `impact check` | No, never | No — deterministic |
| `conformance check` | No, never | Only with `invariantConformance.adjudication.enabled` |

Set up `review` first and alone. The advisory three are additions for a team that
already trusts the review output, not part of an initial install.

## What it measurably does

Say this to the user before they invest in the setup; it is the difference between
a tool they keep and one they rip out in a month.

On a 37-case corpus of real repositories, the review stage measures **46.0%
recall at 100% adjusted precision, ~$2.24 per run**. Split by where the defect
lives: **66.7% for defects inside the diff, 0 of 27 for defects elsewhere in a
changed file**. What it reports is almost always real; it does not find
everything, and it finds essentially nothing the change does not point at.

The three advisory stages have **no accuracy measurement at all**. Do not present
them as validated.

Consequences for how you set it up:

- It complements review; it does not replace it. Do not let anyone reduce human
  review because this is running.
- Because it finds what the change points at, **re-running after each round of
  fixes is worth more than any single-run tuning**. Wire it to run on every push
  to the branch, not just the first.
- A quiet report is the normal case, not a broken install.

## Step 1 — Check the ground

Before writing anything:

```bash
node --version          # must be >= 24.15.0
git rev-parse --git-dir # must be a git repository
```

Confirm you are at the **repository root**. The CLI reviews `process.cwd()` and
has no `--repo` flag; config, `.env`, the baseline, and all artifacts resolve
under it.

Then decide how the CLI will be invoked. The package is `"private": true` and
unpublished, so there is no `npm install -g` and no `npx`. Two options:

- **A** — the target repo *is* the engine checkout: `npm run cli -- <args>`.
- **B** — separate repos: build the engine once (`npm run build`) and invoke
  `node <engine>/dist/cli/main.js <args>` with the target repo as the working
  directory.

Most setups are B. Confirm which one applies before writing CI, because the
invocation line differs.

## Step 2 — Pick a provider

Ask which one the organisation already has credentials and an approval path for.
Do not pick on model quality — pick on what they can legally send code to.

| `provider.id` | Install | Credentials read from |
| --- | --- | --- |
| `openai` | `@purista/harness-openai` | `OPENAI_API_KEY` |
| `openai-compatible` | `@purista/harness-openai` | `OPENAI_API_KEY` + a required `provider.baseUrl` |
| `bedrock` | `@purista/harness-bedrock` | `AWS_REGION` + the AWS credential chain |
| `azure` | `@purista/harness-azure-foundry` | `AZURE_AI_ENDPOINT`, `AZURE_AI_API_KEY` |

Only the adapter for the configured provider is imported, so install exactly one.
`openai-compatible` must implement the OpenAI **Responses** API — a chat-completions
gateway will fail on the first call.

`provider.model` is free text and is never validated against a catalogue. A wrong
name surfaces as a provider error on the first call, which is one reason step 4
exists.

## Step 3 — Write the smallest config that works

Naming a provider and a model is enough. Everything else has a measured default.

```json
{
  "provider": {
    "id": "openai",
    "model": "<model-name>"
  }
}
```

Write that to `.codereviewer/config.json` and stop. Resist adding keys.

Two things you must **not** do here:

- **Do not put credentials in the config file.** They are read from the
  environment by the adapter. Add `.env` to `.gitignore` if you create one.
- **Do not pre-tune.** Every default in this engine was set by measurement, and
  several were measured *against* the intuitive value. A limit you set because it
  felt safe is a limit that will degrade the answer silently.

If you need to justify a key beyond those two, read
[references/config-recipes.md](references/config-recipes.md) — it lists the small
set of keys that are legitimately project-specific (mostly `paths.exclude`) and
the ones people reach for wrongly.

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
git stash list >/dev/null            # ensure you are on a branch with a diff
codereviewer review --base-ref <base> --head-ref HEAD
```

…with the `provider` block temporarily removed (or before you add it). Without a
provider the run does intake, deterministic signals, planning, admission,
reporting and the gate — everything but model discovery. It costs nothing.

Check three things in the output:

1. Exit code `0` and a `runId` on stdout.
2. `report.md` → **Coverage** shows the file count you expected.
3. `report.md` → **Skipped Files** contains nothing surprising.

If the file count is wrong, fix `paths.include` / `paths.exclude` now. Discovering
it after a paid run is the same information for money.

Common failure here: `merge_base_unavailable` (exit `3`) — a shallow clone.
Full history is mandatory; there is no fallback, deliberately.

## Step 5 — Run it for real, once, and read the report

Restore the provider block, set the credential in the environment, and run the
same command. Then **actually read `report.md`** with the user. This is the step
people skip and the reason gates get enabled badly.

Point them at the sections in this order:

- **Actionable Findings** — what it wants them to act on.
- **Unresolved – Needs Human Decision** — suspicions the engine could not settle.
  Excluded from the gate on purpose. A team that never reads this section gets the
  strict half of a precision-first design without the compensating half.
- **Rejected Candidates** — where the volume went, if the report feels thin.
- **Cost And Timing** — what the run actually cost.

Ask them one question: *would you have wanted these comments on your PR?* If the
answer is no, tune before you gate — see
[references/tuning-decisions.md](references/tuning-decisions.md). If the answer is
yes, continue.

## Step 6 — Take a baseline before the gate blocks anything

The default gate is strict: `maxCritical: 0`, `maxHigh: 0`. On any repository with
existing debt that fails immediately and for reasons nobody on the team caused.

Run a review on the default branch, then:

```bash
codereviewer baseline write
```

It reads the newest completed report and writes the fingerprints of its admitted
findings to `.codereviewer/baseline.json`. Commit that file. With
`baseline.failOnNewOnly` (default `true`), only findings that are `new` or
`unknown` can fail the gate.

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
| `2` | Configuration or usage error |
| `3` | Repository / filesystem error (usually a shallow clone) |
| `4` | Provider error |
| `5` | Internal error |

Set a cost tripwire while it is advisory, so a pathological change fails loudly
rather than quietly spending:

```json
{ "review": { "maxCostUsd": 5 } }
```

It is checked *after* the run completes — a tripwire, not a mid-run brake.

## Step 8 — Promote to a required check

Only after the team has seen a week of runs and agrees the findings are worth
acting on:

- Make the job a **required status check** so exit `1` blocks the merge instead of
  posting an advisory comment somebody scrolls past.
- Keep re-running on every push to the branch. Each round of fixes moves the diff,
  which moves what the reviewer is pointed at.
- Keep the baseline current on the default branch.

If the team is not ready to block, leave it advisory. An ignored red check is
worse than an honest advisory one.

## Step 9 — Advisory stages, later or never

Add these only once `review` is trusted, one at a time, and tell the user plainly
that **none of them has an accuracy measurement**:

| Stage | Enable with | Cost |
| --- | --- | --- |
| `impact check` | `changeImpact.enabled` | Free — no provider call |
| `conformance check` | `invariantConformance.enabled` | Free unless `adjudication.enabled` |
| `intent check` | `intentFulfilment.enabled` **and** a `contextSources` provider | ~1 call per obligation |

`intent check` reports nothing useful without a configured change-intent source —
it will exit `0` with a `no-intent` status and a warning saying so. Wire the
pipeline to write the ticket/PR body into `.codereviewer/context/` first.

None of the three can fail a pipeline. That is a spec requirement, not a default,
and there is no `blocking` key to find.

## Things not to do

- **Do not enable a gate you have not watched run.** The whole point of steps 4–8.
- **Do not turn on optional passes to "improve recall".** Several were built,
  measured, and shipped off *because* they did not help. If you want to change one,
  measure it — a single run that looks better is not a result.
- **Do not set byte caps, obligation caps, or line caps to be safe.** Every one of
  them degrades the answer silently when it binds. They are runaway guards, not
  rations.
- **Do not add a whole-run timeout.** There is deliberately none;
  `provider.timeoutMs` bounds a single call and that is the only time bound.
- **Do not commit `.env`.** The loader reads it *after* the process environment, so
  a stray `.env` in a CI image silently overrides the real secrets.
- **Do not claim this replaces human review, a linter, a type checker, or SAST.**
  It assumes those already run.

## Finishing

Report back to the user with: which provider was configured, the exact config file
written, whether a baseline was taken, whether CI is advisory or blocking, what the
first real run cost, and what it found. If any step was skipped, say which and why.
