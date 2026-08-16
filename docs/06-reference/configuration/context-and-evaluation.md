# `contextSources`, `evaluation`

External change-intent context ingestion, and the evaluation harness settings.

## `contextSources`

Ingests external change-intent (what the change is *supposed* to do) so the
reviewer can judge code against stated intent. Enabled by default, with two
providers configured out of the box (below); a disabled block yields a review
identical to one with no external context. All shipped providers are
filesystem-only — no network.

Both default providers no-op silently when their input is absent: an
`inbox` directory that does not exist, or no changed file matching
`changed-files`' globs, is a review with no intent brief, not an error. That
property is what makes the zero-config default work — an ordinary repository
with no `.codereviewer/context` directory and no changed Markdown sees plain
"no intent" warnings (below), not failures.

| Key | Type | Default | What it does |
| --- | --- | --- | --- |
| `contextSources.enabled` | boolean | `true` | Master switch. |
| `contextSources.providers` | array of provider objects | see below <!-- no-literal-default the default is two fully populated provider objects; their keys and per-key defaults are the context-provider union table below --> | See the union below. |
| `contextSources.summary.mode` | `"model"` \| `"digest"` | *unset* | When unset, resolved at runtime from whether a **model provider** (`provider`) is configured — not from `contextSources.providers`, which now always has entries. With one: `model`, a dedicated summarizer call that falls back to `digest` if it fails. Without one: `digest`, fully deterministic. |
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

`contextSources.providers` itself defaults to both providers at their own
defaults — `{ "type": "inbox" }` reading `.codereviewer/context`, plus
`{ "type": "changed-files" }` matching `**/*.md` — so a zero-config run already
picks up an inbox directory or a changed Markdown file if either exists.
Setting `providers` explicitly **replaces** that pair rather than adding to it.
The example below is deployment-specific — it narrows `changed-files` to
`specs/**` and `docs/**` instead of every Markdown file, which only makes sense
to write once you know what a project's intent documents actually live under:

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
in one of three wordings, because they call for different actions:

- *"…failed and was skipped."* — the provider errored.
- *"…found no change-intent source, so the review ran without one."* — the
  provider ran and matched nothing: no inbox directory, no changed file matching
  its `include` globs. With both providers on by default, **this is the
  ordinary result on a repository with no written intent for the change** — it
  is not an error or a misconfiguration, and must not be read as one. A
  mistyped `dir` produces exactly the same shape, which is why the warning
  still says to check where the provider points if content was expected. This
  case used to be silent: a misconfigured source was indistinguishable from one
  that was never configured, and the review ran with no change-intent context
  and said so nowhere.
- *"…matched N sources but none carried usable text, so the review ran without
  them."* — the provider found sources and none of them had a body below their
  frontmatter. Genuinely odd, since something did match.

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
| `evaluation.judgeModel` | string | *unset* | Model the two `eval run` judges (semantic match + plausibility) score with. Unset, they use `provider.model` — the reviewer's own. Environment: `CODEREVIEWER_JUDGE_MODEL`. |
| `evaluation.regressionGate.profile` | `"stable"` \| `"strict"` | `"stable"` | Which threshold set `eval run` gates on. Overridable per run with `eval run --gate-profile`. |
| `evaluation.regressionGate.overrides` | object | `{}` <!-- covers-subtree every override key is optional with no default of its own; the value each one takes when unset comes from the resolved profile, so they are documented as the threshold table and prose under "The eval run regression gate" rather than as thirteen rows of *unset* --> | Per-threshold values layered on top of the resolved profile. Any key set here wins over the profile's value for the same key. |

There is deliberately no `evaluation.enabled` key: case selection is driven by
`eval run` CLI flags, not config, so an `enabled` flag would have been accepted
and then silently ignored.

### Pin the judge when you compare models

`evaluation.judgeModel` exists for one job: comparing two reviewer models without
the scorer moving with them. Both judges used to be built from the reviewer's
resolved model, so setting `CODEREVIEWER_PROVIDER_MODEL` per arm swapped the ruler
too, and a recall difference could mean either a weaker reviewer or a weaker judge
crediting fewer of its correct findings. That comparison cannot be read, and no
number of seeds fixes it.

```json
{
  "evaluation": { "judgeModel": "a-fixed-judge-model" }
}
```

Vary `CODEREVIEWER_PROVIDER_MODEL` per arm; keep `evaluation.judgeModel` (or
`CODEREVIEWER_JUDGE_MODEL`) at one value across both. It overrides the model only
— provider id, credentials, base URL, retry and timeout stay the run's own — and
it changes nothing in the review workflow itself. `scoringCostUsd` is then priced
against the judge's model, since those are the tokens it spent; review cost is
untouched.

Every report records `provenance.judgeModelName` next to `provenance.modelName`
(the reviewer's), whether or not the judge was pinned, so an archived run can name
the judge that scored it. **Publish the judge model with any model comparison** —
see `specs/06-evaluation-and-quality-gates.md`, *The Judge Must Be Pinnable
Independently Of The Reviewer*.

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
