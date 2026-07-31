# Skills

Packaged instruction sets an AI coding agent (Claude Code or similar) can follow
to do something with this project. Each skill is a directory containing a
`SKILL.md` with YAML frontmatter carrying `name` and `description`, plus any
supporting reference files it loads on demand.

| Skill | Use it for |
| --- | --- |
| [`codereviewer-setup`](codereviewer-setup/SKILL.md) | Setting the engine up in a repository: pick a provider, write a minimal config, verify without spending money, wire CI, and enable gates in the right order. |

These are **not** the reviewer skills the engine itself can mount at review time.
Those are a different thing — a bounded read/list/grep capability configured under
`skills.enabled` and `skills.directories` (default `.codereviewer/skills`, off by
default). See [Instructions and skills](../docs/04-guides/instructions-and-skills.md).

## Using a skill

With Claude Code, copy or symlink the skill directory into `.claude/skills/` (or
your personal `~/.claude/skills/`) and invoke it by name. Any agent runtime that
reads `SKILL.md` frontmatter works the same way; the content is plain Markdown
with no runtime dependency on this repository.
