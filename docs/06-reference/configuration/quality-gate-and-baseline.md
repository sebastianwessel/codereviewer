# `qualityGate`, `baseline`, `drift`

The three blocks that decide whether a run exits `0` or `1`.

## `qualityGate`

Evaluated over **admitted** findings after baseline filtering.

| Key | Type | Default | What it does |
| --- | --- | --- | --- |
| `qualityGate.maxCritical` | integer ≥ 0 | `0` | Maximum tolerated `critical` findings. |
| `qualityGate.maxHigh` | integer ≥ 0 | `0` | Maximum tolerated `high` findings. |
| `qualityGate.maxMedium` | integer ≥ 0 | *unset* | Maximum tolerated `medium` findings. Unset means medium findings never fail the gate. |
| `qualityGate.failOnProviderError` | boolean | **`true`** | When `true`, an unrecovered provider issue fails the gate — with an empty `failingFindingIds`, since the failure is that findings are missing rather than present. An issue with no `recovered` field counts as unrecovered. Setting `false` turns the check off and changes nothing else. |
| `qualityGate.failOnNewOnly` | boolean | *unset* | When unset, resolves at runtime to `baseline.failOnNewOnly` (which itself defaults to `true`). Set explicitly to decouple the gate from baseline reporting. |

There is no `maxLow` or `maxInfo` key. Low/info model findings are normally
rejected before the gate by
[`aiReview.actionableSeverityThreshold`](./review.md#aireview).

A failed quality gate is a **completion signal, not a crash**: `review` exits `1`
and still writes the complete artifact set.

## `baseline`

| Key | Type | Default | What it does |
| --- | --- | --- | --- |
| `baseline.enabled` | boolean | `true` | Enables baseline matching by admitted-finding fingerprint (never by title alone). |
| `baseline.path` | repository-relative path | `".codereviewer/baseline.json"` | Baseline file location. **Outside `paths.artifactDir`** — it is user-owned state, not a run artifact. |
| `baseline.failOnNewOnly` | boolean | `true` | Only findings not present in the baseline can fail the gate. |
| `baseline.includeResolvedInReport` | boolean | `true` | Emits `resolvedBaselineEntries` (baseline entries no longer reproduced) in `report.json`. |

Behavior notes:

- a missing baseline file is treated as an empty baseline; the warning
  `baseline-missing` is emitted **only** when the user explicitly configured
  `baseline.path` or `baseline.enabled`;
- when a baseline is explicitly configured but the file is missing, admitted
  findings are marked `unknown` and treated as new for `failOnNewOnly`;
- write or refresh the file with
  [`codereviewer baseline write`](../cli.md#codereviewer-baseline-write).

## `drift`

Documentation/spec/implementation drift checks, run by `drift check` and as
review preflight.

| Key | Type | Default | What it does |
| --- | --- | --- | --- |
| `drift.enabled` | boolean | `true` | Master switch for drift checking. |
| `drift.failOn` | drift category[] | `["generated-artifact-drift", "security-drift"]` | Categories that fail with exit `1` (`drift_gate_failed`) when findings exist. Categories not listed are reported as non-blocking warnings. |
| `drift.includeDocs` | boolean | `true` | Include documentation sources in the check. |
| `drift.includeSpecs` | boolean | `true` | Include specs in the check. |
| `drift.includeGenerated` | boolean | `true` | Include generated artifacts in the check. |

Drift categories accepted in `failOn`:

| Category | Blocking by default |
| --- | --- |
| `documentation-drift` | no |
| `spec-drift` | no |
| `implementation-drift` | no |
| `generated-artifact-drift` | **yes** |
| `ambiguity` | no |
| `security-drift` | **yes** |

## Related

- [review.md](./review.md) — the severity floor that decides what reaches the gate
- [Exit codes and error codes](../exit-codes-and-error-codes.md)
- [Artifacts](../artifacts.md) — `report.json` `qualityGate` block
