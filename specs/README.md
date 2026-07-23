# CodeReviewer Specifications

Status: Approved
Date: 2026-06-19
Owner: Product architecture

## Source Of Truth

These files are the tracked implementation source of truth. Agents must not
derive product behavior from local research notes, prior conversation context,
or untracked files.

## Specification Set

- [00-scope-and-glossary.md](00-scope-and-glossary.md)
- [01-architecture-and-structure.md](01-architecture-and-structure.md)
- [02-capabilities/capability-inventory.md](02-capabilities/capability-inventory.md)
- [03-contracts/finding-evidence-report.md](03-contracts/finding-evidence-report.md)
- [04-configuration-and-providers.md](04-configuration-and-providers.md)
- [05-review-workflow-and-runtime.md](05-review-workflow-and-runtime.md)
- [06-evaluation-and-quality-gates.md](06-evaluation-and-quality-gates.md)
- [07-security-privacy-operations.md](07-security-privacy-operations.md)
- [08-dependencies-and-release.md](08-dependencies-and-release.md)
- [09-readiness-self-audit.md](09-readiness-self-audit.md)
- [10-state-of-the-art-research-synthesis.md](10-state-of-the-art-research-synthesis.md)
- [11-external-context-ingestion.md](11-external-context-ingestion.md)
- [12-verification-flow.md](12-verification-flow.md)

## Implementation Rule

Implementation starts only after readiness review approves the current draft
updates and a human records approval. Until then, code changes can only support
scaffolding, verification, or spec-defined contracts that do not narrow or
change product semantics.
