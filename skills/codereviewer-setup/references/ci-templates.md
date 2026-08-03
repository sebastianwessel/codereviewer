# CI templates

Start every one of these **advisory**: let the job report and upload artifacts,
but do not fail the build on exit `1` until the team has watched a week of real
pull requests. Each template marks the single line to change when you promote it.

Three facts shape all of them:

1. **The package is unpublished.** It is publishable — the metadata is complete
   and it declares a `codereviewer` bin — but no version is on the registry, so
   there is no `npm install -g` and no `npx` form. Every job checks out the
   engine and runs it from source.
2. **The engine reviews the current working directory.** Artifacts land under
   `<cwd>/.codereviewer/runs/<runId>/`.
3. **Full history is mandatory.** The engine resolves
   `git merge-base <base> <head>` and refuses to fall back to a direct diff,
   because that would report unrelated base-branch commits as your change. A
   shallow clone fails with `merge_base_unavailable`, exit `3`.

## GitHub Actions — engine in a separate repository (the common case)

```yaml
name: code-review
on:
  pull_request:

permissions:
  contents: read

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - name: Check out the project under review
        uses: actions/checkout@v4
        with:
          fetch-depth: 0
          path: project

      - name: Check out the review engine
        uses: actions/checkout@v4
        with:
          repository: <org>/codereviewer
          ref: <pinned-sha>
          path: engine

      - uses: actions/setup-node@v4
        with:
          node-version-file: engine/.nvmrc

      - name: Build the engine
        run: |
          npm --prefix engine ci
          npm --prefix engine run provider:install:openai
          npm --prefix engine run build

      - name: Review
        working-directory: project
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
        # Advisory: report but never fail the build. Delete this line to promote.
        continue-on-error: true
        run: node "$GITHUB_WORKSPACE/engine/dist/cli/main.js" review --base-ref "origin/${{ github.base_ref }}" --head-ref HEAD

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: codereviewer-run
          path: project/.codereviewer/runs/
```

Promote by deleting `continue-on-error: true` and making the job a **required
status check** in branch protection.

### If the engine repository *is* the project

Everything collapses to one checkout and the repo's own script:

```yaml
      - run: npm ci
      - run: npm run provider:install:openai
      - run: npm run cli -- review --base-ref "origin/${{ github.base_ref }}" --head-ref HEAD
```

### Security notes that actually matter here

- Run on `pull_request`, which checks out the merge ref **without** repository
  secrets for fork pull requests. Do **not** switch to `pull_request_target` and
  then check out untrusted head code — that runs fork code with your secrets.
- Pull-request titles and bodies are attacker-controlled. Pass them through `env:`
  rather than interpolating `${{ ... }}` into a `run:` script, which would let a
  crafted title execute shell on the runner.
- Keep `permissions` minimal at the workflow level and widen per job. Publish
  comments in a **separate** job with its own token scope, not in the job that
  runs the model.
- Pin third-party actions and the engine checkout by commit SHA.
- Prefer OIDC over long-lived cloud keys for the Bedrock provider.
- Never bake a `.env` into a CI image. The loader reads it **after** the process
  environment, so it silently overrides the secrets the job injected.

### Uploading SARIF to code scanning

Add `security-events: write` to the job's permissions and set
`reporting.sarif.target` to `github` in the config — that target enforces
GitHub's partial-fingerprint requirement and rule-count limit.

```yaml
      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: project/.codereviewer/runs
          category: codereviewer
```

## GitLab CI

```yaml
stages: [review]

code-review:
  stage: review
  image: node:24
  variables:
    GIT_DEPTH: 0
  # Advisory: report but never fail the pipeline. Delete to promote.
  allow_failure: true
  before_script:
    - npm ci
    - npm run provider:install:openai
  script:
    - npm run cli -- review --base-ref "origin/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME" --head-ref HEAD
  artifacts:
    when: always
    paths:
      - .codereviewer/runs/
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
```

Mask `OPENAI_API_KEY` as a protected, masked CI variable so it is not exposed to
pipelines on unprotected branches. `GITLAB_CI` is set by the runner, so
`reporting.reviewComments.platform: "auto"` resolves to `gitlab`.

## Bitbucket Pipelines

```yaml
image: node:24

pipelines:
  pull-requests:
    '**':
      - step:
          name: Code review
          caches: [node]
          script:
            - git fetch --unshallow || true
            - git fetch origin "$BITBUCKET_PR_DESTINATION_BRANCH"
            - npm ci
            - npm run provider:install:openai
            # Advisory: swallow the exit code. Remove `|| true` to promote.
            - npm run cli -- review --base-ref "origin/$BITBUCKET_PR_DESTINATION_BRANCH" --head-ref HEAD || true
          artifacts:
            - .codereviewer/runs/**
```

Bitbucket clones shallow by default, so both `git fetch` lines are required for
`merge-base` to resolve.

## Supplying change intent (optional, and required for `intent check`)

The engine never calls a tracker or forge API: the pipeline fetches the context
and writes it to disk, so it owns the credentials and the engine holds none.

```yaml
      - name: Supply change intent
        working-directory: project
        env:
          PR_NUMBER: ${{ github.event.number }}
          PR_TITLE: ${{ github.event.pull_request.title }}
          PR_BODY: ${{ github.event.pull_request.body }}
        run: |
          mkdir -p .codereviewer/context
          printf -- '---\nid: %s\ntitle: %s\nsource: pull-request\n---\n%s\n' \
            "$PR_NUMBER" "$PR_TITLE" "$PR_BODY" \
            > .codereviewer/context/pull-request.md
```

Frontmatter is optional; `id`, `title` and `source` are read. Enable it with
`contextSources` (see config-recipes.md).

## Adding the two advisory stages (optional, and only after `review` is trusted)

Run them as their own steps. Both always exit `0`, so no `continue-on-error` is
needed and none should be added — a step that reads their JSON and exits non-zero
would reintroduce a gate the measurement says is not accurate enough to gate on.

```yaml
      - name: Impact (deterministic, free)
        working-directory: project
        run: node "$GITHUB_WORKSPACE/engine/dist/cli/main.js" impact check --base-ref "origin/${{ github.base_ref }}" --head-ref HEAD --format markdown >> "$GITHUB_STEP_SUMMARY"

      - name: Intent (needs contextSources and a provider)
        working-directory: project
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
        run: node "$GITHUB_WORKSPACE/engine/dist/cli/main.js" intent check --base-ref "origin/${{ github.base_ref }}" --head-ref HEAD --format markdown >> "$GITHUB_STEP_SUMMARY"
```

Both accept only `--config`, `--base-ref`, `--head-ref` and
`--format json|markdown` beyond the global options, and both require the literal
subcommand `check`. Default stdout is one JSON document, so an existing script
that parses it keeps working; `--format markdown` puts the rendered report there
instead. A **completed** run also writes `impact-report.{md,json}` /
`intent-report.{md,json}` into an `impact-<uuid>` / `intent-<uuid>` directory
under `paths.artifactDir`, and prints that path to **stderr**. Those directories
are not in the run index, so `baseline write` never picks one up.

A run that mapped nothing writes nothing at all — `disabled` for impact;
`disabled`, `no-intent`, `unusable-intent` or `provider-unavailable` for intent.
`no-intent` is the ordinary outcome when the pipeline supplied no change intent.

## What to keep from a run

Upload the whole `.codereviewer/runs/` directory, always — it is the audit trail.
`report.json` (the full record, including rejected findings), `report.md`,
`report.sarif`, `run-summary.json` (timings, tokens, cost, warnings),
`context-ledger.json` (exactly what was considered for provider transfer),
`shared-context.json`, `observability.json`, and `error.json` on a failed run.

Treat these as sensitive: they are redacted by default, but they describe the
source.

## Branching on the result

Branch on the exit code, never on parsing stdout.

| Code | Response |
| --- | --- |
| `0` | Publish artifacts, continue |
| `1` | A gate failed — publish artifacts, then fail (once promoted) |
| `2` | Configuration or usage error — fail fast |
| `3` | Repository error, usually a shallow checkout |
| `4` | Provider error — fail or retry the job |
| `5` | Internal invariant violation — fail, and file a bug with `error.json`. Includes `quality_gate_missing`, a completed run whose report carried no gate result: an absent gate is an error, never a silent pass. |

On success stdout is a single JSON object:

```json
{ "runId": "…", "qualityGatePassed": true, "artifactDir": ".codereviewer/runs/<runId>" }
```

On failure stderr carries `{ "code": …, "message": … }`, plus `artifactDir` when
partial artifacts were written.
