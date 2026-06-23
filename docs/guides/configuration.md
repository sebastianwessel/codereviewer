# Configuration

Configuration is merged in this order:

1. Built-in defaults.
2. `.codereviewer/config.json` if present.
3. Process environment overrides.
4. Root `.env` if present.
5. CLI flags where a command supports them.

Provider secret variables such as `OPENAI_API_KEY` are read from the same
effective environment. A value in root `.env` overrides an exported shell value
for local review runs.

## Minimal Config

No config file is required for default validation:

```bash
npx tsx src/cli/main.ts config validate
```

## Example Config

```json
{
  "review": {
    "mode": "ci",
    "depth": "balanced",
    "baseRef": "main",
    "headRef": "HEAD"
  },
  "paths": {
    "include": ["src/**"],
    "exclude": [".git/**", "node_modules/**", "dist/**", "coverage/**", ".codereviewer/**"],
    "artifactDir": ".codereviewer/runs"
  },
  "instructions": {
    "files": ["docs/reviewer-instructions.md"],
    "inline": "Prioritize correctness, security, and evidence quality."
  },
  "security": {
    "allowShell": false,
    "allowNetwork": false,
    "allowFilesystemWrite": false,
    "captureContentTelemetry": false
  }
}
```

## Defaults That Matter

| Area | Default |
| --- | --- |
| Review mode | `local` |
| Review depth | `balanced` |
| Base/head refs | `main` / `HEAD` |
| Max files | `500` |
| Max file bytes | `500000` |
| Provider task context bytes | `60000` / `120000` / `240000` (fast / balanced / thorough) unless `review.contextMaxBytes` is set |
| Artifact directory | `.codereviewer/runs` |
| Baseline | enabled |
| Report formats | JSON, Markdown, SARIF |
| Shell access | disabled |
| Content telemetry | disabled |
