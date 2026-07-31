# 08: Dependencies And Release

Status: Approved
Date: 2026-06-22

## Dependency Evidence

Ranges are the committed `package.json`; versions, licenses, and engines are the
resolved packages in the committed lockfile, read on 2026-07-31.

| Package | Role | Declared Range | Resolved Version | License | Engine |
| --- | --- | --- | --- | --- | --- |
| `@purista/harness` | Workflow/agent runtime | `^1.7.1` | `1.7.1` | Apache-2.0 | `>=24.15.0` |
| `@purista/harness-openai` | Optional OpenAI adapter; optional peer, and dev-installed for this repository's local OpenAI eval/review setup | `^1.7.1` | `1.7.1` | Apache-2.0 | `>=24.15.0` |
| `@purista/harness-bedrock` | Optional Bedrock adapter; optional peer, not installed here | `^1.6.0` | not installed | Apache-2.0 | `>=24.15.0` |
| `@purista/harness-azure-foundry` | Optional Azure adapter; optional peer, not installed here | `^1.6.0` | not installed | Apache-2.0 | `>=24.15.0` |
| `zod` | Runtime schemas | `^4.4.3` | `4.4.3` | MIT | not declared |
| `typescript` | Compiler | `^6.0.3` | `6.0.3` | Apache-2.0 | `>=14.17` |
| `vitest` | Test runner | `^4.1.10` | `4.1.10` | MIT | `^20.0.0 || ^22.0.0 || >=24.0.0` |
| `@vitest/coverage-v8` | Test coverage provider | `^4.1.10` | `4.1.10` | MIT | not declared |
| `tsx` | Dev runner | `^4.23.1` | `4.23.1` | MIT | `>=18.0.0` |
| `@types/node` | Node types | `^26.1.2` | `26.1.2` | MIT | not declared |
| `@ast-grep/napi` | Optional local structural parsing layer for deterministic support signals | `^0.45.0` | `0.45.0` | MIT | `>= 10` |
| `@ast-grep/lang-python` | Python dynamic AST grammar | `^0.0.6` | `0.0.6` | ISC | not declared |
| `@ast-grep/lang-go` | Go dynamic AST grammar | `^0.0.6` | `0.0.6` | ISC | not declared |
| `@ast-grep/lang-rust` | Rust dynamic AST grammar | `^0.0.7` | `0.0.7` | ISC | not declared |
| `@ast-grep/lang-java` | Java dynamic AST grammar | `^0.0.7` | `0.0.7` | ISC | not declared |
| `@ast-grep/lang-ruby` | Ruby dynamic AST grammar | `^0.0.7` | `0.0.7` | ISC | not declared |

Two packages sit in `dependencies` that would normally be development-only. Both
placements are deliberate and are recorded here rather than left as observations.

`typescript` is a RUNTIME dependency because two shipped modules import the
compiler API to execute:
`src/domains/deterministic-signals/ecmascript/ecmascript-signal-extractor.ts` and
`src/domains/deterministic-signals/deterministic-signal-metadata.ts`. It is used
as a parser, not as a build tool. Moving it to `devDependencies` would break
deterministic signal extraction for every consumer.

`@types/node` is a RUNTIME dependency because the published declarations require
it. Three shipped declarations name `Buffer` in a public type position — `sha256`,
the repository-intake `readFile` port, and the context-ledger `content` field — so
a consumer cannot compile against this package without Node's types. It must
resolve for them whether or not they asked for it, which a `devDependency` cannot
guarantee. The reference directive that pulls it in is carried by the hand-written
types entries (`types/index.d.ts`, `types/cli.d.ts`) that `exports` points at;
`tsconfig.build.json` sets `types` explicitly, and TypeScript does not emit a
`/// <reference types="node" />` into declarations when that option is set. This
is verified by a consumer typecheck in the `PR checks` workflow, not by assertion.

## Compatibility Exceptions

| Package | Latest | Pinned to | Why |
| --- | --- | --- | --- |
| `typescript` | `7.0.2` | `^6.0.3` | TypeScript 7 is the Go port and ships **no stable programmatic compiler API**; one is targeted for 7.1. The two modules above import that API at runtime, so 7.0 risks breaking deterministic signal extraction in the published package. Revisit at 7.1. |

The optional provider-adapter peer ranges stay at `^1.6.0` even though the
resolved adapters are `1.7.1`. A peer range states what a host tolerates, and
`^1.6.0` already admits `1.7.1`; narrowing it would reject working `1.6.x`
adapters for no benefit.

## Version Policy

- Use latest stable versions unless a spec records a compatibility exception.
- Keep `package-lock.json` committed.
- Do not use canary, beta, RC, or next releases in `R1`.
- Provider adapter packages remain outside base dependencies. They may be
  declared only as optional peers so consumers can install exactly the adapter
  required by their configured provider. All three adapters are declared in
  `peerDependencies` with `peerDependenciesMeta.optional = true`; the OpenAI
  adapter is additionally a `devDependency` of this repository so its own
  provider-backed eval and review runs can execute.
- Generic structural parsing dependencies may be base dependencies only when
  they are required for deterministic support signals and pass Linux/Windows
  install verification. Language-native tool integrations that invoke external
  toolchains remain optional and must degrade gracefully when unavailable.
- Dependency updates require typecheck, tests, build, and dependency evidence
  refresh in this spec.

## Runtime Version

Node.js `24.15.0` is the minimum because `@purista/harness@1.6.0` declares
`>=24.15.0`. `.nvmrc` must contain `24.15.0`, and `package.json` `engines.node`
must declare `>=24.15.0`.

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
- no data transfer steps;
- no long-lived state cleanup beyond deleting local run artifacts.

## Compatibility

- Report schema starts at `1.0`.
- Config schema starts at `1.0`.
- Breaking contract changes require schema version increment, a
  breaking-change record, and explicit fail-fast tests for obsolete inputs.
- Runtime support for obsolete contracts is not part of R1; removed inputs fail
  fast instead of being translated.
- Since no public release exists yet, pre-`1.0` internal changes can rewrite
  contracts only by updating these specs first.

## Required Package Scripts

| Script | Command Semantics |
| --- | --- |
| `generate:schemas` | Generate `schema/codereviewer-config.schema.json` from Zod contract sources and write it. |
| `generate:schemas:check` | Run the same generator in check mode and fail when the generated file differs from the committed one. This is the script CI and the generated-artifact drift gate rely on; `generate:schemas` alone would silently rewrite the file instead of failing. |
| `typecheck` | Run TypeScript with no emit. |
| `test` | Run hermetic Vitest tests. |
| `build` | Build ESM output into `dist/`. |

Additional committed scripts exist for provider-backed evaluation
(`eval:hydrate`, `eval:benchmark`, `eval:benchmark:debug`, `eval:corpus`,
`eval:corpus:hydrate`) and are required by
`06-evaluation-and-quality-gates.md`, which owns their semantics.

## Research Sources

Research inputs retrieved on 2026-06-20 and package metadata refreshed on
2026-06-22:

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
- Tree-sitter and ast-grep documentation for optional AST-backed deterministic
  support signals.
- Semgrep supported-language documentation for optional external SAST evidence
  ingestion.
- SCIP documentation for future language-agnostic code intelligence indexing.
