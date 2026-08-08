# Wave 1.2: the impact corpus harvest, and the conclusion I nearly got wrong

Ran 2026-08-08. **No provider calls** — GitHub search and commit resolution only.

## The result

**3 candidates from 405 commit bodies screened** across 59 repositories, of which
~92 were individually resolved (the introducing commit's paginated file list diffed
against the fix commit's, to check the corpus's hard invariant: the repaired file
must lie *outside* the introducing commit's own diff).

Two are ready to curate, one is caveated:

| repo | language | shape |
| --- | --- | --- |
| rust-lang/rust | rust | MIR-pass change silently inflated a codegen-unit estimate in an untouched module; fix says "Fix performance regression introduced in #142531" |
| microsoft/vscode | typescript | endpoint-family rename narrowed a function to throw; two untouched callers now silently fall back to the wrong model |
| bevyengine/bevy | *(wgsl)* | causally the cleanest example found, but `.wgsl` is outside the 7 supported languages — flagged, not silently dropped |

## The conclusion I nearly drew, and why it was wrong

My first reading was "3 from 405 is a poor yield; this method is exhausted." That is
the **same error as this morning's "the pool is exhausted"**, and the arithmetic says
the opposite:

| | bodies screened | yield | rate |
| --- | --- | --- | --- |
| original corpus (bulk sweep) | 101,542 | 10 cases | 1 per 10,154 |
| this harvest (targeted search) | 405 | 3 candidates | **1 per 135** |

The targeted approach is **~75× more efficient per body** than the bulk sweep that
built the corpus. Reaching ~40 more candidates needs roughly **5,400 bodies** at this
rate, not 406,000. That is a 13× continuation of work already proven to run, not a
dead end.

**Caveat, stated because it cuts the other way:** a targeted search spends its best
phrases and richest repositories first, so the rate will decay. 5,400 is a floor on
the effort, not an estimate of it. What is *not* in doubt is that the method has not
been exhausted — it has been sampled.

**Wave 1.2 is therefore unfinished, not blocked.** The honest status is "13× more of
a thing that works", and I am recording that rather than the tidier "we tried and the
material is not there", which is what I would have written if I had not done the
division.

## Two structural findings worth keeping

**Same-file self-correction dominates: ~55 of ~92 resolved candidates.** The fix
repairs a file that was already in the introducing commit's own diff. Those are not
cross-file impact cases — stage 1 already covers in-diff defects — so they are
correctly rejected, but they are the single biggest reason the ground truth is scarce.

This does **not** establish that cross-file consequence breakage is rare. It is
equally consistent with cross-file breakage being common and rarely *attributed* to
its cause in a commit message. Spec 22 already records that reading ("the binding
constraint is commit-message convention, not defect rarity"); this harvest puts a
number beside it at a second, independent scale.

**Java produced zero hits across 30 Apache-2.0 repositories and every phrase tried.**
Reported as a structural observation rather than a search gap, and worth checking
before the next harvest spends time there.

## What this means for Wave 2.1

The adjudication re-measure is gated on this corpus reaching a size that can resolve
spec 22's promote bar (precision ≥ 50%, recall ≥ 40%). At 11 proven dependents a
single expectation moves a rate by ~20 points, so the bar is currently unreachable
in either direction — the measurement cannot fail it either.

Two candidates take that to ~13. That is not the fix; continuing the harvest is.
