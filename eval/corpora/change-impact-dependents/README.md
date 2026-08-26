# Change-impact dependents corpus

Defined by `specs/22-change-impact-review.md` §Evaluation. **10 cases, 11 proven
broken dependents.** The manifest is committed; checkouts are not.

```bash
npm run eval:impact-corpus:hydrate
```

Hydration performs git fetches only — no provider call, no spend.

## Why this is not part of `real-repo-cross-file/`

That corpus enforces the exact opposite invariant. Its expectations must sit
**inside** the reviewed paths; every expectation here sits **outside** them by
construction (`Q ⊄ P`). Merging the two would need a mode flag on the invariant,
and a schema whose central rule is conditional enforces nothing.

The orientations differ too. Spec 17 checks out a fix's parent and reads the fix
**backwards**; a case here checks out the commit that **introduced** the breakage
and reads the change **forwards**, exactly as it was made
(`base = introducingCommit^`, `head = introducingCommit`).

The hydrated output root is deliberately not a sibling of spec 17's, and the case
artefact is `case.json` rather than `slice.json`, so no `--slice-root` typo can
pool two corpora that answer different questions.

## The evidence bar

A case is admissible only when upstream history **proves** the dependent broke:
a later commit that repairs it and names the introducing commit's full object
name, a revert, or an issue naming the caller-side symptom. A curator's inference
that something might break is not admissible, and the schema enforces this by
requiring an evidence entry that repairs a file the case actually expects.

Nothing here is sourced from this project's own engine output. Doing so would
convert recall into similarity-to-our-own-engine.

## Reading the manifest

- `reachability` is per expected dependent, because the scoring unit is the
  destination file. `caller-of-changed-symbol`, `callee-of-changed-code` and
  `attribute-owner` are directly reachable; `whole-repo-search` is not, and recall
  must be reported per class.
- `compatibilityClass` is what the corpus asserts instead of a severity. `severity`
  is retained as descriptive metadata only and is not a scoring input — see spec
  22 §Evaluation for why the threshold tension no longer applies.
- `split` is the contamination control. Results are reported split, never pooled.
- `screening.rejections` records the candidates that were adjudicated and refused,
  so the rejection patterns are not re-derived.
