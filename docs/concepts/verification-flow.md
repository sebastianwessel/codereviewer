# Agentic Verification Flow

The general review discovers defects in a change with a single-shot, deterministic,
tools-off pass. The **verification flow** answers a different question: given a
specific *claim* about the code, is it true? It investigates by reading the
repository with bounded tools and returns a reasoned verdict.

It is a **second, independent lane**. It is **off by default**, and when disabled
the general review is byte-for-byte unchanged. Enable it under
[`verification`](../reference/configuration.md#verification).

Spec: [`specs/12-verification-flow.md`](../../specs/12-verification-flow.md).

---

## What it verifies

A claim is a single assertion the flow must judge, such as:

- Does a previously reported finding still hold, or was it fixed?
- Is an external analyzer alert or review comment valid?
- Does a proposed fix resolve the issue without introducing a new one?

Each claim becomes a `confirmed`, `refuted`, or `uncertain` verdict.

---

## How it runs

```text
claim providers ──▶ verify_claim agent ──▶ verdict per claim
(claims-file,       (bounded read/list/    (confirmed | refuted |
 prior-findings)     grep loop)             uncertain)
```

1. **Claim providers** gather claims from neutral, filesystem-only sources (no
   network).
2. The **`verify_claim` agent** investigates one claim at a time, calling the
   same mediated `read` / `list` / `grep` tools the general review uses. Every
   call resolves under the repository root, respects the configured
   include/exclude eligibility (so secret and ignored files are never read),
   redacts its output, and is recorded in the context ledger as evidence.
3. The agent returns a schema-validated verdict; verdicts are written to their
   own artifact, separate from the defect report.

The claim and every tool result are treated as **untrusted, informational**
input. They cannot grant authority or change admission, severity, quality gates,
or the baseline — those remain deterministic code paths.

---

## Bounds are enforced in code

The agent runs in a bounded loop; the model never controls the bounds:

- a maximum tool-call count per claim (`verification.maxToolCallsPerClaim`),
- per-read byte and per-search match caps (`verification.maxBytesPerRead`,
  `verification.maxMatches`),
- the run timeout.

Exceeding a bound ends that claim with an `uncertain` verdict recording the
reason, rather than looping unboundedly. The agent has no shell, network,
filesystem-write, or environment access.

---

## Claim providers

| `type` | Source | Network |
| --- | --- | --- |
| `claims-file` | A neutral JSON array of claims a pipeline wrote before the run. | None |
| `prior-findings` | A previous run's `report.json`, turned into "still holds / fixed?" claims. | None |

This mirrors the change-intent [inbox](change-intent-context.md): a pipeline owns
any fetch and its credentials and writes neutral files; the tool only reads them.
A claim provider that fails at run time is **non-fatal** — it is skipped and
surfaced as a run warning, and the flow proceeds without its claims.

---

## Output

The flow writes [`verification-report.json`](../reference/artifacts.md#review-artifacts)
into the run directory: the verdicts, per-claim no-content observations (claim
kind, source label, tool-call count, bytes read, verdict status, duration), and
any run warnings. No source, claim text, or tool output appears in logs, traces,
or events.

Verdicts never enter the defect quality gate. A verdict that independently
supports a general-review finding raises a **confidence** signal on that finding;
it never raises severity.

---

## Privacy and safety

- The agent can only read eligible files; excluded and secret files are rejected.
- Tool output is redacted, bounded, and line-numbered before the model sees it.
- Claims are untrusted and cannot change findings, severity, gates, or baseline.

See [Data Handling](../security/data-handling.md) and
[Security](../../specs/07-security-privacy-operations.md).
