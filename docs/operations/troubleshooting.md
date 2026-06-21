# Troubleshooting

| Symptom | Likely Cause | Next Action |
| --- | --- | --- |
| `config_error` | Invalid config or unsafe ref/path. | Run `config validate` and check the reported field. |
| Provider adapter missing | Optional provider peer package is not installed. | Install the selected provider package. |
| Exit code `1` from review | Quality gate failed. | Inspect `.review/runs/<run-id>/report.md`. |
| Exit code `4` with `artifactDir` | Provider failed after task execution started. | Inspect `error.json` and `shared-context.json` in the reported artifact directory, then reduce scope or adjust provider settings. |
| Missing artifacts | Command failed before reporting or artifact dir changed. | Check stderr and `paths.artifactDir`. |
| Windows path rejected | Absolute or traversal path used in repository config. | Use repository-relative paths with no drive letter. |

## Useful Checks

```bash
npm run typecheck
npm test
npx tsx src/cli/main.ts config validate
```

If provider credentials are involved, verify `.env` or CI secrets without
printing secret values.
