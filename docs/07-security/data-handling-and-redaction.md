# Data Handling and Redaction

Where your code goes, what is written down, and what is stripped before either
happens.

---

## Data classification

| Data | Class | Default handling |
| --- | --- | --- |
| Source code | Sensitive customer data | Read locally. Sent to the configured provider only for model-backed tasks, bounded and ledgered. Never logged or traced. |
| Prompts and instructions | Sensitive | Sent only to the selected provider. Never logged or traced. |
| External change-intent context | Sensitive, untrusted | Redacted before it enters the summarizer, the prompt or the ledger. Never logged or traced. |
| Secrets and tokens | Secret | Redacted before model context, logs, errors and reports. |
| Evidence summaries | Internal | Redacted, safe for the report. |
| Run metadata | Internal | Safe for the report after redaction. |
| Cost and timing metrics | Operational | Safe for logs and reports. |

---

## Where your code travels

```mermaid
flowchart LR
  R["Repository files"] --> P["Deterministic planning<br/>+ budgets"]
  P --> L["Context ledger entry<br/>include / skip / truncate"]
  L --> RED["Redactor"]
  RED --> PK["Task packet"]
  PK --> PROV["Configured provider endpoint"]
  PROV --> S["Schema parse + redact"]
  S --> A["Artifacts under the<br/>artifact directory"]
  R -.->|"never"| LOG["Logs / traces"]
  PK -.->|"never"| LOG
```

**With no provider configured, nothing leaves the machine.** The run reads the
diff, computes deterministic signals, plans tasks, writes artifacts and
evaluates the gate with zero network IO.

**With a provider configured**, the only network destination is that provider's
endpoint. Every item considered for transfer gets a context-ledger entry
recording the include/skip/truncate decision, the byte count, a content hash
and a reason. `context-ledger.json` in each run directory is the audit trail:
it tells you what was sent without reproducing it.

What is **never** provider context: raw environment variables, local absolute
paths, git remotes, shell output, secrets, and files excluded by configuration.

---

## The redactor

One redactor runs before logs, errors, traces, report rendering, model-bound
context assembly, and ingestion of external change-intent context.

Built-in patterns:

| Pattern | Handling |
| --- | --- |
| `Authorization: Bearer …` / `Authorization: Basic …` | Header name kept, value replaced |
| URL userinfo (`scheme://user:pass@host`) | Scheme kept, credentials replaced |
| PEM private key blocks | Whole block replaced |
| JSON Web Tokens (`eyJ….eyJ….…`) | Replaced |
| OpenAI-style keys (`sk-…`, `sk-proj-…`) | Replaced |
| GitHub PATs (`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`) and fine-grained (`github_pat_…`) | Replaced |
| GitLab PATs (`glpat-…`) | Replaced |
| Slack tokens (`xoxa-`, `xoxb-`, `xoxp-`, `xoxr-`, `xoxs-`) | Replaced |
| Google API keys (`AIza…`) | Replaced |
| AWS access key IDs (`AKIA…`, `ASIA…`) | Replaced |
| AWS secret access keys, when paired with a recognizable key name | Key name kept, value replaced |

The replacement marker is `[REDACTED]`.

The redactor also accepts a list of exact secret values programmatically, which
error normalization can pass through. **No configuration key supplies that list
today**, so a credential shaped unlike every pattern above is not caught.

> The pattern set is a security floor, not a classifier. It will not detect a
> password that looks like an ordinary word, a customer identifier, or a
> proprietary token format. If your repository must not leave the machine, run
> with no provider configured.

Because redaction can *lengthen* text (a short secret becomes `[REDACTED]`),
redacted finding titles, descriptions and fix text are truncated back to their
schema limits so a redacted value can never break contract validation.

---

## The redacted config summary

```bash
npm run cli -- config validate
```

Output rules:

- Any key matching `authorization`, `header`, `token`, `secret`, `api key`,
  `password` or `credential` is printed as `[REDACTED]`.
- Every value nested under a `headers` object is `[REDACTED]`.
- `baseUrl` and `endpoint` are reduced to `scheme://host`, so credentials
  carried in a URL, plus any path or query, never reach stdout.
- Every remaining string is passed through the redactor.

---

## Logs and traces

Logging defaults to `silent`.

Logs **include**: run id, step names, timings, counts, error codes, provider id
and model name.

Logs **exclude**: raw source, prompt text, model raw responses, request and
response bodies, provider headers, environment values, tokens and secrets.

The observability recorder enforces this structurally rather than by
convention: attribute keys matching `content`, `prompt`, `source`, `snippet`,
`raw`, `output`, `response`, `header`, `environment`, `env`, `secret`, `token`,
`key`, `password` or `credential` are dropped before an event is recorded.

Raise the level for one run without persisting it:

```bash
npm run cli -- review --debug --log-file .codereviewer/review.log
```

`--log-file` appends JSONL and never truncates, so a failed run's log survives
the next invocation. Each invocation writes a `log-run-start` header line.

### OpenTelemetry

Disabled unless configured. Enabling it requires an endpoint:

```json
{
  "observability": {
    "openTelemetry": {
      "enabled": true,
      "endpoint": "https://otlp.example.com/v1/traces",
      "headers": { "x-api-key": "…" },
      "serviceName": "codereviewer"
    }
  }
}
```

- `endpoint` is required when `enabled` is true (validation error otherwise).
- Exporter packages (`@opentelemetry/sdk-trace-node`,
  `@opentelemetry/exporter-trace-otlp-http`) are optional and loaded only when
  telemetry is enabled; a missing package produces
  `opentelemetry_dependency_missing` with the install command.
- Header values are redacted in the config summary.
- There is **no content capture**. `security.captureContentTelemetry` accepts
  the literal `false` only; setting it to `true` fails validation.

---

## Artifacts

Everything is written under `<artifactDir>/<runId>/`. Treat the directory as
sensitive: it describes your source even though it contains no raw snippets by
default.

| Artifact | Contains | Notes |
| --- | --- | --- |
| `report.json` | Findings, rejected findings, decisions, run metadata | Every string is passed through the redactor before serialization |
| `report.md` | Human summary | User-controlled text escaped; `artifact-only` findings in their own section |
| `report.sarif` | Findings for a code-scanning tool | Treated as sensitive and untrusted output: no embedded source text, no local absolute paths, no command lines, no environment values, no user or machine names, no unsanitized Markdown/HTML |
| `run-summary.json` | Run id, timings, token usage, cost, warnings | |
| `context-ledger.json` | Include/skip/truncate decisions, byte counts, hashes, reasons | The provider-transfer audit trail |
| `shared-context.json` | Candidates, verdicts, admission decisions | Failed-task messages use stable sanitized strings, never raw provider messages or tool output |
| `observability.json` | No-content run events | |
| `error.json` | Normalized, redacted `code`, `message`, `category`, `recoverable` | Failed runs only |
| `review-comments*.json` | Comment drafts | Written locally; nothing is published |

Report filenames are fixed constants and are never derived from a finding
title. `.codereviewer/` generated output is git-ignored.

Fingerprints in reports and baselines are truncated hashes of category, path,
normalized title and the **anchor line text** — the hash, not the text, so no
source is disclosed by a baseline file.

---

## If a secret does end up in an artifact

1. Treat the run artifacts as compromised.
2. Delete the local run artifact directory.
3. Rotate the affected credential outside this tool. The tool never attempts
   automatic revocation.
4. Add a regression fixture to the redaction tests so the shape is covered.

See [secrets-and-credentials.md](secrets-and-credentials.md) for how
credentials reach the engine in the first place, and
[threat-model.md](threat-model.md) for the limits of all of this.
