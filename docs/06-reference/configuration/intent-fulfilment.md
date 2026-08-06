# `intentFulfilment`

Configuration for the [`intent check`](../cli.md#codereviewer-intent-check)
command. It is a **separate command**, never a flag on `review`, and `review`
ignores this key entirely.

Unlike `changeImpact`, this capability **spends on every run it completes**: one obligation-extraction call,
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

### When the intent arrives already cut

`contextSources` providers bound each source at their own
[`maxFileBytes`](./context-and-evaluation.md#contextsources) — **64000 by default**,
which is *below* `maxIntentBytes`. A long ticket thread is therefore clipped before
`intent check` ever sees it, and what arrives fits every limit above precisely
because it was clipped.

That one is **disclosed rather than refused**: the cap is not this command's to set,
and refusing on it would stop runs the limits above are sized to complete. When it
happens the run completes and says so in three places — `scope.intentTruncated` is
`true`, a warning names the cut sources and the cap, and `intent-report.md` states
above the obligation lists that they are a floor rather than a total. Raise
`maxFileBytes` on the provider that supplied the source and re-run to hold the change
to the whole of the intent.

## What the statuses mean: `evidenced`, not "done"

Every obligation in the report carries one of four statuses, and they are all
statements about **what the changed lines show** — never about whether the work
exists somewhere in the repository:

| Status | What it means | What it does **not** mean |
| --- | --- | --- |
| `evidenced` | Changed lines do what the obligation asks, and the report cites them by path, line and side. | — |
| `not-evidenced` | Nothing among the changed lines does what the obligation asks. | That the obligation is undone. An earlier commit or existing code may already have satisfied it. |
| `not-contradicted` | The obligation asks that something *not* be done, and nothing among the changed lines does it. There is no line to cite: keeping such an obligation looks like an absence in a diff. | That the obligation holds at head, or that this change put it in place. A change that establishes the restriction is `evidenced`, with the line quoted. |
| `undetermined` | The material did not let the judgement decide — including when the call itself failed, or when part of the change could not be read. | That anything is wrong with the change. |

The headline count is **`summary.notEvidencedCount`**: `not-evidenced` plus
`undetermined`. Neither an `evidenced` nor a `not-contradicted` obligation is ever
on it. `not-contradicted` obligations are tallied separately in
`summary.notContradictedCount`.

**Why `not-contradicted` exists.** An obligation like *"do not log the token"* is
kept by changing nothing, so it can never produce a citation however completely it
is honoured. While `not-evidenced` was the only answer available for that shape, it
appeared on the outstanding list on every run — a false alarm by construction rather
than a judgement error. Measured on the realistic corpus, on `openai/gpt-5.3-codex`,
**33 of this lane's 83 false positives (39.8%, the largest single mode)** were
obligations of exactly this shape. The status was added on 2026-08-06 and **has not
been measured since**: treat the precision figures below as predating it.

**Why these words, and not `addressed` / `unaddressed`.** The judgement is shown only
the changed lines, so it can answer *"do these lines evidence this obligation?"* and
not *"does this hold at head?"*. The old labels answered the second question in the
reader's head. Measured on the realistic corpus, on `openai/gpt-5.3-codex`, **54 of
this lane's 83 false positives (65%) were obligations the judgement had reported
correctly** — satisfied by
an earlier commit, by existing code, or by a prohibition that required no change at
all — and were counted as errors because `unaddressed` was read as "not done". The
verdicts did not change with the rename; only the words did. Read a
`not-evidenced` item as *"this change does not show me this"*, which is a question for
a reviewer rather than a defect.

**The rename did not fix the prohibition half of that figure, and could not.** No
wording of a three-status vocabulary can hold an obligation that produces no
citation when it is kept; that needed a status of its own, which is
`not-contradicted` above. The remaining 21 — obligations satisfied *outside* the
changed lines — stay `not-evidenced` deliberately: the judgement is shown only the
change, so the honest report is that this change does not evidence them, and the
words are chosen so that it cannot be read as a claim that they are undone.

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

Nothing `intent check` reports can therefore set a non-zero exit code, and the
schema rejects a `blocking` key (`strictObject`) rather than accepting a setting
that does nothing. The three input limits above are the one exception, and they
are not a verdict: exit `4` means the command refused to judge an input it could
not see whole.

## Scope reuse

`intent check` reuses `paths.include`, `paths.exclude`, `review.baseRef`,
`review.headRef`, `review.maxFiles` and `review.maxFileBytes`. A directory
excluded from review is excluded here too, so its lines can neither be judged
against an obligation nor reported as extra scope.

## Related

- [CLI: `intent check`](../cli.md#codereviewer-intent-check)
- [`contextSources`](./context-and-evaluation.md#contextsources) — where the
  stated intent comes from
- [`changeImpact`](./change-impact.md) — the other advisory command
- [Configuration reference index](./README.md)
