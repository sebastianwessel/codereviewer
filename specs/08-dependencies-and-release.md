# 08: Dependencies And Release

Status: Approved
Date: 2026-06-19

## Dependency Evidence

Retrieved on 2026-06-19 with `npm view`.

| Package | Role | Current Version | License | Engine |
| --- | --- | --- | --- | --- |
| `@purista/harness` | Workflow/agent runtime | `1.5.1` | Apache-2.0 | `>=24.15.0` |
| `@purista/harness-openai` | Optional OpenAI adapter | `1.5.1` | Apache-2.0 | `>=24.15.0` |
| `@purista/harness-bedrock` | Optional Bedrock adapter | `1.5.1` | Apache-2.0 | `>=24.15.0` |
| `@purista/harness-azure-foundry` | Optional Azure adapter | `1.5.1` | Apache-2.0 | `>=24.15.0` |
| `zod` | Runtime schemas | `4.4.3` | MIT | not declared |
| `typescript` | Compiler | `6.0.3` | Apache-2.0 | not declared |
| `vitest` | Test runner | `4.1.9` | MIT | `^20.0.0 || ^22.0.0 || >=24.0.0` |
| `tsx` | Dev runner | `4.22.4` | MIT | `>=18.0.0` |
| `@types/node` | Node types | `26.0.0` | MIT | not declared |
| `@ast-grep/napi` | Preferred generic multi-language AST analysis layer | `0.43.0` | MIT | `>= 10` |
| `@ast-grep/lang-python` | Python dynamic AST grammar | `0.0.6` | ISC | not declared |
| `@ast-grep/lang-go` | Go dynamic AST grammar | `0.0.6` | ISC | not declared |
| `@ast-grep/lang-rust` | Rust dynamic AST grammar | `0.0.7` | ISC | not declared |
| `@ast-grep/lang-java` | Java dynamic AST grammar | `0.0.7` | ISC | not declared |
| `tree-sitter` | Underlying parser family / fallback parser binding | `0.25.0` | MIT | not declared |
| `web-tree-sitter` | WASM fallback parser binding when native parser loading is unsuitable | `0.26.9` | MIT | not declared |

## Version Policy

- Use latest stable versions unless a spec records a compatibility exception.
- Keep `package-lock.json` committed.
- Do not use canary, beta, RC, or next releases in `R1`.
- Provider adapter packages remain outside base dependencies. They may be
  declared only as optional peers so consumers can install exactly the adapter
  required by their configured provider.
- Generic language analyzer dependencies may be base dependencies only when
  they are required for first-class offline analysis and pass Linux/Windows
  install verification. Language-native tool integrations that invoke external
  toolchains remain optional and must degrade gracefully when unavailable.
- Dependency updates require typecheck, tests, build, and dependency evidence
  refresh in this spec.

## Runtime Version

Node.js `24.15.0` is the minimum because `@purista/harness@1.5.1` declares
`>=24.15.0`. `.nvmrc` must contain `24.15.0`.

## Supply Chain Requirements

Before release:

- `npm audit` or equivalent vulnerability scan must be run and recorded;
- license review must confirm no incompatible runtime dependency license;
- lockfile must match `package.json`;
- build output must be reproducible from lockfile;
- GitHub Actions or equivalent release workflows must pin third-party actions
  by commit SHA;
- release provenance must target SLSA Build Level 2 or better before public
  distribution;
- OpenSSF Scorecard must be run and recorded before public distribution;
- release CI must produce an SBOM when package publishing is enabled;
- generated artifacts must not include secrets or local absolute paths.

## Secure Development Controls

Implementation work must map release checks to NIST SSDF practices:

| Control Area | R1 Requirement |
| --- | --- |
| Prepare the organization | `AGENTS.md`, `CLAUDE.md`, and `.agent/IMPLEMENTATION.md` define implementation rules. |
| Protect software | lockfile committed, release workflow pinned, provenance target recorded. |
| Produce well-secured software | specs require schemas, tests, no-content telemetry, redaction, and secure defaults. |
| Respond to vulnerabilities | dependency evidence refresh, vulnerability scan record, and rollback by package version. |

## Release Artifacts

R1 release artifacts:

- npm package when publishing is enabled by future release ticket;
- source repository;
- generated `dist/` from build;
- committed config JSON Schema at `schema/codereviewer-config.schema.json`.

No container image is required in R1.

## Rollback

R1 rollback is package-version rollback:

- revert to previous git tag or npm version;
- no database rollback;
- no migrations;
- no long-lived state cleanup beyond deleting local run artifacts.

## Compatibility

- Report schema starts at `1.0`.
- Config schema starts at `1.0`.
- Breaking contract changes require schema version increment and migration note.
- Since no public release exists yet, pre-`1.0` internal changes can rewrite
  contracts only by updating these specs first.

## Required Package Scripts

| Script | Command Semantics |
| --- | --- |
| `generate:schemas` | Generate `schema/codereviewer-config.schema.json` from Zod contract sources and fail if the generated file differs from the committed file in CI. |
| `typecheck` | Run TypeScript with no emit. |
| `test` | Run hermetic Vitest tests. |
| `build` | Build ESM output into `dist/`. |

## Research Sources

Research inputs retrieved on 2026-06-20:

- PURISTA harness package metadata from npm for runtime and adapter versions.
- OASIS SARIF 2.1.0 specification for report export semantics.
- GitHub code scanning SARIF support documentation for supported SARIF subset,
  upload behavior, and result limits.
- OpenAI Codex GitHub review documentation for agentic review workflow and PR
  integration patterns.
- Anthropic Claude Code review documentation for review modes and instruction
  handling patterns.
- GitHub Copilot code review documentation for PR comment and repository
  instruction patterns.
- GitLab Duo Code Review Flow documentation for CI/MR review workflow patterns.
- OWASP Top 10 for LLM Applications 2025 for prompt injection and agent
  security risks.
- NIST SP 800-218 Secure Software Development Framework for secure development
  controls.
- SLSA v1.2 and OpenSSF Scorecard documentation for supply-chain controls.
- OpenTelemetry sensitive-data guidance for telemetry constraints.
- Tree-sitter and ast-grep documentation for AST-backed multi-language
  structural analysis.
- Semgrep supported-language documentation for optional external SAST evidence
  ingestion.
- SCIP documentation for future language-agnostic code intelligence indexing.
