# `invariantConformance`

Configuration for the
[`conformance check`](../cli.md#codereviewer-conformance-check) command. It is a
**separate command**, never a flag on `review`, and `review` ignores this key
entirely.

Everything on this page except `adjudication` bounds **repository traversal**, the
only resource the deterministic part of the command consumes. `adjudication` is the
one key that can spend money, and it is off by default: with it disabled
`conformance check` makes no model provider call at all.

| Key | Type | Default | What it does |
| --- | --- | --- | --- |
| `invariantConformance.enabled` | boolean | `false` | Master switch. With `false`, `conformance check` exits `0` and reports `"status": "disabled"` instead of an empty result. |
| `invariantConformance.maxChangedDeclarations` | integer 1–500 | `50` | Upper bound on the declarations seeded from the diff. Each seed derives one peer set, so this is what bounds how many comparisons run. Exceeding it sets `summary.changedDeclarationsTruncated`. |
| `invariantConformance.maxPeersPerDeclaration` | integer 3–500 | `60` | Cap on the peer set of one declaration. A larger set is truncated in path-then-line order and every divergence from it reports `peersTruncated: true`. The floor is 3 because a divergence must cite three peers, so a smaller cap could never produce one. |
| `invariantConformance.maxPeerFiles` | integer 1–2000 | `300` | Run-wide cap on sibling files read to supply peers. This is the traversal bound: without it a change spread across many directories would read most of the repository. Exceeding it sets `scope.peerFilesTruncated`. |
| `invariantConformance.maxDivergences` | integer 1–500 | `50` | Cap on the reported change-attributed divergences. |
| `invariantConformance.maxPreExistingDivergences` | integer 0–500 | `25` | Cap on the reported pre-existing divergences. A separate cap, so a flood of divergences in untouched code can never crowd out the ones the change caused. Set it to `0` to suppress the list entirely. |
| `invariantConformance.adjudication.enabled` | boolean | `false` | Ask a model, once per divergence, whether the shared pattern is a convention or an incidental resemblance. Only `convention` verdicts are reported. Requires a configured `provider`. |
| `invariantConformance.adjudication.maxAdjudications` | integer 1–500 | `25` | Hard cap on model calls per run. Change-attributed divergences are judged first; anything beyond the cap is counted in `summary.adjudication.unadjudicatedCount` and **not reported**. |

```json
{
  "invariantConformance": {
    "enabled": true,
    "maxPreExistingDivergences": 0
  }
}
```

## `adjudication`

The deterministic steps can prove that a majority of a declaration's peers do
something it does not. They cannot tell a **protective convention** from an
**incidental resemblance** — a shared schema-builder call and a shared
authorization check look identical to a lexical extractor. Adjudication asks a
model that single question.

```json
{
  "provider": { "id": "openai", "model": "your-model" },
  "invariantConformance": {
    "enabled": true,
    "adjudication": { "enabled": true, "maxAdjudications": 25 }
  }
}
```

- It is enabled **separately** from `invariantConformance.enabled`, so turning the
  capability on can never start a model call by itself.
- The model gets **no tools and no repository access**: one divergence, its peers,
  and the trait. It cannot search.
- It is never asked whether the code is vulnerable, exploitable or insecure. See
  [the CLI reference](../cli.md#adjudication-is-the-shared-pattern-a-convention)
  for why that distinction is the whole design.
- Cost is one call per divergence, bounded by `maxAdjudications` and reported in
  the report's `usage`.
- Adjudication can only make the report **shorter**. It removes divergences and
  attaches the reason to the ones that stay; it can never add or alter one, and it
  still cannot fail a pipeline.
- With adjudication enabled and no usable provider, the command exits `0`, reports
  the divergences unjudged, and warns.

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

### Test-side files are never compared

Test-side files are excluded on both sides and there is no setting to include
them: a changed test-side file seeds no declaration, and a sibling test-side
file supplies no peer. A test function's siblings are other test functions, and
what they share is the vocabulary of the test harness rather than a protective
convention of the system under review — "most sibling declarations call this
assertion helper and this one does not" is true and tells a reviewer nothing.
The same holds for the fixtures and helpers beside them. Test-side files are
also where near-duplicate structure is densest, so including them produced most
of the report on a repository that has many of them.

A file counts as test-side when it follows its language's own test convention
(`*_test.go`, `test_*.py`, `*.test.ts`, `*_spec.rb`, a Rust file declaring a
test) **or** when it sits inside a `test`, `tests`, `spec`, `specs` or
`__tests__` directory — the same definition `impact check` splits production
dependents from test dependents with. The directory half matters as much as the
naming half: a fixture or a shared harness helper holds no test case, so no
naming rule claims it, and its siblings are still other harness helpers. When a
change touches only test-side files the report is empty and warns that they were
excluded, so the silence is never unexplained.

## Related

- [CLI reference](../cli.md#codereviewer-conformance-check)
- [`changeImpact`](./change-impact.md) — the other deterministic, model-free
  command
- [Configuration reference index](./README.md)
