# Agent Instructions

## Source Of Truth

- Tracked implementation requirements live in `specs/`.
- End-user documentation lives in `docs/`.
- Implementation conventions live in `.agent/IMPLEMENTATION.md`.
- Local research notes are not tracked. Do not create or commit `concept/`
  content.

## Repository Rules

- Keep public-facing docs product-neutral. Do not reference internal research
  sources or compare this project to other products.
- Preserve a language-neutral core. Put language-specific behavior behind
  analyzer adapters.
- Keep code domain-oriented and isolated. Avoid large catch-all modules,
  tangled cross-domain imports, and stage logic that mixes unrelated concerns.
- Prefer deep, meaningful folder structure over flat files when it improves
  ownership boundaries.
- Keep tests near the implementation they verify.
- Reuse shared helpers for repeated behavior; avoid copy-paste logic.
- Keep the project ESM-only. Do not introduce CommonJS modules or `require`
  unless a spec explicitly defines an interoperability boundary.
- Support Linux and Windows filesystems. Do not hard-code `/`, `\`, drive
  letters, case-sensitive path assumptions, or shell-specific path behavior.
- Keep model providers modular. Do not add provider SDKs to base dependencies
  unless a spec explicitly approves a bundled distribution.
- Treat shell execution, filesystem writes, network access, and publishing as
  explicit permissions.
- Do not log prompt text, source snippets, secrets, tokens, or raw tool output
  by default.

## Expected Commands

```bash
npm run typecheck
npm test
npm run build
```

Use Node.js `>=24.15.0`.
Run `nvm install && nvm use` before local work when nvm is available.

## Ticket Discipline

- Implement against an approved spec.
- Keep changes scoped to the current task.
- Add or update tests for behavior changes.
- Update `docs/` only for behavior users can actually run.
- If a requirement is missing or ambiguous, update or request a spec before
  encoding product behavior.

## Missing Definitions

When implementation details are not defined, choose the smallest reversible
design that preserves the spec's security, provider modularity, and
language-neutral contracts. Record larger product decisions in `specs/` before
implementation.

## Implementation Guide

Read `.agent/IMPLEMENTATION.md` before changing source, tests, configuration,
or generated artifacts.
