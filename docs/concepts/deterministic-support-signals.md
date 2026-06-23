# Deterministic Support Signals

Local, no-execution facts that focus model review and guard promotion decisions.

Deterministic support signals are local facts used to focus model review and
guard promotion decisions. Most signals are context and evidence only, not the
primary issue-discovery surface. This page describes what the signal stage
produces, how signals reach the model, and the rules that keep them in a support
role.

---

## What the signal stage produces

The signal stage may produce:

- changed-line and diff-hunk anchors;
- symbol spans and import/reference hints;
- related test, config, or documentation path hints;
- duplicate keys and baseline fingerprints;
- contradiction signals such as invalid line ranges, out-of-scope paths, or
  unchanged-only evidence.

```mermaid
flowchart LR
  Source["Changed source files"] --> Parse["Local parse (no execution)"]
  Parse --> Anchors["Anchors & symbol spans"]
  Parse --> Hints["Import / test / config hints"]
  Parse --> Keys["Duplicate keys & fingerprints"]
  Parse --> Contra["Contradiction signals"]
  Anchors --> Model["Focus model review"]
  Hints --> Model
  Keys --> Admission["Guard admission"]
  Contra --> Admission
```

---

## How signals relate to other checks

> **Note:** Production setups are expected to run CodeQL, linters, formatters,
> unit tests, and build checks in adjacent pipelines. CodeReviewer uses
> deterministic signals to help the LLM investigate semantic risk and to reject
> weak or contradicted claims.

A small allowlist of trusted rule evidence can also seed actionable
deterministic candidates directly when the rule is local, narrow, and carries
its own evidence and remediation.

---

## Signals do not waive the proof path

Generic support signals do not waive the proof path. A model-origin candidate
that overlaps support-signal evidence still needs:

- a complete proof packet;
- a proved refutation result;
- normal admission

before it can become actionable or enter worker shared context. Model
suggestions that cite the same evidence as a trusted deterministic-rule
candidate are treated as duplicates and dropped before proof work.

---

## Redaction

> **Warning:** Provider prompts receive compact, normalized signal summaries
> only. Raw AST dumps, parser traces, rule-authoring notes, command output,
> source snippets, and provider responses are not written to default logs or
> artifacts.

---

## Signal Injection Mode

`aiReview.deterministicSignalMode` controls how signals reach the model:

| Value | Behavior |
| --- | --- |
| `support` (default) | Serialized signal facts are injected into the model packet as context, improving recall. |
| `disabled` | Signals are still used for file clustering and admission (contradiction checks), but serialized facts are not injected into the model packet. Lower token cost. |

Env: `CODEREVIEWER_AI_DETERMINISTIC_SIGNAL_MODE`.

---

## Observability

The no-content observability step is `deterministic_signals`. It records safe
metadata such as signal counts, evidence counts, supported extension counts, and
structural engine version when available.

---

## See also

- [Architecture](./architecture.md)
- [Review modes and flows](./review-modes-and-flows.md)
- [Data handling](../security/data-handling.md)
