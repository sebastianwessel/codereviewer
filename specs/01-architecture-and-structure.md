# 01: Architecture And Structure

Status: Approved
Date: 2026-07-31

## Topology

`R1` is a modular TypeScript CLI package. It has one process, no database, no
remote server, and no background daemon. Async work runs inside one CLI run and
terminates before process exit.

## Runtime Stack

| Layer | Contract |
| --- | --- |
| Runtime | Node.js `>=24.15.0`, ESM-only. |
| Package manager | npm with committed `package-lock.json`. |
| Language | TypeScript `NodeNext`, strict mode. |
| Orchestration | `@purista/harness` workflows and agents. |
| Validation | Zod schemas at external, workflow, agent, tool, and artifact boundaries. |
| Tests | Vitest with colocated `*.test.ts` files. |

## Domain Structure

Implementation must use nested domain folders under `src/`. Additional files
are allowed only inside the owning domain folder defined below. New top-level
domain folders require a spec update.

```text
src/
  index.ts
  cli/
    commands/
  platform/
    path-service.ts
    repository-path.ts
    repository-file-reader.ts
  domains/
    repository-intake/
    configuration/
    provider-resolution/
    deterministic-signals/
    review-planning/
    context-retrieval/
    context-ingestion/
    analyzer-ingestion/
    verification/
    change-impact/
    intent-fulfilment/
    shared-context/
    review-workflow/
      harness/
      pipeline/
        admission/
        discovery/
        refutation/
      run/
        context/
        intake/
        planning/
        provider/
        results/
        support/
    admission/
    reporting/
    evaluation/
      corpus/
      judging/
      scoring/
      report/
        versions/
      rendering/
        comparison/
      run/
      change-impact-eval/
      intent-eval/
    costs/
    observability/
    drift/
  shared/
    contracts/
    errors/
    glob/
    hash/
    json/
    redaction/
    schema/
    testing/
    text/
```

`shared/testing/` holds assertions a spec requires more than one domain to
satisfy. It is compiled out of the published build (`tsconfig.build.json`
excludes it) because nothing at runtime may import it.

`cli/commands/` holds one module per dispatchable command, named after the
command it implements (`eval-run.ts` for `eval run`, `impact-check.ts` for
`impact check`). A command owns its option set, its error classification and its
exit code, and no command imports another. What more than one command shares —
the `CliResult`/`CliRunOptions` contract, error-to-exit-code mapping,
configuration loading, logger construction, and the advisory `check` skeleton —
stays in `cli/` beside `commands/`, so the dependency direction is one way:
`index.ts` → `commands/*` → `cli/*`.

`evaluation/` is grouped by what a module is FOR, not by the artifact it ends up
in: `corpus/` defines and hydrates the cases, `judging/` holds the model-backed
judges and their calibration, `scoring/` turns matches into numbers, `report/`
owns the artifact contracts and provenance (`report/versions/` the
metrics-version comparability rules), `rendering/` the Markdown surfaces
(`rendering/comparison/` the `eval compare` ones), and `run/` the runner — the
corpus runner, the per-case runner it drives, and the committed capability pin
set a measured run is held to. `eval-warnings.ts` stays at the domain root
because `run/`, `scoring/` and `index.ts` all read it.

`run/eval-case-runner.ts` is the one module in this domain that must NOT appear
on `evaluation/index.ts`. It imports `review-workflow`, whose preflight imports
`drift`, whose artifact-example checker imports this barrel for the eval corpus
contracts — so a barrel entry closes an import cycle. Its only consumer,
`src/cli/commands/eval-run.ts`, imports it by module path instead; the CLI is
the composition layer, not a sibling domain, so no domain reaches past a barrel.

`evaluation/change-impact-eval/` and `evaluation/intent-eval/` are the groups
defined by their CORPUS rather than by their role, and that is deliberate. Spec
22's change-impact review and spec 23's intent-fulfilment review are each scored
against a different corpus with a different answer key from the diff reviewer's,
and none of the three may be pooled or run with another's
`--slice-root`/`--manifest`. Distributing these modules by technical role would
file each one next to its diff-reviewer counterpart — corpus schema beside
corpus schema, scoring beside scoring — which is precisely the adjacency the
separation exists to prevent. Keep them together. Do not "tidy" them back into
the role folders.

Each group also owns the per-case runner that drives its lane
(`impact-eval-runner.ts`, `intent-eval-runner.ts`), moved here from `src/cli/` on
2026-08-14. They had been extracted out of the command handlers to keep those
thin, but extracted SIDEWAYS into the CLI rather than into the domain that owns
the measurement, which left roughly two thousand lines of domain orchestration
under `src/cli/`.

## Ownership Rules

| Domain | Owns | Must Not Own |
| --- | --- | --- |
| `platform` | OS/path/runtime helpers. | Product policy, model calls, report rendering. |
| `repository-intake` | Git refs, changed files, file snapshots, diff maps. | Provider resolution, admission, report formatting. |
| `configuration` | Config discovery, parsing, defaults, merge order, validation. | Provider SDK imports, workflow execution. |
| `provider-resolution` | Optional adapter package names, runtime loading, provider setup errors. | Model prompts, review policy, support-signal logic. |
| `deterministic-signals` | Cheap local facts used for changed-line anchoring, symbol spans, import/test hints, scope validation, de-duplication, known-noisy contradiction checks, and optional external-tool metadata summaries. | Primary issue discovery, replacement CodeQL/linter/build/test behavior, admission decisions, provider calls, or report rendering. |
| `review-planning` | Review tasks and dependency-aware task grouping (change-unit clustering). | Model provider loading or publication. |
| `context-retrieval` | Read/list/grep-style repository context tools exposed through bounded mediation to refutation and (when skills are enabled) holistic review. | Shell execution, filesystem writes, network access, provider loading, or admission. |
| `context-ingestion` | External change-intent context providers (inbox, changed-files), fragment redaction, and the digest/model summarizers producing one bounded change-intent brief. | Admission decisions, gate authority, network beyond the configured provider endpoint, or reading outside the repository root. |
| `analyzer-ingestion` | Spec 15 Mechanism 2: reading SARIF 2.1.0 artifacts produced by an analyzer the operator already runs, normalizing them to a neutral alert shape (rule id, CWE, analyzer identity, locations), holding each alert against the run's changed ranges by changed-side attribution, and rendering the attributed remainder as evidence in a review task. Named apart from `context-ingestion` because the two ingest different things for different stages: `context-ingestion` brings in human intent, this brings in machine findings. | Detecting anything itself, seeding a candidate, admission or gate authority, provider calls, or writing to the repository. An alert is evidence a reviewer may weigh, never a finding. |
| `verification` | The agentic investigation flow: claim/verdict contracts, claim providers (claims-file, prior-findings, current-findings), the bounded `investigate_claim` agent using mediated read/list/grep, the fix lane's advisory `fixProposal` enrichment and its use of the deterministic apply-check, and corroboration matching. | Shell, network, filesystem writes, publishing, gate authority, changing the general review's discovery path, or **owning the apply-check itself** — the primitive moved to `shared/text/apply-fix-edits.ts` on 2026-08-11 when spec 13's comment layer began gating every suggestion with it, and two notions of "does this edit still fit the file" would be worse than one. |
| `change-impact` | Change-impact review (spec 22): the changed-symbol seed derived from support-signal facts intersected with diff hunks, bounded dependent discovery over those symbols, and its own report contract, admission, and metrics. | Filesystem or git access of its own, the diff reviewer's admission gate, quality-gate authority, report rendering for the diff review, or provider package loading. |
| `intent-fulfilment` | Intent-fulfilment review (spec 23): change-surface collection, obligation extraction from the stated intent, per-obligation judgement, judgement, the run explanation, and its own advisory report contract. | Filesystem or git access of its own, the diff reviewer's admission gate, quality-gate authority, report rendering for the diff review, or provider package loading. |
| `shared-context` | Run-local admitted facts/findings/evidence references. | Filesystem scanning or provider calls. |
| `review-workflow` | The public harness facade and the review runner: run-start state, preflight, source and planning state, context assembly, provider execution and failure classification, admission and completion state, baseline loading, cost and warning finalization. Also the model-facing stages it drives — holistic discovery, semantic finding merge, refutation, candidate conversion — with their packet shaping, agent instructions, and IO contracts. | Low-level git parsing, path normalization, artifact rendering, deterministic path authority, publication, provider package loading, or report rendering. |
| `admission` | Refutation-result validation, deterministic safety checks, promotion policy, and admitted/rejected decisions. | Candidate generation or output formatting. |
| `reporting` | JSON/Markdown/SARIF artifacts, run summary rendering, and platform-neutral review-comment drafts with their platform detection, per-platform renderers, and the apply-check that gates every offered suggestion (spec 13). | Admission decisions, provider calls, publishing, or writing to the repository — it reads current file bytes to run the apply-check and for nothing else. |
| `evaluation` | Focused eval report contracts, focused Markdown report rendering, golden fixtures, metrics, benchmark runner, quality scoring, semantic-judge scoring metadata, and provider issue visibility in eval artifacts. | Production admission logic. |
| `costs` | Token aggregation, the bundled model pricing snapshot, and cost calculation with its `cost-unavailable` warning. | Provider calls, admission decisions, or report rendering. |
| `observability` | Sanitized run logging and the optional OpenTelemetry setup. | Raw source, prompt text, model output, env vars, or secrets in any emitted signal. |
| `drift` | Deterministic checks for docs/specs/schema/security ambiguity and drift. | Provider calls, model judging, git mutations, or source writes. |
| `shared` | Reusable contracts/helpers used by 2+ domains: Zod contracts, the error taxonomy, glob matching, hashing, JSON values, the redactor, JSON Schema generation, cross-domain test assertions, and text/line utilities — including the deterministic fix-edit apply-check, which `verification` and `reporting` both ask the same question of. | Domain-specific orchestration. |

There is no `security` domain folder. Redaction is `shared/redaction`, the
permission model is the `security` configuration block plus the mediated
`context-retrieval` tool surface, and there is no safe-command policy because R1
executes no commands.

## Public Entrypoints

| Entrypoint | Path | Contract |
| --- | --- | --- |
| Library entry | `src/index.ts` | Re-export stable public types and runtime helpers by name. No wildcards, no side effects. See *Public Surface* below. |
| CLI entry | `src/cli/index.ts` | Dispatch a command line to one module in `src/cli/commands/`, which parses its own args, calls domain services, and maps errors to exit codes. Returns a `CliResult`; it never exits the process itself. |
| CLI binary | `src/cli/main.ts` | The `codereviewer` bin (`dist/cli/main.js`). Calls `runCli`, writes stdout/stderr, sets `process.exitCode`, and holds no other logic. |
| Specs | `specs/` | Source of truth until readiness approval and implementation. |
| User docs | `docs/` | Implemented behavior only. |

## Public Surface

The package's public API is the explicit list of named re-exports in
`src/index.ts`, plus `runCli` and its two types from `src/cli/index.ts`. There is
no other definition of it, and nothing else counts as published.

- `src/index.ts` must not contain `export *`. A wildcard makes the surface
  unenumerable, so nobody can say whether a change to a domain is breaking.
- A domain barrel (`src/domains/*/index.ts`) is an INTERNAL SEAM. It exists so a
  sibling domain can import a domain without reaching into its files, and its
  contents are decided by that need alone. Appearing on a barrel does not make a
  symbol public.
- Adding a symbol to `src/index.ts` is a deliberate act, reviewed as an addition
  to the public API. A symbol earns its place by being needed to type or load a
  configuration, to run a review, or to read, validate or render a report —
  including any type named in the signature of something already published,
  because a signature a caller cannot write down is not usable.
- Removing a symbol from `src/index.ts` is a breaking change and must be stated
  as one.

This separation is what makes barrel narrowing safe. Once the public surface is
stated independently of the barrels, removing an over-shared symbol from a domain
barrel is an internal refactor with no effect on consumers, and it can be
reviewed as one.

## Generated Outputs

| Output | Location | Committed |
| --- | --- | --- |
| Build output | `dist/` | No |
| Coverage | `coverage/` | No |
| Local run artifacts | `.codereviewer/runs/<run-id>/` | No |
| Hydrated eval slices | `.codereviewer/eval/` | No |
| Generated config schema | `schema/codereviewer-config.schema.json` | Yes |
| Generated contract copies | `specs/03-contracts/config.schema.json`, `specs/03-contracts/review-report.schema.json` | Yes |
| Golden eval datasets | `eval/fixtures/` | Yes when hand-authored |
| Eval benchmarks and corpora | `eval/benchmarks/`, `eval/corpora/` | Yes (manifests; slices are hydrated) |

## Shared Helper Policy

A helper must move to `src/shared/` only when at least two domains use it or a
spec identifies it as a stable cross-domain contract. Otherwise keep it inside
the owning domain.

## Dependency Direction

- Domains are allowed to depend on `platform` and `shared`.
- Domains must not import from sibling domain internals.
- Cross-domain access must use exported domain entrypoints.
- `shared` must not import from `domains`.
- Optional provider packages must only be imported by `provider-resolution`.
- `change-impact` must not import from `review-workflow`, and `review-workflow`
  must not import from it. It is reachable only from `src/cli/`.
- `intent-fulfilment` must not import from `review-workflow`, and
  `review-workflow` must not import from it. It is reachable only from
  `src/cli/`.
- `review-workflow` must not perform shell, git, network, or write operations,
  and every repository path it reads must first be resolved inside the
  repository root. See *Known Divergence* below on where that content is read.
### Known Divergence: Where Repository Content Is Read

The rule above is deliberately narrower than its predecessor, which required
model-facing review to obtain repository context *only* through
`context-retrieval`. That is not what the code does: `review-workflow` reads
source directly through `node:fs/promises` in its context-assembly modules —
task context, static context, and referenced definitions.

The safety half of the original intent **is** met. Every one of those reads
resolves its path inside the repository root first, and anything resolving
outside is skipped, so no unvalidated path reaches the filesystem. What is not
met is the layering half: retrieval policy lives in more than one place, so a
future change to how repository content is selected or bounded has several sites
to touch rather than one.

This is recorded as an unmet architectural goal rather than written out of the
spec, because consolidating those reads behind `context-retrieval` is a real
improvement that nobody has done, and deleting the requirement would erase the
reason to do it. It is not a security defect and should not be described as one.

### Known Divergence: The Evaluation Harness's Git Seam

The Ownership Rules give "Git refs" to `repository-intake` and grant
`evaluation` no git access. Two evaluation modules nevertheless shell out to
git: `evaluation/report/engine-identity.ts`, which stamps the engine's own
commit and working-tree cleanliness onto every eval report, and
`evaluation/corpus/git-corpus-plumbing.ts`, whose `CorpusGitCommandRunner`
checks out upstream corpus slices.

This paragraph said "two" while FOUR modules held a `child_process` import —
the three corpus hydrators had each grown their own copy of the runner, and the
divergence record silently understated itself as they multiplied. Consolidating
those copies on 2026-08-15 made the count true rather than adjusting the number
to match the drift. A divergence that is allowed to spread is a different
divergence from the one that was accepted, so the useful invariant is not the
number but this: **exactly one module per reason.** One engine-identity seam,
one corpus-checkout seam. A third `child_process` import inside `evaluation` is
a change to this decision and needs one, not a footnote here.

This is recorded rather than normalised, and it is not the same git.
`repository-intake` reads the repository **under review** at the refs a run was
pointed at. These two read the engine's **own** checkout and **upstream** corpus
repositories — neither is the subject of a review. Routing them through
`repository-intake` would widen that domain from "the repository we are
reviewing" to "any repository", a larger change to the ownership model than the
problem warrants.

What is owed is a decision, not a refactor: either grant `evaluation` a bounded
git seam in the Ownership Rules and say what it may and may not read, or name
another owner. Until then the divergence is not permission for other evaluation
modules to shell out; these two are the whole list.

- Deterministic signal extractors must be removable without changing core
  finding/report schemas. They can improve evidence quality but cannot be a
  required product-specific static-analysis tool for external CI-equivalent checks.

## N/A Layers

| Layer | R1 Status | Evidence |
| --- | --- | --- |
| Frontend/browser UI | N/A | R1 has CLI and local artifacts only. |
| Database/schema changes | N/A | R1 stores run artifacts on filesystem only. |
| Remote service topology | N/A | R1 has one local CLI process. |
| Authentication/session management | N/A | R1 uses local/CI credentials supplied by environment. |
