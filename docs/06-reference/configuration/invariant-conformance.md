# `invariantConformance`

Configuration for the
[`conformance check`](../cli.md#codereviewer-conformance-check) command. It is a
**separate command**, never a flag on `review`, and `review` ignores this key
entirely.

`conformance check` makes **no model provider call**, so nothing on this page
controls spend. The only resource the command can consume is repository
traversal, and the bounds below are what limit it.

| Key | Type | Default | What it does |
| --- | --- | --- | --- |
| `invariantConformance.enabled` | boolean | `false` | Master switch. With `false`, `conformance check` exits `0` and reports `"status": "disabled"` instead of an empty result. |
| `invariantConformance.maxChangedDeclarations` | integer 1–500 | `50` | Upper bound on the declarations seeded from the diff. Each seed derives one peer set, so this is what bounds how many comparisons run. Exceeding it sets `summary.changedDeclarationsTruncated`. |
| `invariantConformance.maxPeersPerDeclaration` | integer 3–500 | `60` | Cap on the peer set of one declaration. A larger set is truncated in path-then-line order and every divergence from it reports `peersTruncated: true`. The floor is 3 because a divergence must cite three peers, so a smaller cap could never produce one. |
| `invariantConformance.maxPeerFiles` | integer 1–2000 | `300` | Run-wide cap on sibling files read to supply peers. This is the traversal bound: without it a change spread across many directories would read most of the repository. Exceeding it sets `scope.peerFilesTruncated`. |
| `invariantConformance.maxDivergences` | integer 1–500 | `50` | Cap on the reported change-attributed divergences. |
| `invariantConformance.maxPreExistingDivergences` | integer 0–500 | `25` | Cap on the reported pre-existing divergences. A separate cap, so a flood of divergences in untouched code can never crowd out the ones the change caused. Set it to `0` to suppress the list entirely. |

```json
{
  "invariantConformance": {
    "enabled": true,
    "maxPreExistingDivergences": 0
  }
}
```

## What it does not have

There is deliberately **no `blocking` key**, and unlike `changeImpact` there is
no later version that adds one. The capability is advisory by design: it reports
that a declaration differs from its peers, and a deviation from a convention is
frequently deliberate. `conformance check` always exits `0`, so a `blocking` key
would be a setting that does nothing, and the schema rejects it
(`strictObject`).

There is likewise no severity threshold, no gate, and no admission setting. See
[the CLI reference](../cli.md#codereviewer-conformance-check) for why a
divergence is not a finding.

## Scope reuse

`conformance check` reuses `paths.include`, `paths.exclude`, `review.baseRef`,
`review.headRef`, `review.maxFiles` and `review.maxFileBytes`. A directory
excluded from review is excluded here too, so it can neither be a changed file
nor supply a peer.

## Related

- [CLI reference](../cli.md#codereviewer-conformance-check)
- [`changeImpact`](./change-impact.md) — the other deterministic, model-free
  command
- [Configuration reference index](./README.md)
