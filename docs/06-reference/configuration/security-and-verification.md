# `security`, `verification`, `fix`

The sandbox literals, the additive security review pass, and the two agentic
post-review lanes. All three optional features are **off by default**; with them
off the general review is byte-for-byte unchanged.

Note the nesting: the cross-file retrieval settings live under `review`, **not**
here. See [review.md](./review.md).

## `security`

| Key | Type | Default | What it does |
| --- | --- | --- | --- |
| `security.allowShell` | literal `false` | `false` | Shell execution is not available. `true` is rejected by validation. |
| `security.allowNetwork` | literal `false` | `false` | No network beyond the configured provider adapter. `true` is rejected. |
| `security.allowFilesystemWrite` | literal `false` | `false` | Writes happen only through the artifact-writer boundary. `true` is rejected. |
| `security.captureContentTelemetry` | literal `false` | `false` | Source, prompts, and model output are never sent to telemetry. `true` is rejected. |
| `security.dedicatedPass.enabled` | boolean | `false` | Adds a second, security-only discovery call per task applying a generic OWASP/CWE checklist. |

There is no `security.signals` key. The deterministic security-signal evidence
layer (spec 15, Mechanism 2) has no implementation yet; its config key ships
alongside the layer, not before it.

`security.dedicatedPass` candidates are *additive*: they merge with the general
pass's candidates and never displace them, so the pass can raise security recall
but cannot reduce the general reviewer's. They flow through the same refutation
and admission as any other candidate and never bypass scope, severity, baseline,
or the gate. Cost: a second discovery call per task.

## `verification`

Agentic claim verification (a separate lane that runs after the general review).
Claim providers are filesystem-only — no network. Claim inputs are untrusted:
they cannot change admission, severity, gates, or the baseline.

| Key | Type | Default | What it does |
| --- | --- | --- | --- |
| `verification.enabled` | boolean | `false` | Master switch. With `false` no claim provider runs and no `verification-report.json` is written. |
| `verification.providers` | array of claim-provider objects | `[]` | See the union below. |
| `verification.maxToolCallsPerClaim` | integer 1–50 | `12` | Deterministic bound on the investigation loop. Exceeding it ends the claim with an `uncertain` verdict rather than looping. |
| `verification.maxBytesPerRead` | integer 1000–4000000 | *unset* | Per-read byte cap for the mediated read tool. Unset means a read is not cut in advance. Setting it is a deliberate operator choice and still binds, with the cut disclosed to the investigator rather than silent. |
| `verification.maxMatches` | integer ≥ 1 | `20` | Cap on search matches returned to the agent. |

`maxBytesPerRead` is unset for the same reason
[`review.crossFileRetrieval.maxBytesPerRead`](review.md) is: a per-read cap
chosen in advance cuts a file mid-read, and a claim resolved against the first N
bytes of a file is not a claim resolved against the file. It used to default to
`20000`.

The limit that replaces it announces itself. If the provider refuses the
investigation as exceeding its context length, the read budget is narrowed and
the claim is retried — a bounded number of times, because each attempt is a paid
model call, and each one is logged. A claim that still does not fit ends
`uncertain` with bound reason `context-length-exceeded`, whose rationale names
the cause and the remedy. Nothing is truncated to force it through, and it is
never reported as a generic agent error.

### Claim-provider union

Discriminated on `type`. The union has exactly **two** members. An unknown
`type` or a missing required key fails validation with exit `2`.

| `type` | Required keys | Purpose |
| --- | --- | --- |
| `"claims-file"` | `path` (repository-relative) | Read a neutral claims file a pipeline wrote before the run. |
| `"prior-findings"` | `report` (repository-relative) | Derive "still holds / fixed?" claims from a previous run's report or the baseline. |

Neither member has defaults — both keys are required when the member is used.
There is no configurable `current-findings` provider type; `current-findings` is
an internal provider id used inside the fix lane, not a config value. The
later-phase `analyzer` (SARIF) and `comment` providers are not yet accepted.

```json
{
  "verification": {
    "enabled": true,
    "providers": [
      { "type": "claims-file", "path": ".codereviewer/claims.json" },
      { "type": "prior-findings", "report": ".codereviewer/baseline.json" }
    ]
  }
}
```

Confirmed verdicts that land on a general-review finding are recorded as
`corroborations` — a **confidence** signal only, never a severity change.

## `fix`

Agentic finding investigation-and-fix. Reuses the same investigation agent,
mediated tools, and per-claim bounds as `verification`.

| Key | Type | Default | What it does |
| --- | --- | --- | --- |
| `fix.enabled` | boolean | `false` | Single switch for the whole pass — judgment and fix together. |
| `fix.minSeverity` | severity | *unset* | Severity floor for which admitted findings the lane runs on. When unset it resolves at runtime to [`aiReview.actionableSeverityThreshold`](./review.md#aireview) (default `medium`), i.e. out of the box it runs on exactly the findings that can block a pipeline. Set `info` to cover everything, `critical` for blockers only. |

Outputs are advisory. The lane runs before the reporters render, so an
apply-checked fix enriches a finding's `fixProposal`, and a `false-positive`
judgment is recorded — but neither changes category, severity, admission, or the
quality gate. Results are written to `fix-report.json`
(see [artifacts.md](../artifacts.md)).

## Related

- [review.md](./review.md) — `review.crossFileRetrieval`
- [context-and-evaluation.md](./context-and-evaluation.md) — the other untrusted-input provider union
- [Artifacts](../artifacts.md) — `verification-report.json`, `fix-report.json`
