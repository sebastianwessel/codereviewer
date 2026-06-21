# Instructions And Skills

Reviewer behavior can be shaped with prompt instructions and optional skills.
Defaults should work without either, but advanced teams can add domain-specific
guidance.

## Instructions

| Config Key | Purpose |
| --- | --- |
| `instructions.inline` | Short instruction text embedded in the run config. |
| `instructions.files` | Repository-relative files containing longer instructions. |

Use instructions for review policy, coding standards, risk priorities, and
project-specific terminology.

Instruction files are read only from inside the repository root. Their content
is redacted before model-bound context and is represented in
`context-ledger.json` by path, byte counts, decision, and hash only.

## Skills

| Config Key | Purpose |
| --- | --- |
| `skills.enabled` | Enables skill loading. |
| `skills.directories` | Repository-relative directories containing skills. |
| `skills.allowTools` | Read-only mounted-skill tools: `read`, `list`, `grep`. |

Keep skills deterministic and reviewable. A skill should describe how to inspect
or reason about code. R1 skills do not get shell, write, edit, or network tools.

When `skills.enabled` is true, each configured skill folder must contain a
harness-compatible `SKILL.md`:

```md
---
name: secure-review
description: Review security-sensitive changes.
---

# Secure Review
Focus on evidence-backed security findings.
```

Skills are mounted into the harness at `/skills/<name>/`. The model receives a
compact skill index and may read mounted files with `read`, `list`, and `grep`.
Raw skill text is not inlined into workflow input, logs, reports, or artifacts;
artifacts record skill paths and hashes for provenance.
