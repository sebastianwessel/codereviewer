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
scope, severity, admission, the baseline, or the gate.

A provider that does not contribute is non-fatal and surfaces as a run warning,
in one of two wordings, because the two call for different actions:

- *"…failed and was skipped."* — the provider errored.
- *"…produced nothing and was skipped. Check that it points at content this
  change has."* — the provider worked and had nothing to give. An empty inbox, a
  mistyped `dir`, or `include` globs no changed file matches all land here. This
  case used to be silent: a misconfigured source was indistinguishable from one
  that was never configured, and the review ran with no change-intent context and
  said so nowhere.

A provider that contributes only **part** of what it matched warns as well, once
per bound that actually bound:

- *"…matched N files but contributed M; K were dropped…"* — `maxFiles` cut the
  file list. The kept files are the first ones in provider order (diff order for
  `changed-files`, filename order for `inbox`), which is stable but is not a
  relevance ranking: `PROJ-1010.md` sorts before `PROJ-99.md`.
- *"…cut N of M files at its maxFileBytes cap…"* — the review sees the beginning
  of each of those files, not the whole. Acceptance criteria stated at the end of
  a long ticket are the usual casualty.

Both bounds are applied by discarding content, so nothing measured afterwards can
detect them: a truncated body is by construction small enough to fit every later
budget. Without these warnings a run that read a tenth of the stated intent
reported the same counts as one that read all of it.

## `evaluation`

| Key | Type | Default | What it does |
| --- | --- | --- | --- |
| `evaluation.minJudgeAgreement` | number 0–1 | `0.9` | Minimum semantic-judge agreement against the committed calibration set. The judge is the sole authority for every eval quality metric, so a run below this bar reports `scoring.judgeTrustworthy = false`. It marks metrics untrustworthy — **it does not fail the regression gate**. |
| `evaluation.regressionGate.profile` | `"stable"` \| `"strict"` | `"stable"` | Which threshold set `eval run` gates on. Overridable per run with `eval run --gate-profile`. |
| `evaluation.regressionGate.overrides` | object | `{}` | Per-threshold values layered on top of the resolved profile. Any key set here wins over the profile's value for the same key. |

There is deliberately no `evaluation.enabled` key: case selection is driven by
`eval run` CLI flags, not config, so an `enabled` flag would have been accepted
and then silently ignored.

### The `eval run` regression gate

The gate is a **profile** plus per-threshold overrides. Both are configuration;
the profile is also a CLI flag.

| Threshold | `stable` (default) | `strict` |
| --- | --- | --- |
| `minParseValidity` | `1` | `1` |
| `failOnProviderError` | `true` | `true` |
| `minRecall` | *not gated* | `1` |
| `maxFalsePositiveCount` | *not gated* | `0` |

`stable` gates only on signals with no run-to-run sampling variance: output
either parsed or it did not, a provider call either errored or it did not.
It deliberately does not gate on recall or on the raw false-positive count.
Recall is a mean over a non-deterministic run, and the raw false-positive count
includes real defects the answer key never listed — gating on either by default
made a non-zero exit the normal outcome of every run, and a signal that always
fires carries no information.

`strict` is the older all-or-nothing bar, kept as a named opt-in for a maintainer
who has verified perfect recall holds for their own fixture set.

`overrides` accepts every key of the threshold contract, not just the four above:
`minPrecision`, `minSeverityWeightedF1`, `minProductRecall`, `maxCommentsPerKloc`,
`maxCommentsPerDiffHunk`, `maxIncompleteCoverageRate`, `maxContextMutationRate`,
`maxCostUsd`, `maxDurationMs`, plus the four profile keys. Set one to tighten a
single signal without leaving the `stable` shape:

```json
{
  "evaluation": {
    "regressionGate": {
      "profile": "stable",
      "overrides": { "minProductRecall": 0.4 }
    }
  }
}
```

Details in [cli.md](../cli.md#the-regression-gate-has-two-profiles).

## Related

- [security-and-verification.md](./security-and-verification.md) — the claim-provider union, the other untrusted-input surface
- [Artifacts](../artifacts.md) — eval artifact layout under `.codereviewer/eval/`
- [CLI reference](../cli.md) — `eval run`, `eval compare`, `eval recall-report`, `eval slice-manifest`
