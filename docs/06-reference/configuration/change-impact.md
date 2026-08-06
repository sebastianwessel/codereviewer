# `changeImpact`

Configuration for the [`impact check`](../cli.md#codereviewer-impact-check)
command. It is a **separate command**, never a flag on `review`, and `review`
ignores this key entirely.

With `changeImpact.adjudication.enabled` left at its default of `false`,
`impact check` makes **no model provider call**: it costs nothing to run and its
output is reproducible. The only resource it consumes is repository traversal, and
the first three bounds below are what limit it.

| Key | Type | Default | What it does |
| --- | --- | --- | --- |
| `changeImpact.enabled` | boolean | `false` | Master switch. With `false`, `impact check` exits `0` and reports `"status": "disabled"` instead of an empty result. |
| `changeImpact.maxChangedSymbols` | integer 1–500 | `50` | Upper bound on the symbols seeded from the diff. Each seed costs exactly one repository search, so this is what bounds total traversal. Exceeding it sets `summary.changedSymbolsTruncated`. |
| `changeImpact.maxReferencesPerSymbol` | integer 1–500 | `25` | Cap on reference sites **reported** per symbol. A symbol with more sets `referencesTruncated` rather than being silently shortened. Per-symbol rather than one shared pool, so a change touching forty symbols cannot let the first one consume everyone's budget. |
| `changeImpact.maxReferenceCandidatesPerSymbol` | integer 1–5000 | `500` | Bound on the raw matches the search **collects** per symbol, from which the cap above selects. Reaching it sets `referenceSearchTruncated`. Raising it does not make the report longer; it widens what the report gets to choose from, at the cost of traversal and memory. |
| `changeImpact.maxSearchDepth` | integer 0–32 | `12` | Directory levels the reference search descends from the repository root. |
| `changeImpact.adjudication.enabled` | boolean | `false` | Whether dependents are checked against the part of the contract that changed. This is the **only** part of the command that can call a model. |
| `changeImpact.adjudication.maxCalls` | integer 1–500 | `40` | Upper bound on model calls per run. Dependents settled without a model are free and are never counted against it. Reaching it sets `summary.adjudicationCallsTruncated`. |

```json
{
  "changeImpact": {
    "enabled": true,
    "maxReferencesPerSymbol": 10
  }
}
```

## Adjudication is a second switch

`changeImpact.adjudication.enabled` is `false` even when `changeImpact.enabled` is
`true`, and that is deliberate: turning the command on must never silently start
billing you. With it off you get the deterministic reference report and nothing
else; `adjudicationStatus` says `disabled` and `impactFindings` is empty, which is
**not** a report that nothing depends on your change.

Turn it on and each dependent is checked against what actually changed:

```json
{
  "changeImpact": {
    "enabled": true,
    "adjudication": { "enabled": true }
  }
}
```

Most of that check needs no model. A dependent of a **removed**, **relocated** or
**newly added** declaration is settled in code, so it costs nothing and works with
no provider configured at all. Only a dependent of a symbol whose *behaviour*
moved costs a call — and with no provider available those dependents are counted
as unadjudicated rather than reported as maybes. A run without a provider still
reports everything it could settle and still exits `0`.

**This layer is unmeasured.** No accuracy figure exists for it. It is designed to
cut the reference list down to the dependents that are actually exposed; whether
it does, and how well, has not been measured. Treat every finding as a pointer to
something worth opening, never as a verdict.

## What it does not have

There is deliberately **no `blocking` key**, on this block or on `adjudication`,
and there will not be one. The lane cannot fail a build: a breaking change is
frequently intentional, and the command's job is to show you the dependents, not
to decide whether breaking them is acceptable. Accepting a `blocking` key would
mean accepting a setting that does nothing while looking like a gate, so the
schema rejects it (`strictObject`).

There is likewise no severity threshold and no admission setting. Findings carry a
**compatibility class** rather than a severity — see [the CLI
reference](../cli.md#codereviewer-impact-check).

## Scope reuse

`impact check` reuses `paths.include`, `paths.exclude`, `review.baseRef`,
`review.headRef`, `review.maxFiles`, and `review.maxFileBytes` rather than
defining its own copies, so the set of files it looks at matches the set `review`
looks at. `--base-ref` and `--head-ref` override the two refs for one invocation.

That applies to **reference destinations** as well as to the changed files:
excluding a path from review also excludes it as a place a dependent can be
found. There is no separate include/exclude key for reference search, and there
will not be one — two definitions of "reviewable file" would be a defect of their
own.

## Which files can hold a dependent

On top of the configured scope, a reference site is only reported when it lands in
a file a supported language covers. Documentation, specification prose, fixture
data, snapshots and other non-source files are **counted** in
`referencesInNonSourceFiles` and `summary.nonSourceReferenceCount`, never listed:
a symbol name inside a JSON fixture or a prose paragraph is textual coincidence,
not a dependency.

"Source" is not a configurable extension list. It is exactly the set of files the
deterministic language support covers — the same set that decides which files can
seed a changed symbol — so the two ends of the lookup can never disagree, and
adding language support widens both at once.

Test files are source, and are listed in `impactedTestFiles` rather than mixed
into `impactedFiles`. See [the report shape](../cli.md#report-shape) for why.

## Which sites survive the cap

`maxReferencesPerSymbol` decides how much of the page one symbol may occupy, so
when it binds it also decides which sites you see. That choice is made **after**
the matches that cannot be dependents — whole-line comments, the symbol's own
file, non-source destinations — have been removed and counted, so the cap is never
spent on them.

Among what is left, two ordering rules apply, and nothing else:

1. a **production** site before a **test** site, because the production list is the
   primary one and a symbol with many tests would otherwise lose it entirely;
2. a site in a file **this change also touched** before one elsewhere, because both
   sides moved together — that is where a contract mismatch is most likely to have
   been introduced and least likely to have been noticed.

Everything beyond that keeps search order. There is no ranking by reference count,
by directory distance, or by how a matched line looks.

## What it knowingly does not report

`impact check` is deliberately low-recall: it is bounded, diff-seeded and it never
guesses. The full list of what it knowingly misses —
which changed symbols are seeded, which dependents are found, and what the report
does and does not claim about a change — is published in the CLI reference under
[What `impact check` knowingly does not
report](../cli.md#what-impact-check-knowingly-does-not-report). Read it before
treating an empty report as "nothing depends on this".

## Removals

A removed declaration is paired against the declarations the same change adds
before it is reported, so a file rename or a move is reported as `moved` rather
than as the most severe category available. The predicate is name plus language;
nothing configures it. See [Removals are paired before they are
reported](../cli.md#removals-are-paired-before-they-are-reported).

## Related

- [CLI: `impact check`](../cli.md#codereviewer-impact-check)
- [review.md](./review.md) — `paths`, `review.baseRef`, `review.headRef`
