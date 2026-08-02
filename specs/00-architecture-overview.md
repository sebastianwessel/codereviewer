# 00: Architecture Overview

Status: Approved
Date: 2026-07-31

## Architecture Summary

R1 is a modular TypeScript CLI package. It has one process, no remote API
server, no browser UI, no database, and no background daemon. The architecture
uses domain modules, strict contracts, provider isolation, deterministic
promotion/admission, and deterministic report rendering.

```text
CLI
  -> configuration
  -> repository-intake
  -> deterministic-signals
  -> review-planning
  -> context-ingestion (optional external change-intent brief)
  -> provider-resolution
  -> review-workflow
  -> holistic-discovery (partitioned per task, with mediated cross-file
       read/list/grep tools through context-retrieval)
  -> semantic-finding-merge
  -> refutation
  -> admission
  -> baseline matching
  -> reporting
  -> quality gate
```

The separate `impact check` and `intent check` commands are advisory lanes
reachable only from the CLI. They never run inside `review`, and
`review-workflow` neither imports them nor can be failed by them.

## Boundary Decisions

| Boundary | Decision |
| --- | --- |
| Model providers | External processors selected by config; optional adapters load dynamically. |
| Repository content | Untrusted input; validated paths and redacted outputs required. |
| Instructions and skills | Instructions are bounded prompt inputs; skills are mounted harness directories with controlled read-only access and hash provenance. |
| Reports | Generated artifacts; redacted and deterministic. |
| SARIF | Export format only; internal domain model remains canonical. |
| Evaluation | Product capability with fixtures and metrics, not only test helper code. |
| Deterministic support signals | Local tooling layer that emits normalized anchors, context hints, contradictions, and evidence; a narrow trusted-rule allowlist may seed actionable deterministic candidates directly. |
| Verification flow | A separate, optional agentic flow (`12-verification-flow.md`) that verifies specific claims with bounded, mediated read/list/grep tools; distinct from the general review, whose guarantees it does not change. |
| Packet size | The provider is the only authority. Assembly never splits on a byte budget; a task is halved only after the provider's normalised `context_length_exceeded` refusal (`26-reactive-task-splitting.md`). The local 8,000,000-byte ceiling is a runaway guard that refuses rather than truncates. |
| Cross-file retrieval | On by default (`16-agentic-cross-file-discovery.md`). Discovery may open files outside the changed set through the mediated tools; retrieved content is untrusted repository data and its candidates pass the same refutation and admission as any other. |

## Clean Rebuild Decision

R1 uses a contract-first clean implementation. There is no prior behavior to
preserve, no data transfer step, no stale alias, no database, and no fallback
translation layer. Breaking contract changes before public release require spec updates;
after public release they require schema version increments.

## N/A Architecture Layers

Frontend, authentication, database schema changes, hosted services, long-lived
workers, notifications, payments, and media uploads are excluded from R1. The
canonical N/A evidence is in [02-capabilities/capability-inventory.md](02-capabilities/capability-inventory.md).
