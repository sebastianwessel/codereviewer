# Agentic Verification And Fix Flow

The general review discovers defects in a change with a single-shot, deterministic,
tools-off pass. The **investigation flow** answers a different question: given a
specific *claim* about the code, is it true? It investigates by reading the
repository with bounded tools and returns a reasoned verdict.

One bounded agent (`investigate_claim`) serves two jobs through the same tools and
bounds:

- **Verification** — validate an external or prior claim (see `verification`).
- **Finding investigation and fix** — for this run's admitted findings, judge real
  vs false positive against the real file, and, when real, propose a precise,
  apply-checked fix (see `fix`).

It is a **second, independent lane**. It is **off by default**, and when disabled
the general review is byte-for-byte unchanged. Enable it under
[`verification`](../reference/configuration.md#verification) or
[`fix`](../reference/configuration.md#fix).

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
claim providers ──▶ investigate_claim agent ──▶ verdict per claim
(claims-file,       (bounded read/list/         (confirmed | refuted |
 prior-findings,     grep loop)                  uncertain) + optional
 current-findings)                               finding judgment + fix
```

1. **Claim providers** gather claims from neutral, filesystem-only sources (no
   network).
2. The **`investigate_claim` agent** investigates one claim at a time, calling the
   same mediated `read` / `list` / `grep` tools the general review uses. Every
   call resolves under the repository root, respects the configured
   include/exclude eligibility (so secret and ignored files are never read),
   redacts its output, and is recorded in the context ledger as evidence.
3. The agent returns a schema-validated outcome; outcomes are written to their
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
| `current-findings` | This run's admitted findings at or above `fix.minSeverity`, turned into "is this real; if so, what is the minimal fix?" claims (the `fix` lane). | None |

This mirrors the change-intent [inbox](change-intent-context.md): a pipeline owns
any fetch and its credentials and writes neutral files; the tool only reads them.
A claim provider that fails at run time is **non-fatal** — it is skipped and
surfaced as a run warning, and the flow proceeds without its claims.

---

## The fix lane

When [`fix`](../reference/configuration.md#fix) is enabled, the lane runs after
admission and before the reporters render. In a **single pass** the agent judges
each admitted finding `real` or `false-positive` against the real file and, for a
`real` finding, proposes apply-ready edits. Before an edit set is attached, **code
(never the model)** re-applies it to the current file bytes; an edit whose line
range does not fit is dropped and the fix is recorded as not produced. This
rejects hallucinated line numbers without a model call.

The lane is **advisory**:

- A `real` finding whose apply-check passes has its `fixProposal` enriched with the
  apply-checked, `manual-review` edit, so the better, real-file-grounded fix is the
  one that flows to the Markdown, SARIF, and review-comment reporters.
- A `false-positive` judgment is surfaced only as a boolean signal — it does **not**
  remove the finding.
- Nothing in the lane changes a finding's category, severity, admission, or the
  quality gate. There is no numeric confidence score.

---

## Output

The verification job writes
[`verification-report.json`](../reference/artifacts.md#review-artifacts) and the
fix lane writes [`fix-report.json`](../reference/artifacts.md#review-artifacts)
into the run directory: the verdicts, per-claim no-content observations (claim
kind, source label, tool-call count, bytes read, status, finding judgment,
whether a fix was produced, the apply-check outcome, duration), the per-finding
fix outcomes, and any run warnings. No source, claim/finding text, fix text, or
tool output appears in logs, traces, or events.

Verdicts and judgments never enter the defect quality gate. A verdict that
independently supports a general-review finding raises a **confidence** signal on
that finding; it never raises severity.

---

## Privacy and safety

- The agent can only read eligible files; excluded and secret files are rejected.
- Tool output is redacted, bounded, and line-numbered before the model sees it.
- Claims are untrusted and cannot change findings, severity, gates, or baseline.

See [Data Handling](../security/data-handling.md) and
[Security](../../specs/07-security-privacy-operations.md).
