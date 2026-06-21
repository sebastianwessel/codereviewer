# 00: Vision

Status: Approved
Date: 2026-06-20

## Product Vision

Build a local-first, evidence-first code review engine for developers and CI.
The product produces precise, auditable findings from repository facts, optional
model reasoning, and deterministic admission gates. It favors correctness,
traceability, privacy, and low noise over comment volume.

## R1 Outcome

`R1` delivers a working CLI that:

- reviews a checked-out repository from a base/head diff or explicit file list;
- emits JSON, Markdown, and SARIF artifacts into a run directory;
- supports TypeScript, JavaScript, Python, Go, Rust, and Java as first-class
  language analyzer targets while keeping core contracts language-neutral;
- resolves OpenAI/OpenAI-compatible, AWS Bedrock, and Azure providers through
  optional adapter packages only when configured;
- runs deterministic evaluation fixtures and quality gates;
- denies publishing, shell execution, broad network access, and fix application.

## Success Criteria

| ID | Criterion | Verification |
| --- | --- | --- |
| VIS-001 | Review output includes only admitted findings with evidence. | Admission and report integration tests. |
| VIS-002 | Default runs leak no raw source, prompts, provider responses, or secrets into logs/traces/reports. | Redaction and artifact snapshot tests. |
| VIS-003 | Provider packages are optional and isolated from base imports. | Provider-resolution unit tests and static import scan. |
| VIS-004 | Reports are deterministic from canonical contracts. | Snapshot and schema validation tests. |
| VIS-005 | Agent implementation work proceeds from approved tickets only. | Planning gate and ticket review. |

## Non-Goals

The R1 non-goal list is canonical in [00-scope-and-glossary.md](00-scope-and-glossary.md).
