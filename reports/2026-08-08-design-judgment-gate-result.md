# Result: the design-judgment gate FAILS. The lane is not built.

Measured 2026-08-08 against `specs/31-design-judgment.md`, whose thresholds were
fixed before the population existed. **No provider calls.**

**Verdict: agreement with the maintainer is 41.7%, below the 50% floor. Under the
pre-registered rule the design-review lane is not built, now or later, without new
evidence.**

## The numbers

24 scorable cases, from a population of 30.

| measure | result | pre-registered band |
| --- | --- | --- |
| curator vs curator (strict `same`) | **54.2%** (13/24) | 50–70% → record and stop |
| curator One vs maintainer (`match`) | **41.7%** (10/24) | **< 50% → never build** |
| curator Two vs maintainer (`match`) | **41.7%** (10/24) | **< 50% → never build** |

Two independent curators, blind to the maintainer and to each other, landed on
*exactly* the same match rate. The binding threshold is the maintainer comparison,
and it fails the floor rather than merely missing the bar.

## The population was not the problem

The obvious escape — "the candidates were really bug reports, so the study measured
the wrong thing" — is closed. The judge with the answer key marked
**0 of 24** cases `not-a-design-objection`. Every maintainer comment in the set was a
genuine design objection: placement, layering, abstraction choice, duplication,
API-surface timing, ordering.

So the finding is not that design review is hard to *harvest*. It is that **a
competent reader looking at the same diff recovers the maintainer's actual design
objection about two times in five.**

## What the failure looks like up close

The two curators failed differently, and the difference is the interesting part:

- **Curator Two skewed to `partial` (8) over `miss` (6):** right area, right theme,
  *different specific mechanism* than the maintainer objected to.
- **Curator One skewed to `miss` (10) over `partial` (4):** describing a genuinely
  unrelated defect elsewhere in the same diff.

Both read the same code. One found a different flaw; the other found a different
framing of the same flaw. Neither is incompetent, and that is precisely the problem:
**a design objection is one of several defensible readings of a diff**, and the
maintainer's is authoritative only because they are the maintainer.

One case is worth quoting as the shape of the whole result. In `case-08` the
maintainer wrote that they *"also have a few issues with the proposed code structure
… will review more later"* — signalling an objection they never wrote down. The
ground truth is partly unstated even in the source it comes from.

## The generous readings, disclosed rather than used

Looser definitions clear the bar. They are recorded here so nobody rediscovers them
and mistakes them for the result:

| looser measure | value |
| --- | --- |
| curator vs curator, `same` + `related` | 83.3% |
| curator Two vs maintainer, `match` + `partial` | 75.0% |
| curator One vs maintainer, `match` + `partial` | 58.3% |

Every one of these was available before the strict numbers were known, and the strict
definitions were written into the judges' briefs **in advance** for exactly this
reason. `related` means "same area of the code, different problem". `partial` means
"caught one of several points while missing the main one". Counting either as
agreement answers a question nobody asked: whether an engine can tell an author their
design is wrong and be right about *which* thing is wrong.

Choosing the definition after seeing which one clears the threshold is the error this
project corrected three separate times in the preceding two days. It is not being
committed here.

## Two things the study also established

**Design-review ground truth decays.** Three of thirty cases were unrecoverable
because force-pushed pre-review commits are garbage-collected — one went from
fetchable to 404 *within a single session*. Advisory ground truth does not do this,
because an advisory points at a commit that was merged and kept. Any future attempt
at this corpus is racing deletion.

**Blind curators say "nothing to object to" and hinted ones do not.** In the
invalidated first run, where case identifiers leaked the objection, `NO_OBJECTION_
FOUND` appeared **zero** times and 19 of 30 answers were high-confidence. Blind, one
curator returned it three times and high confidence fell to 8 of 30. The leak was
material, not theoretical, and discarding that run was necessary rather than
fastidious.

## What this closes

Spec 31 authorised finding out whether design judgment can be measured, and named
`< 50%` as the answer that ends the work. That answer arrived.

**The design-review lane is not built.** Not advisory-only, not behind a flag, not as
an experiment — because the spec already refused the "advisory output is harmless"
argument in advance: output wrong at this rate trains readers to ignore a surface it
shares with findings that hold up ~96% of the time.

This is a result, not a failure. The engine now has a measured answer to the question
its parity analysis has been carrying as an open item: **"is this the right change?"
is not merely unbuilt here — it is, on this evidence, not reliably answerable at
all.**
