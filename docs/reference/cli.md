# CLI Reference

Complete reference for every command exposed by the CodeReviewer CLI. Each
command is stateless and one-shot: nothing is persisted beyond the redacted
run artifacts in `paths.artifactDir`.

> **Note:** Commands below assume the installed `codereviewer` binary (from
> `npm install -g @sebastianwessel/codereviewer`). You can also run it without
> installing via `npx @sebastianwessel/codereviewer …`.

---

## `config validate`

Validates and prints the effective configuration for the current repository.

### Synopsis

```bash
codereviewer config validate [--config path/to/config.json]
```

### Flags

| Flag | Description |
| --- | --- |
| `--config <path>` | Path to an explicit config file (overrides default `.codereviewer/config.json` lookup). |

### What it does

Merges all configuration layers (built-in defaults → `.codereviewer/config.json`
→ process env → `.env` → CLI flags), validates the result with Zod, and
prints a **redacted** normalized config summary. Secrets are never printed.

### Example

```bash
codereviewer config validate --config .codereviewer/config.json
```

---

## `review`

Runs a full review pipeline: repository intake, deterministic support-signal
extraction, holistic discovery and refutation (when a provider is configured),
admission, quality gates, and report rendering.

### Synopsis

```bash
codereviewer review \
  [--file path/to/file.ts] \
  [--base-ref main --head-ref HEAD] \
  [--debug] \
  [--log-level trace|debug|info|warn|error|fatal|silent] \
  [--log-file .codereviewer/review.log]
```

### Flags

| Flag | Description |
| --- | --- |
| `--file <path>` | Review this file instead of the git diff. Repeat for multiple files. |
| `--base-ref <ref>` | Base git ref for the diff (default from config). |
| `--head-ref <ref>` | Head git ref for the diff (default from config). |
| `--debug` | Emit no-content stage logs to the console while the run is active. |
| `--log-level <level>` | Explicit log level: `trace`, `debug`, `info`, `warn`, `error`, `fatal`, or `silent`. |
| `--log-file <path>` | Write newline-delimited JSON logs to a repository-relative file (appended, not truncated). |

### Behavior notes

- Use `--file` one or more times for a focused local review. Without explicit
  files the command reviews the configured git diff.
- `--log-file` appends to the file; each run begins with a `log-run-start`
  JSON header line so individual runs remain identifiable within a shared log.
- Logs include stage names, counts, run IDs, provider/model IDs, token totals,
  and redacted error codes. They **never** include source snippets, prompts,
  request/response bodies, provider headers, environment values, tokens, or
  secrets.
- Review runs are stateless and one-shot. A failed run writes partial artifacts
  for inspection; rerun the command to review again from scratch.

### Example

```bash
# Review the diff between main and HEAD
codereviewer review --base-ref main --head-ref HEAD

# Review two specific files with debug output
codereviewer review \
  --file src/auth/login.ts \
  --file src/auth/session.ts \
  --debug
```

See [Artifacts Reference](artifacts.md) for the output files written to
`paths.artifactDir`, and [Exit Codes](exit-codes.md) for how to interpret the
command's exit status.

> **Note:** Evaluation/benchmark commands (`eval run`, `eval compare`,
> `eval recall-report`, `eval slice-manifest`) run from a cloned repository —
> see [Evaluation](../evaluation/README.md).

---

## `drift check`

Runs deterministic local consistency checks across the repository.

### Synopsis

```bash
codereviewer drift check
```

### What it checks

- Docs/specs drift
- Generated schema drift
- Security-sensitive stale paths
- Undocumented or unimplemented CLI commands (implementation drift)
- Ambiguous requirements

### Exit behavior

| Result | Exit code |
| --- | --- |
| Warnings only | `0` |
| Hard drift category present | `1` |
| Config/path error | `2` |

Default hard categories are `generated-artifact-drift` and `security-drift`.
Ambiguity is a warning by default; it can be promoted to a hard category via
`drift.failOn` in [Configuration Reference](configuration.md#drift).

### Example

```bash
codereviewer drift check
```
