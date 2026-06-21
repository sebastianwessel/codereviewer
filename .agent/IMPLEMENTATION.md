# Implementation Guide

Version: 2026-06-19

## Module Organization

- `src/` contains TypeScript source and colocated tests.
- `specs/` contains tracked implementation specs.
- `docs/` contains user-facing documentation for implemented behavior.
- `concept/` is ignored and must not be committed.

Organize code by domain/topic, not by generic technical buckets. Prefer
meaningful nested folder structures when they make ownership and boundaries
clear. Keep domains separated and expose narrow public entry points.

Prefer small modules with explicit boundaries. Split files when a module mixes
configuration loading, provider resolution, repository analysis, workflow
orchestration, reporting, and platform publishing.

Avoid spaghetti code:

- do not let orchestration modules contain low-level parsing, path handling,
  provider setup, reporting, and policy decisions;
- do not create broad utility modules that become dumping grounds;
- do not pass loosely typed records through multiple layers when a domain type
  or Zod schema should define the contract;
- avoid circular dependencies between domains.

Shared behavior should live in focused helper modules with tests. Reuse those
helpers instead of duplicating path handling, redaction, schema parsing,
report formatting, provider resolution, or error normalization.

## Naming

- Use clear domain nouns: `Finding`, `Evidence`, `ReviewTask`,
  `AdmissionDecision`, `ProviderAdapter`, `LanguageAdapter`.
- Use `camelCase` for variables and functions.
- Use `PascalCase` for types, classes, schemas, and interfaces.
- Use kebab-case for spec and documentation filenames.

## Code Style

- TypeScript is ESM only.
- Do not add CommonJS files, `require`, `module.exports`, or mixed module
  semantics unless a spec explicitly defines an interop adapter.
- Prefer explicit named exports.
- Use Zod schemas at external, workflow, agent, and tool boundaries.
- Keep provider package names as data until provider resolution loads them.
- Do not import optional provider adapters from core modules.
- Keep comments sparse and useful; explain non-obvious policy or security
  decisions.

## Imports

- Import local TypeScript modules with `.js` extensions.
- Keep imports ordered from external packages to local modules.
- Avoid side-effect imports unless required by a documented runtime contract.
- Use `import.meta.url`, `fileURLToPath`, and `pathToFileURL` for module-relative
  file locations.
- Do not use `__dirname` or `__filename`.

## Filesystem Portability

- Support Linux and Windows paths.
- Use Node's `node:path` APIs instead of string concatenation for filesystem
  paths.
- Use `path.resolve`, `path.relative`, `path.normalize`, and `path.join` at
  filesystem boundaries.
- Use `path.posix` only for formats that require POSIX separators, such as git
  paths, report identifiers, URLs, or SARIF-style artifact URIs.
- Normalize paths before comparison and avoid assuming case sensitivity.
- Do not assume executable shell syntax, environment variable syntax, temp
  directory layout, drive letters, or path separators.
- Add tests with POSIX-style and Windows-style paths when implementing path
  parsing, report locations, diff mapping, config loading, or repository
  discovery.

## Testing

- Use Vitest.
- Place test files beside the implementation: `name.test.ts` next to
  `name.ts`.
- Unit tests should use fake or scripted providers.
- Do not require network credentials for default tests.
- Cover queue behavior, provider-resolution errors, admission decisions,
  language-adapter contracts, and report rendering as those modules land.
- When fixing a bug, add the closest possible regression test near the changed
  module.

## Public Interfaces

Document public CLI flags, configuration keys, provider setup, report schemas,
and exit codes in `docs/` only after the behavior exists. Keep public examples
focused and executable.

## Provider Rules

- Base dependencies may include `@purista/harness` and core libraries.
- Provider adapters must be optional installation choices.
- Missing selected providers should fail with a setup error that names the
  package to install.
- OpenAI-compatible APIs use `@purista/harness-openai`.
- AWS Bedrock uses `@purista/harness-bedrock`.
- Azure-hosted models use `@purista/harness-azure-foundry`.

## Security And Logging

- Default telemetry must not capture source, prompts, secrets, tokens, or raw
  tool output.
- Redact configured secrets before assembling model-bound context.
- Repository access is read-only unless a spec explicitly enables fix mode.
- Shell, filesystem write, network, MCP, and publishing capabilities require
  explicit permission modeling.

## Generated Artifacts

- Do not commit `dist/`, `coverage/`, or dependency folders.
- Rebuild generated artifacts during verification, then remove them unless a
  spec explicitly requires checked-in output.
- Keep `package-lock.json` synchronized with `package.json`.

## Verification

Run these before claiming implementation work is complete:

```bash
nvm install
nvm use
npm run typecheck
npm test
npm run build
```

Remove generated `dist/` after build verification unless tracked output is
explicitly required.

## Anti-Patterns

- Product comparisons or public references to internal research sources.
- Provider SDKs in the base dependency set.
- Language-specific fields in core finding or evidence contracts.
- Flat source trees that hide domain ownership.
- Duplicated helper logic across domains.
- Large orchestration files that mix parsing, IO, provider calls, policy, and
  reporting.
- Model-only merge approval, merge blocking, or publication decisions.
- Prompt text or source snippets in logs by default.
- User-facing docs for behavior that is still speculative.

## Convention Drift

No drift recorded yet.
