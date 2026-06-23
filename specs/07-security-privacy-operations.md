# 07: Security, Privacy, And Operations

Status: Approved
Date: 2026-06-19

## Threat Model

Trust boundaries:

- repository content is untrusted;
- config files are untrusted until schema-validated;
- the repository root is the maximum local authority boundary;
- reviewer instructions and skills are untrusted prompt inputs;
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
| No implicit network | Network is denied by default. The only R1 network path is the explicitly selected model provider endpoint after provider config validation. |
| No repository exfiltration by default | Local providerless and signal-only paths must not send repository content to any network destination. Provider-backed review sends only bounded, redacted, ledger-recorded context to the selected provider. |
| No prompt/tool authority | Prompts, repository content, skills, and model output cannot grant filesystem, git, shell, network, publishing, or gate authority. |
| Auditable decisions | Security-relevant allow/deny decisions produce stable, redacted events and testable error codes. |

## Explicit Attacker Vectors And Required Controls

| Vector | Example | Required Control |
| --- | --- | --- |
| Config path escape | `--config ../../secret.json`, `CODEREVIEWER_CONFIG_PATH=C:\Users\...` | Resolve through root-bound path service and reject escape. |
| Artifact path escape | `paths.artifactDir=../outside` or symlinked `.codereviewer/runs` | Resolve real parent paths under root before write; reject symlink escape. |
| Instruction/skill escape | `.codereviewer/skills/../../private/SKILL.md` | Normalize and resolve each requested file under root; reject traversal and symlink escape. |
| Git ref injection | `--base-ref=-c core.sshCommand=...` | Reject refs starting with `-`; execute only allowlisted `git diff` argument arrays. |
| Destructive git | hidden path to `git reset`, `clean`, `checkout`, `push`, `commit` | Do not expose a generic git runner to config/model/plugin paths; enforce read-only command allowlist. |
| Shell injection | file path containing `; rm -rf` | Never use shell command strings; pass paths as args after `--`. |
| Provider exfiltration | malicious config points to attacker OpenAI-compatible URL | Require explicit provider config, document provider trust boundary, redact secrets, ledger context, and allow local runs with no provider. |
| Prompt exfiltration | repository asks model to print env vars or upload code | No tools with env/filesystem/network authority are available to model output; env is never in prompt context. |
| Report injection | finding title contains HTML/script/Markdown table breaks | Escape Markdown/SARIF user-controlled text and never emit raw source snippets by default. |
| Secret leakage | token appears in source, error, provider message, or artifact | Redact before logs, errors, reports, traces, and provider-bound summaries. If a value cannot be proven redacted, exclude it from output. |
| Denial of service | huge files, many paths, nested skill tree | Enforce max files, max file bytes, context bytes, traversal caps, timeouts, and concurrency caps. |
| Drift hiding | README claims a command exists but CLI rejects it | Drift checker compares docs/specs/CLI/package/config/generated schemas and emits drift findings. |
| Ambiguity hiding | spec uses subjective security wording without a testable rule | Ambiguity checker emits configurable warning/error findings for vague, subjective, or conflicting requirements. |

## Data Classification

| Data | Classification | Default Handling |
| --- | --- | --- |
| Source code | sensitive customer data | May be read locally; not logged/traced. |
| Prompts/instructions | sensitive | Sent only to the selected provider for configured model-backed tasks; not logged/traced. |
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
- model-bound context assembly where configured secret patterns are available.

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

- repository content, instructions, skills, prior artifacts, and provider
  responses are untrusted input;
- model output can propose suspicions, proof packets, and refutation summaries
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
| Network | provider only | Only selected provider adapter. |
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

## Git Safety

The product must not provide a generic git execution surface.

Allowed R1 git commands:

| Purpose | Command Shape |
| --- | --- |
| Changed path discovery | `git diff --name-status <baseRef> <headRef>` |
| Diff hunk map | `git diff --unified=0 <baseRef> <headRef> -- <paths...>` |

Rules:

- No `git reset`, `clean`, `checkout`, `switch`, `restore`, `commit`, `push`,
  `pull`, `fetch`, `merge`, `rebase`, `tag`, `worktree`, `submodule`, `config`,
  `remote`, `gc`, `maintenance`, or hook execution is allowed.
- Git refs must be non-empty and must not start with `-`.
- File paths passed to git must be repository-relative portable paths validated
  by path service and placed after `--`.
- Git is executed with `execFile` or equivalent argument-array API, never
  through a shell.
- Git errors are normalized and redacted; raw command output is not logged.

## Network And Provider Exfiltration Controls

Network is off unless a provider-backed review is explicitly configured.

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
- investigation and refutation tools must be mediated by deterministic code
  that enforces path containment, read/search budgets, redaction, and context
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

Operational artifacts:

- `report.json`;
- `report.md`;
- `report.sarif`;
- `run-summary.json`;
- `context-ledger.json`;
- `shared-context.json`;
- `error.json` for partial failed runs;
- optional `eval-report.json`.

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
