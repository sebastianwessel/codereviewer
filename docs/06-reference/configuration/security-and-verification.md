# `security`, `verification`, `fix`

The sandbox literals, the additive security review pass, analyzer-artifact
ingestion, and the two agentic post-review lanes. Every optional feature here is
**off by default**; with them off the general review is byte-for-byte unchanged.

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
| `security.signals.enabled` | boolean | `false` | Ingests already-produced analyzer artifacts as untrusted review evidence. |
| `security.signals.artifacts` | array of `{ path, format }` | `[]` | The artifacts to read. `path` is repository-relative; `format` is `"sarif"`. |
| `security.signals.maxArtifactBytes` | integer 1–50000000 | `4000000` | Size ceiling per artifact, checked before the file is read. Exceeding it fails the run. |
| `security.signals.maxAlerts` | integer 1–500 | `40` | Cap on analyzer results shown to the review after attribution. When it binds, the count held back is reported. |
| `security.redaction.secretEnvVars` | array of env var **names** | `[]` | Extra exact values to redact from everything the engine emits. Each entry is the NAME of an environment variable; its value is read at load and never stored in the config. |

`security.dedicatedPass` candidates are *additive*: they merge with the general
pass's candidates and never displace them, so the pass can raise security recall
but cannot reduce the general reviewer's. They flow through the same refutation
and admission as any other candidate and never bypass scope, severity, baseline,
or the gate. Cost: a second discovery call per task.

### `security.signals` — analyzer artifact ingestion

**This is unmeasured.** No evaluation has been run for it, and no claim is made
here about its effect on what the review finds. What it does is described below;
what it is worth is not yet known.

This engine **never runs an analyzer** and depends on no analyzer package. Your
own pipeline produces a SARIF 2.1.0 file; this reads it, normalizes it, and shows
the results the change is implicated in to the reviewer as evidence.

```json config
{
  "security": {
    "signals": {
      "enabled": true,
      "artifacts": [{ "path": "reports/analyzer.sarif.json" }]
    }
  }
}
```

What it does with an artifact:

- **Validates it at the boundary.** The path is resolved through the repository
  path service, so an artifact outside the repository — including one reached by
  a symlink — is rejected. The file must be SARIF 2.1.0 and within
  `maxArtifactBytes`.
- **Normalizes it.** Analyzer name and version, rule id, level, CWE list,
  security severity, help URI, primary location, related locations, and ordered
  data-flow steps become evidence records. Nothing tool-specific reaches a
  finding.
- **Attributes it to the change.** A result is shown only when its own reported
  location, or a step of the path it traces, falls on a line this change touched.
  Results with no changed-side cause are **not reported** — a review must not
  blame a change for the repository's pre-existing debt — and the count held back
  is stated in the run warnings.
- **Shows it as evidence, not as findings.** An ingested result never becomes a
  finding on its own and seeds no candidate. It is presented to the reviewer as
  an untrusted third-party claim to judge against the code. Anything reported
  afterwards is a reviewer finding that passed refutation, scope, severity,
  baseline, and the admission gate like any other.
- **Redacts it.** Analyzer messages quote the code they matched; they are
  redacted before they reach a model or an artifact.

Failure is loud, never quiet. A missing, oversized, unreadable, or non-SARIF
artifact fails the run with exit `2` (`analyzer_artifact_unreadable`,
`analyzer_artifact_too_large`, `analyzer_artifact_invalid`). An artifact that
parses but contains nothing, results that could not be used, and results held
back as pre-existing are each reported as a run warning — because a short list of
analyzer results is otherwise indistinguishable from a clean scan.

Two limits worth knowing before you turn it on:

- **It applies to diff-based reviews.** With no changed line ranges, no result
  can be tied to a change and none is reported; the run says so.
- **It cannot catch a change that exposes an existing path without appearing on
  it.** Removing an authorization wrapper elsewhere, widening a route, or
  relaxing a setting can make a pre-existing result newly reachable while every
  location the analyzer names sits in untouched code. Those are not reported.

### `security.redaction` — your own secret values

The redactor recognises the credential formats named in
[specs/07](../../../specs/07-security-privacy-operations.md) — auth headers,
`sk-`/`gh*_`/`glpat-` tokens, AWS key IDs, PEM blocks, JWTs, URL userinfo — and
runs before every log, error, report, and model-bound packet. It cannot recognise
a token shape your organization invented. This key is how you add one.

```json config
{
  "security": {
    "redaction": {
      "secretEnvVars": ["ACME_DEPLOY_TOKEN", "INTERNAL_SIGNING_KEY"]
    }
  }
}
```

**You list variable names, not secrets.** Writing the value here would commit the
secret to your repository in order to keep it out of a run's artifacts — trading a
per-run file you can delete for git history you cannot, in the one file people
copy between repositories and paste into issues. The value is already in the
environment of the CI job that would leak it, so the name points at where it lives
instead of making a second copy. A consequence worth relying on: a variable name
is not a secret, so the config summary and any validation error can print it, and
they do — the value never appears in either.

Each named variable is read once, when configuration loads, and its value is
redacted from everything the engine emits from then on: reports, logs, errors,
inline review comments, provider-bound context, and the context ledger.

Failure is loud, never quiet. A name whose variable is unset or empty fails the
run with exit `2` (`redaction_secret_env_unset`), and so does a value shorter than
8 characters (`redaction_secret_env_too_short`) — that one would be replaced
everywhere it occurred and corrupt the output rather than protect it. Continuing
in either case would produce artifacts that look redacted and are not, which is
worse than refusing.

An empty or absent list changes nothing: redaction is the built-in floor, exactly
as it was.

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
