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

A minimal config only needs what you want to override. Below is a fuller
`.codereviewer/config.json` showing every major block (unknown keys are
rejected, so use only documented keys — see the
[configuration reference](../reference/configuration.md)):

```json
{
  "review": {
    "mode": "ci",
    "depth": "balanced",
    "baseRef": "main",
    "headRef": "HEAD",
    "maxConcurrentTasks": 4,
    "inlineSeverityThreshold": "high"
  },
  "provider": {
    "id": "openai",
    "model": "gpt-5.3-codex",
    "maxRetries": 2
  },
  "aiReview": {
    "intentPlanning": "auto",
    "deterministicSignalMode": "support",
    "judgeFindings": false,
    "actionableSeverityThreshold": "medium"
  },
  "promotionPolicy": {
    "modelProof": "actionable",
    "modelWeakOrRefuted": "artifact-only"
  },
  "paths": {
    "include": ["src/**"],
    "exclude": [
      ".git/**", "node_modules/**", "dist/**", "coverage/**", ".codereviewer/**",
      "**/package-lock.json", "**/yarn.lock", "**/pnpm-lock.yaml", "**/npm-shrinkwrap.json",
      "**/composer.lock", "**/Gemfile.lock", "**/poetry.lock", "**/Cargo.lock", "**/go.sum",
      "**/*.min.js", "**/*.min.css", "**/*.map", "**/*.snap"
    ],
    "artifactDir": ".codereviewer/runs"
  },
  "instructions": {
    "files": ["docs/reviewer-instructions.md"],
    "inline": "Prioritize correctness, security, and evidence quality."
  },
  "baseline": {
    "enabled": true,
    "failOnNewOnly": true
  },
  "qualityGate": {
    "maxCritical": 0,
    "maxHigh": 0,
    "failOnProviderError": true
  },
  "reporting": {
    "formats": ["json", "markdown", "sarif", "github-review-comments"]
  },
  "security": {
    "allowShell": false,
    "allowNetwork": false,
    "allowFilesystemWrite": false,
    "captureContentTelemetry": false
  }
}
```

Notes:

- `provider` is required only for model-backed review; omit it for providerless
  deterministic-signal review. Secrets come from the environment, never this file.
- `aiReview.actionableSeverityThreshold` (default `medium`) keeps low-severity
  model nits out of actionable output; `review.inlineSeverityThreshold` (default
  `high`) controls which actionable findings become inline PR comments.
- `aiReview.judgeFindings` enables the optional strict critic pass (extra cost,
  off by default). `aiReview.deterministicSignalMode` controls whether
  deterministic facts are injected into model context (`support`, recommended) or
  only used for clustering (`disabled`, cheaper).
- For reasoning models you may add `"reasoningEffort": "medium"` under `provider`
  (high is not recommended — higher cost/latency without better recall).

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
