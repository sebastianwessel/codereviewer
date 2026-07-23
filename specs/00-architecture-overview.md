# 00: Architecture Overview

Status: Approved
Date: 2026-07-22

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
  -> holistic-discovery
  -> refutation
  -> admission
  -> baseline matching
  -> reporting
  -> quality gate
```

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

## Clean Rebuild Decision

R1 uses a contract-first clean implementation. There is no prior behavior to
preserve, no data transfer step, no stale alias, no database, and no fallback
translation layer. Breaking contract changes before public release require spec updates;
after public release they require schema version increments.

## N/A Architecture Layers

Frontend, authentication, database schema changes, hosted services, long-lived
workers, notifications, payments, and media uploads are excluded from R1. The
canonical N/A evidence is in [02-capabilities/capability-inventory.md](02-capabilities/capability-inventory.md).
