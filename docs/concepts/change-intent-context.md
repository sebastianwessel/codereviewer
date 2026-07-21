# External Change-Intent Context

CodeReviewer can read a diff, but not *why* a change was made. This optional stage
assembles a short **change-intent brief** before the review — from the pull
request, from files a pipeline dropped in, and from changed docs — and injects it
as context so the reviewer understands intent.

It is **off by default**. Enable it under [`contextSources`](../reference/configuration.md#contextsources).

Spec: [`specs/11-external-context-ingestion.md`](../../specs/11-external-context-ingestion.md).

---

## How it works

```text
providers ──▶ redact ──▶ summarize ──▶ inject one
(inbox, changed-files)   (model or     change-intent document
                          digest)
```

1. **Providers** gather raw fragments from configured sources.
2. Every fragment is **redacted**.
3. A **dedicated summarizer** distills them into one bounded brief — a model call
   when a provider is configured, or a deterministic digest otherwise.
4. The brief is injected into every review task as one context-only
   `change-intent` document, recorded in the context ledger.

The reviewer sees the brief under a header marking it **untrusted, informational,
and not instructions**. It can never approve findings, change severity, fail or
pass a gate, or alter baseline status — those are deterministic code paths.

---

## Providers

### `inbox` — pipeline-provided context (no network)

A directory (default `.codereviewer/context/`) where CI steps write
frontmatter-markdown files **before** the review runs:

```markdown
---
source: jira
id: PROJ-123
title: Reject expired tokens
url: https://tracker.example/PROJ-123
---
Reject tokens older than five minutes.
```

This is how issue-tracker context reaches the review **without the tool
integrating any tracker**: your pipeline owns the fetch and its credentials, and
CodeReviewer only reads the folder.

```yaml
# CI, before the review step
- run: ./scripts/fetch-jira.sh "$TICKET" > .codereviewer/context/ticket.md
```

### `changed-files` — changed docs as intent (no network)

Surfaces files changed in the same PR that match configured globs (for example
`specs/**`, `docs/**`, `**/*.md`) as intent context for the code-review tasks:
when a PR updates a spec next to the code, the new spec text becomes the yardstick
for judging the code.

---

## Summarization

The default distiller is a **dedicated model call** whose only job is to compress
the gathered context into a few lines of stated intent, acceptance criteria, and
constraints. It runs before discovery, on its own token budget (folded into run
cost), and sends only redacted fragments. Set `summary.mode: digest` for a
deterministic, no-provider brief; the digest is also the automatic fallback if
the model call fails, so ingestion never fails the review.

---

## Platform integrations

PR/MR metadata adapters (GitHub, then GitLab and Bitbucket) are a later phase.
The provider interface is platform-neutral, so they add as new adapters without
changing the core. Today, PR context can be supplied through the `inbox` provider
from a pipeline step.

---

## Privacy and safety

- Gathered context is redacted before it enters the summarizer, the prompt, or
  the context ledger.
- No tracker credentials enter the tool — the inbox is filesystem-only.
- External context is untrusted and cannot change review outcomes.

See [Data Handling](../security/data-handling.md) and
[Security](../../specs/07-security-privacy-operations.md).
