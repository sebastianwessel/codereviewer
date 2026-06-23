# Troubleshooting

Symptoms you may hit when running a review, their likely cause, and the next action to take.

This page lists common errors and exit codes, the provider error codes the engine reports, and a few quick checks to run when diagnosing a failed run.

---

## Common Symptoms

| Symptom | Likely Cause | Next Action |
| --- | --- | --- |
| `config_error` | Invalid config or unsafe ref/path. | Run `config validate` and check the reported field. |
| Provider adapter missing | Optional provider peer package is not installed. | Install the selected provider package. |
| Exit code `1` from review | Quality gate failed. | Inspect `.codereviewer/runs/<run-id>/report.md`. |
| Exit code `4` with `artifactDir` | Provider failed after task execution started. | Inspect `error.json` and `shared-context.json` in the reported artifact directory, then reduce scope or adjust provider settings. |
| Missing artifacts | Command failed before reporting or artifact dir changed. | Check stderr and `paths.artifactDir`. |
| Windows path rejected | Absolute or traversal path used in repository config. | Use repository-relative paths with no drive letter. |

---

## Provider Error Codes

These codes appear in the run error output. Each maps to a provider-side
condition and a recommended response:

| Code | Cause | Next Action |
| --- | --- | --- |
| `provider_rate_limited` | Provider returned HTTP 429 or an overloaded/rate-limit message. | Wait and retry, or reduce `review.maxConcurrentTasks`. |
| `provider_auth` | Provider returned HTTP 401/403 or an API-key/unauthorized message. | Verify credentials in `.env` or CI secrets. |
| `provider_context_length` | Request exceeded the model context window. | Reduce `review.maxFiles`, `review.maxFileBytes`, or context budget settings. |
| `provider_server_error` | Provider returned HTTP 5xx. | Retry; if persistent, check provider status page. |
| `provider_error` | Provider-side failure not matched by the codes above. | Check provider status page and review model/config settings. |
| `provider_timeout` | Request timed out. | Increase `provider.timeoutMs` or reduce task scope. |
| `provider_cancelled` | Request was aborted or cancelled. | Check for run timeout (`review.runTimeoutMs`) or explicit cancellation. |

---

## Useful Checks

Run these to confirm the toolchain and config before retrying a review:

```bash
npm run typecheck
npm test
npx tsx src/cli/main.ts config validate
```

> **Tip:** If provider credentials are involved, verify `.env` or CI secrets
> without printing secret values.

---

## See also

- [Exit codes](../reference/exit-codes.md)
- [Secrets and env](../security/secrets-and-env.md)
- [Providers](../guides/providers.md)
