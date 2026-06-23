# Exit Codes

Reference for all exit codes emitted by the CodeReviewer CLI. Each code
signals a distinct outcome category so CI pipelines can respond precisely.

---

## Code table

| Code | Meaning |
| --- | --- |
| `0` | Command completed and the configured gate passed. |
| `1` | Command completed and a review or regression gate **failed**. |
| `2` | Configuration, provider setup, credential, path, or usage error. |
| `3` | Repository intake or filesystem error. |
| `4` | Provider/model runtime error. |
| `5` | Internal invariant or report error. |

> **Note:** Exit code `1` is a meaningful **quality signal**, not a crash
> signal. Use it to fail CI on gate violations while treating codes `2`–`5` as
> infrastructure or configuration problems.

---

## Code `1` — gate failed

Exit code `1` is returned when the command ran to completion but a quality gate
or regression gate threshold was not met. Examples:

- `qualityGate.maxCritical` or `qualityGate.maxHigh` exceeded.
- An eval regression threshold (`minProductRecall`, `maxFalsePositiveCount`,
  etc.) was not met.
- `drift check` encountered a hard drift category.

See [Configuration Reference — qualityGate](configuration.md#qualitygate) and
[Configuration Reference — evaluation](configuration.md#evaluation) for how
to tune thresholds.

---

## Code `4` — provider/model runtime error

When exit code `4` is returned **and** the path to `paths.artifactDir` appears
in stderr, the run reached task execution and wrote **partial artifacts** for
diagnosis:

```text
.codereviewer/runs/<run-id>/run-summary.json
.codereviewer/runs/<run-id>/context-ledger.json
.codereviewer/runs/<run-id>/shared-context.json
.codereviewer/runs/<run-id>/observability.json
.codereviewer/runs/<run-id>/error.json
```

Rerun the `review` command to start a fresh review from scratch. See
[Artifacts Reference — partial-failure artifacts](artifacts.md#partial-failure-artifacts)
for details on what each file contains.
