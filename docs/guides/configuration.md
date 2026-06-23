# Configuration

CodeReviewer builds its effective configuration by merging sources in
lowest-to-highest precedence order, so any value can be overridden at the right
layer without touching other settings.

---

## Precedence order

1. Built-in defaults.
2. `.codereviewer/config.json` (project config file, if present).
3. Process environment variables.
4. Root `.env` file (if present).
5. CLI flags (where a command supports them).

Provider secret variables such as `OPENAI_API_KEY` are read from the same
effective environment. A value in root `.env` overrides an exported shell value
for local review runs.

---

## Validate the current config

No config file is required. To confirm the built-in defaults are valid:

```bash
codereviewer config validate
```

---

## Annotated example

A minimal config only needs what you want to override. The example below shows
every major block. Unknown keys are rejected — use only documented keys (see the
[configuration reference](../reference/configuration.md)).

```jsonc
{
  // ── Review behaviour ──────────────────────────────────────────────────────
  "review": {
    "mode": "ci",                       // "local" | "ci" | "pr"
    "depth": "balanced",                // "fast" | "balanced" | "thorough"
    "baseRef": "main",
    "headRef": "HEAD",
    "maxConcurrentTasks": 4,
    "inlineSeverityThreshold": "high"   // findings below this are summary-only
  },

  // ── Model provider ────────────────────────────────────────────────────────
  "provider": {
    "id": "openai",
    "model": "gpt-5.3-codex",
    "maxRetries": 2
    // Secrets come from the environment, never this file.
  },

  // ── AI review pipeline ────────────────────────────────────────────────────
  "aiReview": {
    "intentPlanning": "auto",              // "auto" | "deterministic" | "model"
    "deterministicSignalMode": "support",  // "support" | "disabled"
    "judgeFindings": false,                // opt-in strict critic pass
    "actionableSeverityThreshold": "medium"
  },

  // ── Promotion policy ──────────────────────────────────────────────────────
  "promotionPolicy": {
    "modelProof": "actionable",
    "modelWeakOrRefuted": "artifact-only"
  },

  // ── Path filters ──────────────────────────────────────────────────────────
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

  // ── Custom reviewer instructions ──────────────────────────────────────────
  "instructions": {
    "files": ["docs/reviewer-instructions.md"],
    "inline": "Prioritize correctness, security, and evidence quality."
  },

  // ── Baseline tracking ─────────────────────────────────────────────────────
  "baseline": {
    "enabled": true,
    "failOnNewOnly": true
  },

  // ── Quality gate ──────────────────────────────────────────────────────────
  "qualityGate": {
    "maxCritical": 0,
    "maxHigh": 0,
    "failOnProviderError": true
  },

  // ── Report formats ────────────────────────────────────────────────────────
  "reporting": {
    "formats": ["json", "markdown", "sarif", "github-review-comments"]
  },

  // ── Security constraints ──────────────────────────────────────────────────
  "security": {
    "allowShell": false,
    "allowNetwork": false,
    "allowFilesystemWrite": false,
    "captureContentTelemetry": false
  }
}
```

---

## Key option notes

### Provider block

- `provider` is required only for model-backed review. Omit it entirely for
  providerless deterministic-signal review.
- Secrets (API keys, credentials) must come from the environment — never from
  this file.
- For reasoning models, add `"reasoningEffort": "medium"` under `provider`.
  `"high"` is not recommended — it increases cost and latency without improving
  product recall.

### Severity thresholds

| Option | Default | Effect |
| --- | --- | --- |
| `aiReview.actionableSeverityThreshold` | `medium` | Model findings below this severity are recorded but not actionable. |
| `review.inlineSeverityThreshold` | `high` | Actionable findings below this severity appear in summary only, not as inline PR comments. |

### Judge pass (`aiReview.judgeFindings`)

Disabled by default. When enabled, adds a strict per-candidate critic pass
after the refutation gate, re-checking proved model candidates before admission.
This adds provider cost and latency. Enable it for high-stakes runs where
false-positive precision matters more than throughput.

### Deterministic signals (`aiReview.deterministicSignalMode`)

| Value | Behaviour |
| --- | --- |
| `support` | Facts (imports, declarations, symbols) are injected into model context. Recommended. |
| `disabled` | Facts are used only for file clustering — cheaper, lower recall. |

---

## Defaults that matter

| Area | Default |
| --- | --- |
| Review mode | `local` |
| Review depth | `balanced` |
| Base / head refs | `main` / `HEAD` |
| Max files | `500` |
| Max file bytes | `500000` |
| Provider task context bytes | `60 000` / `120 000` / `240 000` (fast / balanced / thorough) unless `review.contextMaxBytes` is set |
| Artifact directory | `.codereviewer/runs` |
| Baseline | enabled |
| Report formats | JSON, Markdown, SARIF |
| Shell access | disabled |
| Content telemetry | disabled |

---

## Related docs

- [Configuration reference](../reference/configuration.md) — full key/value
  reference with all allowed values and types.
- [Providers guide](providers.md) — provider-specific config and credentials.
- [Instructions and skills](instructions-and-skills.md) — custom reviewer
  instructions and mounted skill folders.
- [Reports and artifacts](reports-and-artifacts.md) — what the run writes and
  where.
