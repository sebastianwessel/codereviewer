# 00: Vision

Status: Approved
Date: 2026-07-31

## Product Vision

Build a local-first, LLM-centric semantic code review engine for developers and
CI. The product produces precise, auditable findings through a holistic
whole-file review that discovers candidate defects, then an independent
refutation pass that verifies or discards each one, and finally deterministic
safety gates. It favors correctness, traceability,
privacy, and low noise over comment volume, and it assumes production pipelines
already run CodeQL, linters, formatters, tests, and build checks.

## R1 Outcome

`R1` delivers a working CLI that:

- reviews a checked-out repository from a base/head diff or explicit file list;
- emits JSON, Markdown, and SARIF artifacts into a run directory;
- extracts lightweight deterministic repository signals for anchoring,
  context selection, contradiction checks, de-duplication, and reporting while
  keeping core contracts language-neutral;
- resolves OpenAI/OpenAI-compatible, AWS Bedrock, and Azure providers through
  optional adapter packages only when configured;
- runs deterministic evaluation fixtures and quality gates;
- answers, on a default run, what the change was for and whether it got there
  (intent) and what it might break (impact) — two advisory lanes, on by default
  since 2026-08-11, runnable on their own as `intent check` and `impact check`,
  and unable to fail a pipeline on their own findings under any configuration;
- denies publishing, shell execution, broad network access, and fix application.
  The optional fix lane produces apply-checked edit suggestions in memory only:
  it never writes a source file.

## Success Criteria

| ID | Criterion | Verification |
| --- | --- | --- |
| VIS-001 | Actionable review output includes only admitted findings whose refutation verdict is `proved`. | Admission, refutation, and report integration tests. |
| VIS-002 | Default runs leak no raw source, prompts, or provider responses into logs/traces/reports, and remove every secret shape on the redactor's pattern list plus every operator-configured exact value. Completeness beyond that list is NOT claimed — see `07-security-privacy-operations.md`, *What The Mechanism Supports, And What It Does Not*. | Redaction and artifact snapshot tests over known tokens, per seam. |
| VIS-003 | Provider packages are optional and isolated from base imports. | Provider-resolution unit tests and static import scan. |
| VIS-004 | Reports are deterministic from canonical contracts. | Snapshot and schema validation tests. |
| VIS-005 | Agent implementation work proceeds from approved tickets only. | Planning gate and ticket review. |
| VIS-006 | The product does not duplicate external static-analysis, formatting, test, or build responsibilities as its primary review surface. | Scope tests, capability inventory review, and eval fixture taxonomy. |

## Non-Goals

The R1 non-goal list is canonical in [00-scope-and-glossary.md](00-scope-and-glossary.md).
