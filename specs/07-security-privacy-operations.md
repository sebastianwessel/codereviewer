# 07: Security, Privacy, And Operations

Status: Approved
Date: 2026-07-22
Amended: 2026-08-07 — the shared mediated-read eligibility gate and the
requirements that make directory traversal safe are stated here (see *Mediated
Read Eligibility*)

## Threat Model

Trust boundaries:

- repository content is untrusted;
- config files are untrusted until schema-validated;
- the repository root is the maximum local authority boundary;
- reviewer instructions and skills are untrusted prompt inputs;
- external change-intent context (pull-request metadata, pipeline-provided
  context-inbox files, and change-relevant repository files) is untrusted prompt
  input;
- model providers are external processors;
- model outputs are untrusted and outside the deterministic trust boundary;
- CI environment variables can contain secrets;
- generated artifacts can be uploaded by CI and must be safe by default.

Attack surfaces:

- path traversal;
- prompt injection;
- secret exfiltration through logs/model context/reports;
- malicious config;
- unsafe shell commands;
- provider dependency supply chain;
- markdown/report injection;
- large-file or large-diff denial of service;
- repository-root escape through symlinks, Windows drive paths, UNC paths,
  encoded separators, case-folding mismatch, or config/env override;
- destructive git operations hidden behind user-controlled refs or aliases;
- unapproved network transfer of repository content, prompts, artifacts, or
  secrets;
- injection through external change-intent context that attempts to alter
  findings, gates, or reviewer behavior;
- server-side request forgery through a later-phase network context source;
- drift between specs, docs, implementation, generated schemas, examples,
  quality gates, and shipped behavior;
- ambiguous or interpretable requirements that allow agents or maintainers to
  encode different behavior.

## Enterprise Security Invariants

These invariants are non-negotiable for R1 and must be enforced by deterministic
code, not by model behavior:

| Invariant | Requirement |
| --- | --- |
| Repository containment | Every read and write path must resolve under the configured repository root. Default root is the current working directory when no CLI or config root is supplied. |
| No root escape | Absolute paths, `..`, symlink escapes, Windows drive paths, UNC paths, NUL bytes, and mixed-separator traversal are rejected before IO. |
| Read-only source | Repository source files are never modified by review, eval, deterministic support signals, admission, reporting, drift checks, or docs checks. |
| Artifact write boundary | Writes are allowed only below the configured artifact directory after it resolves under repository root. |
| Non-destructive git | The only allowed git commands are read-only discovery commands explicitly allowlisted in code. Mutating git commands are impossible through the product API. |
| No shell expansion | Git and tool invocations use argument-array process APIs. Shell strings are forbidden. |
| No implicit network | Network is denied by default. The only network path is the explicitly selected model provider endpoint after provider config validation. Every model-backed stage uses that one path and no other: holistic discovery, the semantic finding merge, refutation, the change-intent summarizer, the fix and verification lanes, intent-fulfilment checking, and the evaluation match and plausibility judges. Change-intent context providers are filesystem-only in the current phase; later-phase network providers (`platform-API`, `mcp`) contact only explicitly configured, allowlisted endpoints and are the subject of dedicated controls below. No network path can be initiated by model output. |
| No repository exfiltration by default | Local providerless and signal-only paths must not send repository content to any network destination. Provider-backed review sends only bounded, redacted, ledger-recorded context to the selected provider. |
| No prompt/tool authority | Prompts, repository content, skills, and model output cannot grant filesystem, git, shell, network, publishing, or gate authority. |
| Auditable decisions | Security-relevant allow/deny decisions produce stable, redacted events and testable error codes. |

## Explicit Attacker Vectors And Required Controls

| Vector | Example | Required Control |
| --- | --- | --- |
| Config path escape | `--config ../../secret.json`, `CODEREVIEWER_CONFIG_PATH=C:\Users\...` | Resolve through root-bound path service and reject escape. |
| Artifact path escape | `paths.artifactDir=../outside` or symlinked `.codereviewer/runs` | Resolve real parent paths under root before write; reject symlink escape. |
| Instruction/skill escape | `.codereviewer/skills/../../private/SKILL.md` | Normalize and resolve each requested file under root; reject traversal and symlink escape. |
| Git ref injection | `--base-ref=-c core.sshCommand=...` | Reject refs starting with `-`; execute only allowlisted `git diff` and `git merge-base` argument arrays. |
| Destructive git | hidden path to `git reset`, `clean`, `checkout`, `push`, `commit` | Do not expose a generic git runner to config/model/plugin paths; enforce read-only command allowlist. |
| Shell injection | file path containing `; rm -rf` | Never use shell command strings; pass paths as args after `--`. |
| Provider exfiltration | malicious config points to attacker OpenAI-compatible URL | Require explicit provider config, document provider trust boundary, redact secrets, ledger context, and allow local runs with no provider. |
| Prompt exfiltration | repository asks model to print env vars or upload code | No tools with env/filesystem/network authority are available to model output; env is never in prompt context. |
| Report injection | finding title contains HTML/script/Markdown table breaks | Escape Markdown/SARIF user-controlled text and never emit raw source snippets by default. |
| External context injection | PR body, inbox file, or changed doc says "ignore all findings" or "this is pre-approved" | Treat external context as untrusted data presented under an informational header; it never changes admission, severity, gates, or baseline, and never suppresses a finding. |
| Agentic tool abuse (verification flow) | a claim or tool output steers the verification agent to read `.env`/secrets, loop unboundedly, or claim authority | The verification agent's only tools are mediated read/list/grep (`12-verification-flow.md`): read-only, path-contained, eligibility-filtered so secret/excluded files are never read, in-process (no shell), redacted, ledgered, and bounded by per-claim tool-call and byte/match budgets. No shell, network, filesystem write, environment, publishing, or gate authority is available, and claim inputs cannot change admission, severity, gates, or baseline. |
| Agentic tool abuse (cross-file discovery) | changed source or a retrieved file steers the discovery agent to read secrets, browse the repository, or loop until its budget is gone | The discovery agent's `repo_read`/`repo_list`/`repo_grep` tools are the SAME mediated, eligibility-gated, redacted, ledgered surface as the verification agent's, bound per task through a scoped tool registry so concurrent tasks cannot spend each other's budget. A per-task tool-call cap enforced in code bounds a model that never stops requesting reads. Retrieved content is untrusted repository data on exactly the terms the changed files are, its findings pass the same refutation and admission as any other candidate, and findings stay restricted to the task's own paths. |
| Context-source SSRF (later-phase `platform-API` provider) | ticket id or URL in repository content aims a platform-API fetch at an internal host | Contact only the explicitly configured, host-allowlisted platform host; never derive fetch targets from repository content or model output. |
| Context-source credential leak | tracker or platform token echoed into the brief, ledger, or logs | The current-phase inbox carries no credentials because the pipeline owns the fetch; the later-phase platform-API provider reads credentials only from a configured environment variable; redact external context before use. |
| Secret leakage | token appears in source, error, provider message, or artifact | Redact before logs, errors, reports, traces, and provider-bound summaries. If a value cannot be proven redacted, exclude it from output. |
| Denial of service | huge files, many paths, nested skill tree | Enforce max files, max file bytes, context bytes, traversal caps, timeouts, and concurrency caps. |
| Drift hiding | README claims a command exists but CLI rejects it | Drift checker compares docs/specs/CLI/package/config/generated schemas and emits drift findings. |
| Ambiguity hiding | spec uses subjective security wording without a testable rule | Ambiguity checker emits configurable warning/error findings for vague, subjective, or conflicting requirements. |

## Data Classification

| Data | Classification | Default Handling |
| --- | --- | --- |
| Source code | sensitive customer data | May be read locally; not logged/traced. |
| Prompts/instructions | sensitive | Sent only to the selected provider for configured model-backed tasks; not logged/traced. |
| External change-intent context | sensitive, untrusted | Redacted before use; summarized and injected only as a bounded context-only document; never logged/traced. |
| Secrets/tokens | secret | Redacted before model/log/report. |
| Evidence summaries | internal | Redacted and safe for report. |
| Run metadata | internal | Safe for report after redaction. |
| Cost/timing metrics | operational | Safe for logs/report. |

## Redaction

Redactor must run before:

- logs;
- errors;
- traces;
- report rendering;
- model-bound context assembly where configured secret patterns are available;
- **the reviewed diff, at intake** — the single point it enters a run
  (`run/intake/repository-input.ts`), not at each consumer. Named explicitly
  because it was the one path that did NOT redact until 2026-08-11: every changed
  file's content was redacted before it could reach a packet and the diff was not,
  so a credential committed inside a changed hunk went to the provider verbatim
  while the identical string in the surrounding file body came out `[REDACTED]`.
  Redacting at the source also keeps the context ledger honest, since the ledger
  measures that same string;
- ingestion of external change-intent context, before it enters the summarizer
  call, the prompt, or the context ledger.

Minimum secret patterns:

- bearer/basic auth headers;
- OpenAI-style `sk-` keys;
- GitHub PAT formats;
- GitLab token formats;
- AWS access key IDs;
- user-configured exact secret values.

Tests must prove known tokens are removed from logs and reports.

## Prompt Injection And Model Boundary

Prompt injection cannot be fully prevented for arbitrary untrusted repository
content. R1 controls the blast radius:

- repository content, instructions, skills, prior artifacts, provider
  responses, and external change-intent context are untrusted input;
- external change-intent context is presented under an informational header and
  cannot change admission, severity, gates, or baseline outcomes;
- model output can propose candidate findings and refutation summaries
  only; it cannot publish, fail gates, write outside the artifact directory,
  execute commands, or read additional files without deterministic
  context-retrieval mediation;
- admission, reporting, quality gates, path handling, and permission decisions
  are deterministic code paths;
- instruction files and skills are loaded from the checked-out repository only
  in R1 and their hashes are recorded;
- high-impact actions such as PR publishing, fix application, shell execution,
  broad network access, and workflow edits require future specs.

## Permissions

Default permissions:

| Capability | Default | R1 Behavior |
| --- | --- | --- |
| Repository read | allowed | Required. |
| Filesystem write | restricted | Only run artifact directory. |
| Shell execution | denied | Future spec required. |
| Network | provider only | Selected provider adapter, used by every model-backed stage listed in the "No implicit network" invariant above. Change-intent context providers are filesystem-only; a network `platform-API` provider is a later phase (`11-external-context-ingestion.md`). |
| PR publishing | denied | Future spec required. |
| Fix application | denied | Future spec required. |

Permission flags are deny-by-default capability declarations, not automatic
grants. Setting `security.allowShell`, `security.allowNetwork`, or
`security.allowFilesystemWrite` to `true` is rejected in R1 except for the
provider network path explicitly defined by provider configuration.

## Repository Root And Path Containment

- Default repository root is `process.cwd()` at CLI entry.
- CLI-supplied root, config path, artifact path, baseline path, instruction
  paths, skill paths, eval fixture paths, and explicit review files must resolve
  under the repository root before IO.
- Path validation must be done with Node path APIs for POSIX and Windows forms.
- The path service must reject NUL bytes, empty paths, absolute paths, drive
  letters, UNC paths, traversal segments, and paths that resolve outside root.
- For write destinations, the implementation must resolve existing parent
  directories with `realpath` when present to prevent symlink escape.
- Public reports must use repository-relative portable paths only.

## Mediated Read Eligibility

Every mediated `read`/`list`/`grep` call — the verification and fix lanes
(`12-verification-flow.md`), cross-file discovery
(`16-agentic-cross-file-discovery.md`), change impact
(`22-change-impact-review.md`), intent fulfilment
(`23-intent-fulfilment-review.md`) — passes ONE shared eligibility gate, in this
order:

1. A hard floor no configuration can widen: any dotfile or hidden path segment,
   plus `node_modules` and `dist` matched case-insensitively anywhere in the
   path.
2. `paths.exclude`.
3. `paths.include`.

The include layer scopes FILES: a directory is eligible for TRAVERSAL when an
included file could live beneath it, as defined under *Paths* in
`04-configuration-and-providers.md`. That is the only relaxation in this gate,
and these requirements are what make it safe. They are load-bearing; the
relaxation is not permitted without them.

- The relaxation is for DIRECTORIES only. Any path served as a file — a `read`,
  a `grep` root that turns out to be a file, a file a traversal opened — MUST be
  gated against the file rule.
- Every entry a traversal yields MUST be gated individually before it is opened
  or reported: a directory listing MUST drop the entries the gate rejects, and a
  recursive search MUST gate each child before descending into it or reading it.
  A traversable directory therefore grants access to nothing inside it.
- Layers 1 and 2 are unchanged and are still evaluated first, so a directory the
  hard floor or `paths.exclude` rejects is never traversed, whatever could live
  beneath it.
- A path eligible ONLY under the directory rule that is not in fact a directory
  MUST be refused as ineligible, and that refusal MUST be indistinguishable from
  the one a path that does not exist receives. Eligibility is otherwise decided
  from the path alone, before existence, precisely so that a refusal cannot be
  used to probe for a file the include list does not cover; this is the single
  check that has to consult the filesystem, so answering its two outcomes
  differently would reintroduce that probe.

## Git Safety

The product must not provide a generic git execution surface.

Allowed R1 git commands:

| Purpose | Command Shape |
| --- | --- |
| Divergence point | `git merge-base <baseRef> <headRef>` |
| Changed path discovery | `git diff --name-status <mergeBase> <headRef>` |
| Diff hunk map | `git diff --unified=0 <mergeBase> <headRef> -- <paths...>` |

Rules:

- No `git reset`, `clean`, `checkout`, `switch`, `restore`, `commit`, `push`,
  `pull`, `fetch`, `merge`, `rebase`, `tag`, `worktree`, `submodule`, `config`,
  `remote`, `gc`, `maintenance`, or hook execution is allowed. `merge-base` is
  allowed and is a distinct read-only subcommand from `merge`; it resolves a
  commit id and never mutates the repository, index, or working tree.
- The allowlist matches on exact argument-array shape, not on a command prefix,
  so no additional flags can be appended to an allowlisted invocation.
- Git refs must be non-empty and must not start with `-`.
- File paths passed to git must be repository-relative portable paths validated
  by path service and placed after `--`.
- Git is executed with `execFile` or equivalent argument-array API, never
  through a shell.
- Git errors are normalized and redacted; raw command output is not logged.

## Network And Provider Exfiltration Controls

Network is off unless a provider-backed review is explicitly configured.

External context source requirements (`11-external-context-ingestion.md`):

- context providers are off by default; enabling them is an explicit
  configuration choice;
- the current-phase providers (`inbox`, `changed-files`) are filesystem-only
  under the repository root: the pipeline performs any external fetch and owns
  its credentials, so no external credential enters the product;
- gathered context is redacted and bounded before it enters the summarizer, the
  prompt, or the context ledger;
- required controls for the later-phase network `platform-API` provider: it
  contacts only its explicitly configured, host-allowlisted host; fetch targets
  are never derived from repository content or model output; and its credentials
  are read only from a configured environment variable name, never placed in
  config, prompts, ledger entries, or logs;
- required controls for the later-phase `mcp` provider: the MCP client is hosted
  in the orchestrator and driven deterministically, never by model output; its
  server (an operator-configured stdio command or allowlisted HTTP endpoint) and
  its tool-name allowlist come only from configuration; it invokes only
  allowlisted tools and MCP resources; the server endpoint or launch command is
  never derived from repository content or model output; credentials are read
  only from a configured environment variable name, and a stdio server that owns
  its own credentials keeps them out of the product. Launching an operator-
  configured subprocess for a stdio MCP server is a deliberate exception to the
  no-subprocess posture, permitted only for this explicitly configured server.

Provider-backed review requirements:

- selected provider ID and model must be explicit;
- OpenAI-compatible `baseUrl` must be explicit and must be displayed in
  redacted config summary by host only, never with credentials;
- only bounded context selected by deterministic planning can be sent;
- every context item considered for provider transfer must have a context
  ledger entry recording include/skip/truncate decision, bytes, hash, and
  reason;
- deterministic support signals may be used without requiring the model to echo
  them back, but they are context/gate inputs rather than the primary semantic
  review product;
- raw env vars, local absolute paths, git remotes, shell output, secrets, and
  ignored files are never provider context;
- refutation and holistic-review context tools must be mediated by deterministic
  code that enforces path containment, read/search budgets, redaction, and context
  ledger entries before any result reaches the model;
- provider raw responses are parsed through schemas, redacted on error, and not
  stored by default.

Local signal-only, hermetic provider fixture, config validation, drift checking, report
rendering, and eval metric operations must not perform network IO.

## Drift, Gap, And Ambiguity Control

The product must detect definition drift as a first-class quality surface.

Drift categories:

| Category | Meaning | Default Gate |
| --- | --- | --- |
| `documentation-drift` | User docs claim behavior not present in CLI/config/schema or omit implemented public behavior. | warning |
| `spec-drift` | Specs conflict with generated schemas, package commands, source contracts, plans, or each other. | warning |
| `implementation-drift` | Implementation behavior differs from approved specs. | warning |
| `generated-artifact-drift` | Generated schemas or snapshots are stale against source. | error |
| `ambiguity` | Requirement uses unclear, subjective, conflicting, or non-testable language. | warning |
| `security-drift` | Security-sensitive docs/specs/code disagree on permissions, paths, provider/network behavior, telemetry, or secrets. | error |

Rules:

- Drift and ambiguity findings are deterministic findings, not model-only
  opinions.
- Each finding must include category, severity, location, evidence summary,
  expected source of truth, observed conflicting source, and recommended owner.
- The default ambiguity behavior is non-blocking warning.
- Users may configure drift categories as hard errors or warnings.
- CI mode must be able to fail on configured hard-error categories.
- Drift checks must never send repository content to a provider.

## Reviewer Instructions And Skills Security

- Instruction and skill paths must resolve under repository root unless a
  future spec defines external trust roots.
- Skill directory traversal is rejected.
- Enabled R1 skills are mounted only from configured repository-local
  directories through the harness skill registry.
- Mounted skills expose only `read`, `list`, and `grep` by default; shell,
  write, edit, network, and publish tools remain unavailable.
- Skill tools and the mediated repository tools are distinct surfaces and must
  not be conflated. Skill tools are the harness builtins scoped to the mounted
  skill directories; the mediated `repo_read`/`repo_list`/`repo_grep` tools are
  in-process handlers that route every call through the context retriever. The
  tool ids are prefixed so they cannot collide with a harness builtin name, which
  would otherwise silently route a call to the unmediated builtin.
- Raw skill content is not inlined into workflow input, reports, logs, traces, or
  shared-context artifacts.

## Markdown And Report Safety

- Markdown reports must escape or fence user-controlled strings where needed.
- HTML reports are out of scope in R1.
- Report filenames must be fixed names, not derived from finding titles.
- Artifact paths must be created through `path-service`.
- Partial failure `error.json` artifacts must contain only normalized, redacted
  fields. Failed task messages in `shared-context.json` must use stable
  sanitized strings and must not include raw provider messages or tool output.
- SARIF reports must be treated as sensitive and untrusted generated artifacts:
  no embedded source text, local absolute paths, command lines, environment
  variables, user names, machine names, or unsanitized Markdown/HTML.

## Observability

Run logs:

- include run ID, step names, timings, counts, and error codes;
- are configurable through `observability.logging.level`,
  `CODEREVIEWER_LOG_LEVEL`, `--log-level`, or `--debug`;
- exclude raw source, prompt text, model raw responses, request/response
  bodies, provider headers, environment values, tokens, and secrets.

Optional traces:

- disabled unless configured;
- no content capture in R1;
- include only IDs, durations, counts, provider ID, model name, and redacted
  error code.
- enabled by providing OpenTelemetry endpoint and credentials through config or
  environment variables;
- exporter dependencies are optional and loaded only when telemetry is enabled.

## Incident And Recovery

If a secret leak is detected in an artifact:

1. Treat run artifacts as compromised.
2. Delete local run artifact directory.
3. Rotate affected credentials outside the tool.
4. Add regression fixture to redaction tests.

The tool must not attempt automatic credential revocation.

## Operations

R1 operations are local/CI only:

- no liveness/readiness endpoints;
- no dashboards;
- no alerts;
- no persistent service state.

Operational artifacts, all written under the configured artifact directory:

Per review run, in `<artifactDir>/<runId>/`:

- `report.json`;
- `report.md` when the Markdown format is enabled;
- `report.sarif` when the SARIF format is enabled;
- `review-comments.json` and `review-comments.<platform>.json` when
  `reporting.reviewComments.enabled`;
- `run-summary.json`;
- `context-ledger.json`;
- `shared-context.json`;
- `observability.json`;
- `fix-report.json` when the fix lane produced one;
- `verification-report.json` when the verification flow ran;
- `error.json` for partial failed runs.

Per artifact directory:

- `index.json`, the run index.

Evaluation artifacts, written to `.codereviewer/eval/` and again under
`.codereviewer/eval/runs/<run-id>/`:

- `eval-report.json`;
- `eval-summary.md`;
- `eval-recall-report.md`.

A completed `codereviewer impact check` writes one run directory,
`<artifactDir>/impact-<uuid>/`, containing `impact-report.md` and
`impact-report.json` (spec 22 requires the rendered report to land beside
`report.md` rather than only on stdout). A disabled run writes nothing.

A completed `codereviewer intent check` writes one run directory,
`<artifactDir>/intent-<uuid>/`, containing `intent-report.md` and
`intent-report.json`, for the same reason the impact one does: the report has to
land beside `report.md` rather than only on stdout. Every non-completed outcome
(`disabled`, `no-intent`, `provider-unavailable`, and the other statuses that
mapped nothing) writes nothing.

Neither the impact nor the intent run directory is recorded in the run index:
the index feeds baseline resolution, which expects a review report, and an entry
pointing at a reference or mapping report would hand `baseline write` a document
of the wrong shape.

`codereviewer config validate`, `eval compare`, `eval recall-report`,
`eval slice-manifest`, and `drift check` write no artifacts and print to stdout
only.

Default artifact root is `.codereviewer/`. Generated artifacts are ignored by git.
User-authored `.codereviewer/config.json`, `.codereviewer/instructions/`, and
`.codereviewer/skills/` may be committed when they do not contain secrets.

## CI/CD Hardening

Future hosted CI examples and templates must use secure defaults:

- least-privilege repository token permissions;
- no secrets exposed to untrusted fork pull requests;
- no checkout or execution of untrusted code in privileged
  `pull_request_target`-style contexts;
- actions pinned by commit SHA in release templates;
- OpenID Connect for cloud credentials instead of long-lived static keys where
  supported;
- ephemeral runners or cleaned workspaces for sensitive runs;
- separate review/report generation from publishing permissions.

R1 must document these constraints before any CI template is shipped.

## Standards Map

The security model follows these external references as requirements inputs:

- OWASP Top 10 for LLM Applications 2025 for prompt injection and agent/tool
  misuse controls;
- NIST Secure Software Development Framework SP 800-218 for development and
  release process controls;
- OpenTelemetry sensitive-data guidance for no-content telemetry defaults;
- SLSA provenance levels and OpenSSF Scorecard for release hardening.

## Verification

- Path traversal tests.
- Secret redaction tests.
- Markdown injection snapshot tests.
- SARIF redaction snapshot tests.
- Permission default tests.
- No-content telemetry tests.
- Artifact filename tests.
