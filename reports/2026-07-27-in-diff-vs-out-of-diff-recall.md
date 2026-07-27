# The corpus measures two different jobs, and reports one number

Date: 2026-07-27
Status: finding. Derived from committed fixtures and archived runs. **No provider
spend.**

---

## The result

| population | recall |
|---|---:|
| Expectations whose lines appear in the **reviewed diff** | **72.8%** (603/828) |
| Expectations in **unchanged code** | **8.8%** (54/612) |
| Reported headline | 45.6% |

18 archived runs, 36 cases, 80 expectations. These runs predate the harness-wide
conversation-history suppression, so the **absolute** values are not current. The
**split** is a structural property of the fixtures and does not depend on them.

## Why this happens

The corpus reviews `base = fixCommit`, `head = parentCommit` — a reversed diff, so
the reviewer sees "the change that introduces the defect". A defect the upstream
fix commit did not touch is **identical in base and head**, so it never appears in
the diff at all. It is pre-existing code the reviewer was never asked about.

Distribution of the 80 expectations:

| | inside diff | outside diff |
|---|---:|---:|
| First expectation in its file | 43 | 4 |
| Later expectation in the same file | 3 | **30** |
| **Total** | **46** | **34 (42.5%)** |

## What this does to every prior conclusion

**The "one defect per file" finding was a shadow of this one.** First-in-file
recall was measured at 72.8% and later-in-file at 4.7%. In-diff recall is 72.8%
and out-of-diff is 8.8% — the same numbers, because the populations are nearly the
same population. There is no separate enumeration defect to explain: 30 of the 33
"later" expectations are simply not in the diff.

**The engine is not failing to enumerate. It is declining to review unchanged
code.** For a pull-request reviewer that is defensible behaviour and, for many
teams, the desired behaviour.

**Our headline recall is a weighted average of two different jobs** — 72.8% at the
job it is built for, 8.8% at a job it was never specified to do — with 42.5% of the
answer key drawn from the second. Reporting one number for both is the measurement
error.

**Five structural interventions were aimed at the harder half.** The enumeration
sweep, the diverse-lens pass, cross-file retrieval, the context scout and the
un-anchored pass were all, in effect, attempts to raise out-of-diff recall. That
reframes their failure: they were not badly built, they were aimed at a target the
architecture deliberately excludes.

It also sharpens what the un-anchored pass proved. It removed the diff anchor
entirely and still recovered only 2 of 7 targeted misses — so out-of-diff defects
are hard **even when the model is shown the code with no diff to distract it**.
Removing the anchor is not sufficient; the reviewer also needs a reason to suspect.

## What this does NOT license

It would be self-serving to conclude "our real recall is 72.8%" and move on. Two
honest constraints:

- **Out-of-diff defects are real defects.** A user whose PR touches a file with a
  latent bug may well want to hear about it. Declaring the population out of scope
  is a product decision, not a measurement result.
- **8.8% is not zero.** The engine already reports some unchanged-code defects, so
  the boundary is soft rather than architectural.

The correct response is to **report both numbers, labelled**, and let scope be
decided deliberately instead of by accident.

## Consequences for the evaluation

1. `recall` MUST be split into an in-diff and an out-of-diff rate. A single
   blended figure is not interpretable, and its value depends on the ratio of the
   two populations in the fixture set rather than on reviewer quality.
2. The in/out classification MUST be derived deterministically from the reviewed
   diff and stored with each expectation, so it is auditable and cannot drift.
3. The **structural ceiling** recorded earlier (58.8%, from one finding per file)
   should be read alongside a second ceiling: a strictly diff-scoped reviewer tops
   out at **46/80 = 57.5%** on this corpus. Measured 45.6% is ~79% of that.
4. **The convergence hypothesis gets sharper, not weaker.** Fixing defect A
   changes the diff. Whether that pulls a nearby out-of-diff defect into scope is
   now a specific, testable mechanism rather than a general hope — and it predicts
   convergence should work for defects near the fix and fail for distant ones.

## Method

For each case, `git diff <fixCommit> <parentCommit>` restricted to `reviewedPaths`;
added lines collected in head coordinates from the hunk headers; an expectation
counts as in-diff when any line of its `lineRange` is among them. Joined against
every archived run scoring 36 cases and 80 expectations.

The classifier is conservative in one direction: an expectation whose defect spans
a wide range counts as in-diff if any single line of that range was touched. If
anything, that **overstates** the in-diff population and therefore understates the
gap this report describes.
