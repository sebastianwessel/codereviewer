# Instructions and Skills

Reviewer behavior can be shaped with prompt instructions and optional skills.
Defaults work without either, but advanced teams can add domain-specific
guidance to focus the reviewer on the policies and risk areas that matter most.

---

## Instructions

Instructions let you add review policy, coding standards, risk priorities, and
project-specific terminology directly into the review context.

| Config key | Purpose |
| --- | --- |
| `instructions.inline` | Short instruction text embedded directly in the run config. |
| `instructions.files` | Repository-relative files containing longer instructions. |

### Security handling

Instruction files are read only from inside the repository root. Their content
is **redacted before model-bound context** — `context-ledger.json` records only
the path, byte counts, decision, and hash, not the raw text.

### Example

```jsonc
{
  "instructions": {
    // Short inline guidance:
    "inline": "Prioritize correctness, security, and evidence quality.",
    // Longer policy documents loaded from the repo:
    "files": ["docs/reviewer-instructions.md"]
  }
}
```

---

## Skills

Skills mount a folder of harness-compatible files into the model context so
the reviewer can consult domain knowledge, checklists, or coding standards
during a run.

| Config key | Purpose |
| --- | --- |
| `skills.enabled` | Enables skill loading. |
| `skills.directories` | Repository-relative directories containing skills. |
| `skills.allowTools` | Read-only mounted-skill tools the model may use: `read`, `list`, `grep`. |

> **Note:** Skills do not get shell, write, edit, or network tools. Keep skills
> deterministic and reviewable — a skill should describe how to inspect or
> reason about code, not how to execute it.

### Skill file format

When `skills.enabled` is `true`, each configured skill folder must contain a
harness-compatible `SKILL.md` with a YAML front-matter header:

```md
---
name: secure-review
description: Review security-sensitive changes.
---

# Secure Review
Focus on evidence-backed security findings.
```

### How skills are mounted

Skills are mounted into the harness at `/skills/<name>/`. The model receives a
compact skill index and may read mounted files using the `read`, `list`, and
`grep` tools.

Raw skill text is **not** inlined into workflow input, logs, reports, or
artifacts. Artifacts record skill paths and hashes for provenance only.

---

## Related docs

- [Configuration guide](configuration.md) — `instructions` and `skills` config
  keys in context.
- [Configuration reference](../reference/configuration.md) — full key/value
  reference.
- [Architecture](../concepts/architecture.md) — how instructions and skills are
  assembled into model context (step 6: Context assembly).
