# The corpus was not exhausted; the screen was wrong

**Corrects a claim published earlier the same day.** No provider spend: this is
re-screening, curation and hydration only.

## The claim being corrected

`reports/2026-08-07-three-nulls-and-the-real-variance.md` said, and the ledger
repeated:

> **More cases is NOT available at the scale required**: only 21 screened candidates
> remain unadjudicated […] the entire post-cutoff advisory harvest produced 132
> structurally reviewable candidates and 111 are already used.

The "21 remaining" figure was arithmetic on the screen's own output and it was
correct. The conclusion drawn from it was wrong, because **the screen had thrown away
a third of the real pool** and I had never re-read its rejection reasons.

## Two filters, both inherited from a different measurement

`screen-commits.py` was written for the analyzer-firing base-rate measurement, where
an alert must attribute to a changed line. Two of its rejections make sense only
there.

**Add-only fixes — 33 rejected.** The recorded reason was *"fix only ADDS lines; no
parent-side line is changed, so no alert can be attributed"*. Attribution is a
Mechanism 2 concern. Reviewed backwards, an add-only fix **removes a guard**, and
noticing a missing check is exactly what a security reviewer is for. Curated cases
already had that shape.

**Multi-commit advisories — 52 rejected**, on the reasoning that a repair spread over
commits has no single reviewable change. True of a minority. Most are one fix
**cherry-picked onto several release branches**: the commits are pairwise diverged, so
any one of them is complete against its own parent.

## What re-screening found

| | recovered | kept by curators |
| --- | --- | --- |
| add-only | 32 | 16 |
| multi-commit | 27 (26 backports, 1 single-bearer) | 10 |
| **total** | **59** | **26** |

A pairwise ancestor test correctly refused **8** advisories as genuinely *staged* —
several source-bearing commits in ancestor order, where one `fixCommit`/`parentCommit`
pair would show the reviewer only part of the defect. Those 8 are the residue for
which the original reason actually holds.

The keep rate is **44%**, indistinguishable from the ~45% of rounds one and two, which
is the sign that these candidates were ordinary material rather than scrapings.

**The add-only exclusion was wrong on the merits, not at the margin.** Across three
slices, curators dropped **zero** of them for "no defect in the parent". Everything
lost was lost to disclosure, which is orthogonal to the reason they were excluded.

## From 26 kept to 70 cases

- Two curators independently keyed **different sites of the same russh fix** — a
  missing length check on the client, a missing all-zero-point check on the server.
  Same `fixCommit` means one reviewed diff, so they were merged into **one case with
  two expectations**, and the second summary's sentence describing the first defect
  was trimmed so a single finding cannot satisfy both.
- The hydrator's removed-comment gate then rejected **6** cases the curators' own
  pre-screen had passed. Three unambiguously state the missing check in English
  (`// Reject theme names that only contain path elements.`,
  `// tlsHandshakeTimeout bounds how long a single TLS handshake may block.`,
  `// Reject any non-canonical path, in particular one containing ".."`). The other
  three were dropped under a **conservative default** rather than adjudicated
  individually: dropping costs corpus size, keeping a contaminated case corrupts every
  measurement made on it. They stay recoverable via
  `removedCommentDisclosureReview.acknowledgedComments`.
- The independent self-disclosure sweep over the hydrated working trees reports
  **0 of 70** checkouts naming their own advisory.

| | before | after |
| --- | --- | --- |
| cases | 51 | **70** |
| expectations | 52 | **72** |
| distinct repositories | 34 | **44** |
| held-out / dev | 36 / 15 | **52 / 18** |

Mechanism and depth coverage both stay complete, and the depth mix improves where it
was thinnest: `callee` 8 and `caller` 3, the two depths the silence analysis singled
out.

## What this does and does not buy

**Does.** The binomial sampling sd at p ≈ 0.6 falls from **6.8pp to 5.8pp**, so the
resolvable difference goes from about **13.7pp to about 11.7pp**.

**Does not.** That is a real but modest gain, and it does not rescue the underpowered
regime. Reaching an 8pp resolution still needs roughly **149 expectations** and 6pp
roughly **264**. **I was wrong about availability and right about sufficiency**, and
the second half matters as much as the first — a 38% increase in expectations is not
a fixed instrument.

I have already overstated a variance improvement once today (the "doubling the corpus
halved the variance" claim, corrected in
`reports/2026-08-07-three-nulls-and-the-real-variance.md`). This is the same
temptation and it is being refused in the same way.

## The lesson, which is worth more than the cases

**A screening filter is valid only for the measurement it was written for.** The
counts were audited repeatedly today; the *rejection reasons* never were. Dumping
them grouped by frequency and asking of each *"is this reason about the question I am
asking now?"* costs minutes and was worth a 38% corpus increase.

Any future claim that a candidate pool is exhausted has to show that check.

## Still recoverable, not pursued

- **8 staged-fix advisories**, if the corpus format ever admits a squashed multi-commit
  range instead of a single parent/fix pair.
- **3 cases** dropped by the conservative contamination default, pending a reader's
  judgement on the quoted comments.
- **1 advisory/commit mismatch** (pocket-id GHSA-hp74-gm6m-2qm5): the referenced fix
  commit repairs a real authorization defect, but the advisory prose describes a
  different file. Curating it would ground-truth from the commit alone, which the
  curation brief forbids. That is a policy call, not a curation one.
