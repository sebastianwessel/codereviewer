# Exit Codes

| Code | Meaning |
| --- | --- |
| `0` | Command completed and configured gate passed. |
| `1` | Command completed and a review or regression gate failed. |
| `2` | Configuration, provider setup, credential, path, or usage error. |
| `3` | Repository intake or filesystem error. |
| `4` | Provider/model runtime error. |
| `5` | Internal invariant or report error. |

Use exit code `1` as a meaningful quality signal, not a crash signal.

When exit code `4` includes `artifactDir` in stderr, the run reached task
execution and wrote partial artifacts for diagnosis.
