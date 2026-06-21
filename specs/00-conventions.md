# 00: Conventions

Status: Approved
Date: 2026-06-20

## Source-Of-Truth Rules

- Product behavior comes from tracked specs only.
- Implementation tickets must cite exact spec sections.
- Local research notes, previous chat context, and untracked files are not
  implementation authority.
- Shared facts live once and are linked from dependent specs.
- New public behavior requires a spec update before code.

## TypeScript Conventions

- Source files use ESM syntax only.
- Strict TypeScript is required.
- Tests are colocated as `*.test.ts`.
- Domain entrypoints export public domain APIs; sibling domains do not import
  internal files from each other.
- Boundary values validate through Zod schemas before use.
- `any` is forbidden at closed contract boundaries.
- `unknown` is allowed only inside parser functions before schema validation.

## Error Conventions

- Errors use stable `code`, redacted `message`, `category`, `recoverable`,
  `exitCode`, and redacted `details`.
- Raw provider, git, filesystem, and tool errors are normalized before logging.
- Validation failures exit `2` unless a more specific spec-defined code applies.
- Internal invariant violations exit `5`.

## Testing Conventions

- Tests are hermetic by default.
- External providers are opt-in only and excluded from default CI.
- Contract tests validate fixtures against schemas.
- Snapshot tests must prove reports and logs exclude raw source, prompts,
  provider responses, and secrets.
- Every implementation ticket includes failing proof before business logic when
  practical, then passing proof.

## Documentation Conventions

- `docs/` describes implemented behavior only.
- `specs/` defines implementation behavior.
- `concept/` is ignored and does not participate in implementation planning.
