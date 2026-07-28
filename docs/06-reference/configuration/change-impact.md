# `changeImpact`

Configuration for the [`impact check`](../cli.md#codereviewer-impact-check)
command. It is a **separate command**, never a flag on `review`, and `review`
ignores this key entirely.

`impact check` makes **no model provider call**, so nothing on this page controls
spend. The only resource the command can consume is repository traversal, and the
bounds below are what limit it.

| Key | Type | Default | What it does |
| --- | --- | --- | --- |
| `changeImpact.enabled` | boolean | `false` | Master switch. With `false`, `impact check` exits `0` and reports `"status": "disabled"` instead of an empty result. |
| `changeImpact.maxChangedSymbols` | integer 1–500 | `50` | Upper bound on the symbols seeded from the diff. Each seed costs exactly one repository search, so this is what bounds total traversal. Exceeding it sets `summary.changedSymbolsTruncated`. |
| `changeImpact.maxReferencesPerSymbol` | integer 1–500 | `25` | Cap on reference sites reported per symbol. A symbol with more sets `referencesTruncated` rather than being silently shortened. Per-symbol rather than one shared pool, so a change touching forty symbols cannot let the first one consume everyone's budget. |
| `changeImpact.maxSearchDepth` | integer 0–32 | `12` | Directory levels the reference search descends from the repository root. |

```json
{
  "changeImpact": {
    "enabled": true,
    "maxReferencesPerSymbol": 10
  }
}
```

## What it does not have

There is deliberately **no `blocking` key**. The command currently reports
references rather than findings, and always exits `0` — there is nothing to block
on. Accepting a `blocking` key today would mean accepting a setting that does
nothing, so the schema rejects it (`strictObject`) until the key has an effect.

There is likewise no severity threshold, no gate, and no admission setting. See
[the CLI reference](../cli.md#codereviewer-impact-check) for why a reference list
is not a finding.

## Scope reuse

`impact check` reuses `paths.include`, `paths.exclude`, `review.baseRef`,
`review.headRef`, `review.maxFiles`, and `review.maxFileBytes` rather than
defining its own copies, so the set of files it looks at matches the set `review`
looks at. `--base-ref` and `--head-ref` override the two refs for one invocation.

## Related

- [CLI: `impact check`](../cli.md#codereviewer-impact-check)
- [review.md](./review.md) — `paths`, `review.baseRef`, `review.headRef`
