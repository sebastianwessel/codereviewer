# Permissions and Path Containment

Two deterministic controls carry most of the security weight: a deny-by-default
permission model, and a path service that every filesystem operation goes
through.

---

## The permission model

Permissions are declarations, not switches you can flip.

| Capability | Default | What actually ships |
| --- | --- | --- |
| Repository read | allowed | Required for review. |
| Filesystem write | restricted | Only under the configured artifact directory. |
| Shell execution | denied | No shell string is ever constructed anywhere. |
| Network | provider only | The single configured provider endpoint, for review calls and the change-intent summarizer. Nothing else. |
| Pull-request publishing | denied | The engine renders comment drafts to disk; it posts nothing. |
| Fix application | denied | The fix lane produces advisory metadata only; it edits no file. |

The corresponding config keys are typed as the literal `false`:

```
security.allowShell              false
security.allowNetwork            false
security.allowFilesystemWrite    false
security.captureContentTelemetry false
```

Setting any of them to `true` is a **schema validation error**, exit code `2`:

```bash
npm run cli -- config validate
```

There is no override flag, no environment variable, and no escalation path.
Granting any of these requires a spec change and a code change, by design.

There is no `security.signals` key: the deterministic security-signal evidence
layer has no implementation, and the block is strict, so a config that still sets
it fails validation with exit code `2`. It ships alongside the layer, not before
it. `security.dedicatedPass` is a review-quality option, not a permission — it
adds a security-focused discovery call and grants no new capability.

---

## Path containment

Everything with a path goes through `src/platform/path-service.ts`: the config
file, the artifact directory, the baseline file, instruction files, skill
directories, explicit review files, eval fixtures, log files, and every mediated
tool read.

### Three resolution modes

| Function | Used for | Guarantee |
| --- | --- | --- |
| `resolvePathInsideRoot` | Any repository-relative path | Rejects NUL bytes, empty/whitespace paths, absolute paths (POSIX and Windows), and anything that resolves outside the root. |
| `resolveExistingPathInsideRoot` | Reads | Everything above, plus `realpath` on the root and the target: a symlink whose target lands outside the root is rejected. |
| `resolveWritePathInsideRoot` | Writes | Everything above, plus `realpath` on the nearest **existing** ancestor of the destination, and an `lstat` check that refuses to write through a symlink. |

### What is rejected

| Input | Result |
| --- | --- |
| `../../etc/passwd` | `Path value must resolve inside the root.` |
| `/etc/passwd` | `Path value must be relative to the root.` |
| `C:\Windows\system32` | `Path value must be relative to the root.` (POSIX and Windows path APIs are both applied) |
| `file\u0000.ts` | `Path value must not contain NUL bytes.` |
| `""` or `"   "` | `Path value must not be empty.` |
| A symlink pointing outside the root | `Path target must resolve inside the root.` |
| A write destination that is a symlink | `Write path target must not be a symlink.` |
| A write whose parent chain resolves outside the root | `Write path parent must resolve inside the root.` |

Path handling is Windows- and POSIX-aware: normalization uses the platform's
`node:path` flavor, and repository-facing identifiers (report paths, SARIF
URIs, git paths) are converted to portable `/`-separated form.

The repository root itself is `process.cwd()` at CLI entry. Nothing in
configuration can move it above where the process was started.

### Config keys that are path-validated at the schema level

`paths.artifactDir`, `baseline.path`, `instructions.files[]`,
`skills.directories[]`, `contextSources` provider `dir`, `verification`
provider `path`/`report` and eval fixture paths all use the
repository-relative path schema, which rejects NUL bytes, leading `/`, Windows
drive prefixes and `..` segments **before** any IO is attempted.

---

## Git containment

There is no generic git runner exposed to configuration, plugins or model
output. Exactly three read-only command shapes are allowlisted, matched on the
whole argument array rather than on a prefix, so no extra flag can be appended:

| Purpose | Shape |
| --- | --- |
| Divergence point | `git merge-base <baseRef> <headRef>` |
| Changed path discovery | `git diff --name-status <mergeBase> <headRef>` |
| Diff hunk map | `git diff --unified=0 <mergeBase> <headRef> -- <paths…>` |

Rules that come with it:

- Git refs must be non-empty and must not start with `-`, which blocks
  `--upload-pack`-style and `-c core.sshCommand=…` argument injection.
- File paths are validated by the path service and placed after `--`.
- Git runs through `execFile` argument arrays, never a shell.
- Errors are normalized and redacted; raw command output is not logged.
- No mutating subcommand exists in the product surface: no `reset`, `clean`,
  `checkout`, `switch`, `restore`, `commit`, `push`, `pull`, `fetch`, `merge`,
  `rebase`, `tag`, `worktree`, `submodule`, `config`, `remote`, `gc`,
  `maintenance`, or hook execution.

Two read-only git calls exist outside the review intake and are worth knowing
about: review-comment platform detection reads `git config --get
remote.origin.url` (local, no network), and evaluation-corpus hydration
performs depth-limited `git fetch` operations against explicitly pinned
upstream commits — an operator-run step, never part of a review.

---

## Write containment

Writes are allowed only below the configured artifact directory, after it
resolves under the repository root. In practice that means:

```
<artifactDir>/index.json
<artifactDir>/<runId>/report.json
<artifactDir>/<runId>/report.md
<artifactDir>/<runId>/report.sarif
<artifactDir>/<runId>/run-summary.json
<artifactDir>/<runId>/context-ledger.json
<artifactDir>/<runId>/shared-context.json
<artifactDir>/<runId>/observability.json
<artifactDir>/<runId>/error.json                     (failed runs)
<artifactDir>/<runId>/review-comments*.json          (when enabled)
<artifactDir>/<runId>/fix-report.json                (when the fix lane ran)
<artifactDir>/<runId>/verification-report.json       (when verification ran)
```

Plus `baseline.path` when you run `baseline write`, and the `--log-file` path
when you pass one. Report filenames are **fixed constants**, never derived from
a finding title, so no model output can steer a write.

Repository source files are never modified — by review, evaluation,
deterministic signals, admission, reporting, drift checking or the fix lane.

---

## The mediated read gate

When a lane may read the repository (verification, fix, or cross-file
discovery), reads go through mediated tools with a two-layer eligibility gate:

1. **A hard floor no configuration can widen.** Any path segment that is a
   dotfile or hidden segment is ineligible — that is what keeps `.env`,
   `.env.local`, `.git` and `.codereviewer` unreachable. `node_modules` and
   `dist` are ineligible anywhere in the path, matched case-insensitively so a
   re-cased segment on a case-insensitive filesystem cannot slip past.
2. **Your configured scope.** `paths.exclude`, then `paths.include`.

Ineligible paths return an actionable, recoverable "not eligible" result to the
model rather than an error to retry, and the reason is recorded.

---

## Verifying containment

Print the resolved permission flags and paths:

```bash
npm run cli -- config validate
```

Confirm a traversal attempt is refused:

```bash
npm run cli -- config validate --config ../outside.json
```

Run the path, permission and redaction test suites:

```bash
npm test
```
