# `intentFulfilment`

Configuration for the [`intent check`](../cli.md#codereviewer-intent-check)
command. It is a **separate command**, never a flag on `review`, and `review`
ignores this key entirely.

Unlike `changeImpact` and the deterministic part of `invariantConformance`, this
capability **spends on every run it completes**: one obligation-extraction call,
one judgement call per obligation, and one explanation call. Every key below
except `enabled` is a bound on that spend.

| Key | Type | Default | What it does |
| --- | --- | --- | --- |
| `intentFulfilment.enabled` | boolean | `false` | Master switch. With `false`, `intent check` exits `0` and reports `"status": "disabled"` instead of an empty result. |
| `intentFulfilment.maxObligations` | integer 1–100 | `100` | Cap on the obligations read out of the stated intent, and therefore on judgement calls — one call judges one obligation. This is the primary spend bound. |
| `intentFulfilment.maxIntentBytes` | integer 256–200000 | `100000` | Cap on the redacted change-intent text handed to the extraction call. The ingestion providers bound themselves per file; this bounds the sum, because a pipeline can configure several of them. |
| `intentFulfilment.maxChangeLines` | integer 1–5000 | `5000` | Cap on the changed lines each judgement call sees. A judgement may only cite a line the change touched, so this also bounds the evidence a judgement can draw on. |

**These limits refuse; they never truncate.** Exceeding one stops the run with a
specific error and exit code `4`, naming the bound and the offending input. Nothing
is silently reviewed in part: a partial answer that looks complete is worse than a
refusal, because only the refusal is visible. The error also says what you can
actually do about it — and where a limit is already at its maximum, it says that
rather than advising you to raise it.

```json
{
  "provider": { "id": "openai", "model": "your-model" },
  "intentFulfilment": { "enabled": true },
  "contextSources": {
    "enabled": true,
    "providers": [{ "type": "inbox", "dir": ".codereviewer/context" }]
  }
}
```

## It needs `contextSources`, and it needs a provider

`intent check` reads the stated intent through the **same ingestion**
[`contextSources`](./context-and-evaluation.md#contextsources) configures for
`review` — the same providers, the same redaction. There is no second set of
keys and no second fetch.

Two consequences worth knowing before you enable it:

- With `contextSources` disabled or empty, the command exits `0` and reports
  `"status": "no-intent"`. That is the ordinary case, not an error.
- With no `provider` configured, it exits `0` and reports
  `"status": "provider-unavailable"`. It cannot fall back to anything: reading
  prose into obligations is the model's whole job here.

Unlike `review`, this command reads the gathered **fragments** rather than the
summarized change-intent brief, because an obligation has to cite the line of the
ticket it came from and a paraphrase has no lines to cite.

## What it does not have

There is deliberately **no `blocking` key**, no severity threshold, no gate, and
no `failOnUnaddressed`. Advisory-only is a **requirement** of this capability
rather than a maturity stage, and unlike `changeImpact` there is no later version
that adds a gate. Two reasons, and the second is the binding one:

- A pull request need not fully implement a ticket. Partial work, follow-ups and
  deliberately deferred scope are normal, so a gate on ticket completeness would
  block correct work routinely.
- Published measurement of models judging requirement conformance reports
  systematic over-rejection: spurious rejection at **26–36%**, rising to
  **73–88%** when the same call is also asked to explain its judgement. A hard
  gate built on that judgement would be wrong most of the time it fired.

`intent check` therefore always exits `0`, and the schema rejects a `blocking`
key (`strictObject`) rather than accepting a setting that does nothing.

## Scope reuse

`intent check` reuses `paths.include`, `paths.exclude`, `review.baseRef`,
`review.headRef`, `review.maxFiles` and `review.maxFileBytes`. A directory
excluded from review is excluded here too, so its lines can neither be judged
against an obligation nor reported as extra scope.

## Related

- [CLI: `intent check`](../cli.md#codereviewer-intent-check)
- [`contextSources`](./context-and-evaluation.md#contextsources) — where the
  stated intent comes from
- [`changeImpact`](./change-impact.md) and
  [`invariantConformance`](./invariant-conformance.md) — the other advisory
  commands
- [Configuration reference index](./README.md)
