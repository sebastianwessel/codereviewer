# Intent-fulfilment corpus

Defined by `specs/23-intent-fulfilment-review.md` §Evaluation. **28 cases in two
arms, 67 enumerated outstanding obligations.** The manifest is committed;
checkouts are not.

```bash
npm run eval:intent-corpus:hydrate
codereviewer eval intent
```

Hydration is **local git only** — no network request, no provider call, no spend.
Every commit this manifest names is in this repository's own history.

## Why this corpus exists as a committed file

Spec 23 ships the lane with a *measured, named failure mode rather than a
mitigation* — the false-satisfied route — and the lane has been **on by default
since 2026-08-11**. A rate that reaches every reader of every pull request has to
rest on an instrument anybody can re-run from a clean checkout.

Until this file existed the only instrument lived under `.codereviewer/`, which is
gitignored. Its case definitions and its fixed human enumeration are transcribed
here. Its **per-obligation hand labels are not**, and could not be: they were
written against engine-produced statements addressed by positional obligation id
(`obl_1`..`obl_N` in report order), which do not survive a re-run.

## The two arms — never pooled

- `pw*` — **pre-written**. 21 cases, 13 commits, specs
  05/11/13/15/19/20/21/22/23/24/25. The stated intent is a verbatim slice of a
  `specs/*.md` section **as it existed at a commit that is a strict ancestor of
  the change under test**: approved before the implementation existed, written in
  the register a real ticket is, and several sections carry clauses the project
  genuinely never implemented.
- `ph*` — **post-hoc control**. 7 cases judging the *same diffs* against each
  change's own commit message. A commit message is written after the work, so
  obligations read out of one are addressed by construction; the arm isolates
  intent provenance from case difficulty and is reported separately everywhere.

Hydration asserts the pre-written guarantee with
`git merge-base --is-ancestor <intentCommit> <baseCommit>` and **throws** rather
than materialise a case that fails it.

**No case is synthetic.** Spec 23 permits synthetic mismatches and requires them to
be marked; nothing here was removed from, added to, or reworded in any excerpt to
manufacture a leftover, and `mismatchOrigin` is `natural` on every case.

## The answer key, and what it deliberately is not

Each `outstandingExpectations` row is one obligation a human read in the excerpt
and found **genuinely not done in the repository at the change's head commit**, in
the human's own words. It is the fixed enumeration established for the 2026-08-01
round and never extended because a run surfaced something new — extending it would
be mining the tool's output for the denominator of its own recall.

There is **no `addressed` direction and no `truth` field**. Spec 23's decision rule
is stated on the false-satisfied rate, whose numerator is exactly these rows.
Adding the other direction has to be a schema change and a recorded decision, not
a value somebody types into a row.

Nothing here is derived from engine output.

## How a reported obligation is joined to a row

By the **citation**, never by matching statement text. Spec 23 already requires
every reported obligation to cite where in the stated intent it came from — *"an
obligation the reviewer inferred rather than read is not an obligation"* — so an
expectation and an obligation are the same obligation when they point at the same
clause.

- `intentLineRanges` addresses lines of the **source document** at `intent.commit`,
  so the key is auditable with `git show <commit>:<path>`. Hydration writes the map
  from assembled-body lines back to source lines into `case.json`; the scorer never
  reproduces how the body was joined.
- Anchors **partition** the excerpt. Two rows sharing a line would both claim the
  same reported obligation, so one wrong `evidenced` would be counted as two false
  claims. The schema refuses the overlap.
- An obligation no row anchors is **unscored, not correct**. The count is printed
  beside every rate.

Two items of the surviving 69-item enumeration were left out for exactly this
reason rather than given an invented sentence boundary; `curation.rejections` names
both, beside the two larger things this corpus deliberately does not carry.

## What a run reports

- **False-satisfied claims** — rows the run reported off the list a human reads,
  split by whether an `evidenced` or a `not-contradicted` verdict cleared them. Per
  spec 23's pre-registration a wrong `not-contradicted` counts on the same footing
  as a wrong `evidenced`, and the same row is also a recall loss.
- **Outstanding recall** — rows the run left on that list.
- **Coverage** — scored, refused, unmeasured. A case that refused because an input
  limit bound is the engine answering correctly and is never a scored zero.

Spec 23's own false-satisfied **rate** — over every obligation reported `evidenced`
or `not-contradicted` — is **permanently not measurable here**, because the key
holds a truth only for the rows above. The artefact says so in the field rather
than printing a number that would be quoted as that rate.

## Splits

Every case is `dev`. These commits are this repository's unpublished history, which
is strong material, but the manifest declares no model training cutoff and
therefore claims no held-out status. Nothing here may be quoted as a held-out
result.
