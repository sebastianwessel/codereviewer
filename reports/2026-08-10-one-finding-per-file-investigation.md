# "One finding per file": the limit is not established, and our instruments cannot see it

Investigated 2026-08-10 against the six runs of the citation A/B (engine `e61bfdb`,
`security-advisory-2026`, 72 cases × 6 runs = 431 scored case-runs, 437 discovery
calls, `openai/gpt-5.3-codex`). No provider calls were made for this analysis — it
is entirely a re-read of data already paid for.

**Conclusion: the engine emitting ~1.17 findings per case is not a demonstrated
defect. Every mechanism that could cause it is measurably inactive, and the
corpora cannot distinguish "reports one defect" from "there was one defect".**

## Nothing is truncating. Not one of the candidate mechanisms is active.

| mechanism | measured |
| --- | --- |
| candidate cap (`HOLISTIC_MAX_CANDIDATES = 12`) | `cappedByLimitCount` = **0** |
| suppression by id | `suppressedByIdCount` = **0** |
| suppression by location | `suppressedByLocationCount` = **0** |
| dropped in discovery | 12, across ~500 findings |
| collapsed by semantic merge | 18 |
| output-token exhaustion | median **426** output tokens per case, p90 724, max 1657 — nowhere near any budget |

The cap is never approached, nothing is suppressed, and the model stops writing
long before it runs out of room. **Nothing prevents a second finding. The model
simply does not write one — usually because there is not one to write.**

## The engine demonstrably reports multiple findings when multiple exist

| | |
| --- | --- |
| discovery calls returning 2 findings | 83 of 437 (**19%**) |
| calls returning 3+ | 8 (2%) |
| cases producing 2+ findings | 68 of 431 (**16%**) |
| adjusted precision | 98.6–99.3% |

With adjusted precision near 99%, the second finding on those 16% of cases is
almost always a **real defect**, not noise.

Sharper still — the corpus contains exactly two cases whose answer key names two
defects:

| case | matched | produced |
| --- | --- | --- |
| `lettre-boring-tls-hostname-verification-inverted` | **2 of 2 in all six runs** | exactly 2 |
| `russh-client-curve25519-shared-secret-unchecked-peer-length` | 1 of 2 in all six runs | 1 |

One case it gets completely right, six times out of six. The other it never does.
Two cases is not a sample, but it is enough to refute "the engine cannot report
more than one finding per file" as a hard limit.

And in **30 case-runs (7%)** the engine reported the planted defect **and** a
separate defect the plausibility judge credited as genuine but the answer key
never listed — 70 such unlisted-real findings in total.

## Why we have never been able to see this

**97% of corpus cases contain exactly one planted defect.**

| expectations per case | cases |
| --- | --- |
| 1 | 419 (97%) |
| 2 | 12 (3%) |

The `proof-quality` corpus — the one built specifically for exhaustive
expectations — is 10 cases with one expectation, two with two, three with none.

This is not an oversight; it is inherent to how every corpus here is built. A case
is a real fix commit, and the answer key is what that commit fixed — which is one
defect. **So "does the engine find the second, third and fourth defect in a file"
has never been asked by any instrument this project owns.** Emitting ~1.17
findings against keys naming ~1.03 is the CORRECT response to that material, and
reading it as a ceiling is reading the corpus, not the engine.

## What would actually settle it, and the one design that is clean

The measurement needs files with **several independent defects that are each known
to be findable**. Three ways to get them:

**1. Composite cases — recommended.** Splice two real, already-hydrated
single-defect cases of the same language into one file. Each defect is real code
from a real advisory; the count is known exactly because we placed them.

Its decisive property is the **clean counterfactual**: the engine already finds
defect A alone and defect B alone — that is what those cases measure today. If it
then finds only one of them when both sit in one file, that is a direct
demonstration of the limit, with no argument available about whether the second
defect was findable. No other design gives that.

Cheap to build from material already hydrated, and it cannot be contaminated by
engine output, which the standing rule forbids.

The honest cost: the composite file is synthetic even though both defects are
real, and two defects in one file may be more salient together than either was
apart. It measures the *ceiling* on multi-finding capability, not the natural
rate.

**2. Multi-advisory files.** Find files carrying two separate advisories over
time, reconstruct the state before both fixes. Highest fidelity, real file, real
co-occurrence — and expensive curation with few qualifying files.

**3. Independent exhaustive annotation.** Have an adjudicator that never sees
engine output enumerate every defect in N real changed files. This inherits the
problem that made the impact precision bar unfalsifiable: "did we list them all"
is not answerable, so only a lower bound exists.

## What must NOT be done

**Do not promote the 70 unlisted-real findings into answer keys.** They are the
most tempting material here — real defects, already adjudicated, in the exact
files — and mining the engine's own output for expectations converts recall into
similarity-to-the-engine-that-wrote-it. That prohibition is standing and this
investigation does not get an exemption from it for being convenient.

## Recommendation

Build the composite-case corpus before attempting any fix. On the current
evidence there may be nothing to fix; and if there is, no experiment can show a
change worked, because the instrument that would show it does not exist.

If the composite corpus shows the engine finds both defects, "one finding per
file" is closed as a myth of the corpus and the effort goes elsewhere. If it shows
the engine finds one, we will for the first time have a reproducible case that
fails, which is the precondition for every fix this project has ever landed.
