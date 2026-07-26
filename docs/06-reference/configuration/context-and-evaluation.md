# `contextSources`, `evaluation`

External change-intent context ingestion, and the evaluation harness settings.

## `contextSources`

Ingests external change-intent (what the change is *supposed* to do) so the
reviewer can judge code against stated intent. Disabled by default; a disabled
block yields a review identical to one with no external context. All shipped
providers are filesystem-only — no network.

| Key | Type | Default | What it does |
| --- | --- | --- | --- |
| `contextSources.enabled` | boolean | `false` | Master switch. |
| `contextSources.providers` | array of provider objects | `[]` | See the union below. |
| `contextSources.summary.mode` | `"model"` \| `"digest"` | *unset* | When unset, resolved at runtime: `model` if a provider is configured, else `digest`. `model` runs a dedicated summarizer call and falls back to `digest` if that call fails; `digest` is fully deterministic. |
| `contextSources.summary.maxBytes` | integer 256–20000 | `4000` | Byte cap on the change-intent brief injected into review packets. |

### Context-provider union

Discriminated on `type`. Exactly two members are accepted; an unknown `type` or
a missing required key fails validation with exit `2`. The network providers
(`platform`, `mcp`) are later phases and are not accepted yet.

| `type` | Key | Type | Default |
| --- | --- | --- | --- |
| `"inbox"` | `dir` | repository-relative path | `".codereviewer/context"` |
| | `maxFiles` | integer 1–200 | `20` |
| | `maxFileBytes` | integer 1–1000000 | `64000` |
| `"changed-files"` | `include` | glob[] (min 1 entry) | `["**/*.md"]` |
| | `maxFiles` | integer 1–200 | `20` |
| | `maxFileBytes` | integer 1–1000000 | `64000` |

- `inbox` reads frontmatter-markdown context files a pipeline wrote into `dir`
  before the run.
- `changed-files` surfaces PR-changed repository files matching `include` (for
  example changed specs or docs that explain the code change).

```json
{
  "contextSources": {
    "enabled": true,
    "providers": [
      { "type": "changed-files", "include": ["specs/**", "docs/**"] },
      { "type": "inbox", "dir": ".codereviewer/context" }
    ],
    "summary": { "mode": "digest", "maxBytes": 4000 }
  }
}
```

Ingested context is **untrusted input**. It informs the review but cannot change
scope, severity, admission, the baseline, or the gate. A provider that fails at
run time is non-fatal and surfaces as a run warning.

## `evaluation`

| Key | Type | Default | What it does |
| --- | --- | --- | --- |
| `evaluation.enabled` | boolean | `false` | Present in the schema; the CLI eval path does not read it — case selection is driven by `eval run` flags instead. |
| `evaluation.minJudgeAgreement` | number 0–1 | `0.9` | Minimum semantic-judge agreement against the committed calibration set. The judge is the sole authority for every eval quality metric, so a run below this bar reports `scoring.judgeTrustworthy = false`. It marks metrics untrustworthy — **it does not fail the regression gate**. |

### The `eval run` regression gate is not configurable

`minJudgeAgreement` is the only evaluation knob the CLI honors. The regression
thresholds themselves are hard-coded in `src/cli/index.ts` — 100 % parse
validity, 100 % recall, zero false positives, fail on provider error — and there
are no flags to change them. Expect `eval run` to exit `1` on essentially any
provider-backed benchmark run and read the metrics from the artifacts instead.
Details in [cli.md](../cli.md#the-regression-gate-is-hard-coded).

## Related

- [security-and-verification.md](./security-and-verification.md) — the claim-provider union, the other untrusted-input surface
- [Artifacts](../artifacts.md) — eval artifact layout under `.codereviewer/eval/`
- [CLI reference](../cli.md) — `eval run`, `eval compare`, `eval recall-report`, `eval slice-manifest`
