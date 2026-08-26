# Pre-registration: the authorization-scope clause

**Written before the measurement, and not to be edited after one is taken.** The
honest reading of a result is fixed in advance or it is fixed to suit the result.

## The observation

On the 50-case security corpus, `authorization` is the worst substantial mechanism:
**7/18 (39%)** pooled over three seeds. Spec 15's opening evidence is that
authorization and access-control logic carry ~59% of real security findings, so the
engine is weakest where the defects are.

Reading the six authorization expectations and which seeds missed them, five of the
six share one shape, and it is **not** a missing check:

| missed | case | what is wrong |
| --- | --- | --- |
| 3/3 | apollo | a branch exists for one URL form and not another, so the extracted appId is the literal string `raw` — the identity authorized is a mis-parse of the identity used |
| 3/3 | traefik extensionRef | the ReferenceGrant authorises the Service; the same namespace then resolves other objects the grant never covered |
| 3/3 | quarkus | policy matching uses one path normalization, request dispatch uses another |
| 1/3 | traefik service key | the registration key omits route identity, so two routes collide on one entry |
| 1/3 | goshs sftp | the password handler is installed only when *both* credentials are non-empty, so an input can prevent the guard from existing |

In every one, **a check is present and looks consistent, but the value it authorizes
is not the value the operation uses** — a different parse, a different
normalization, a narrower object than the operation reaches, or a key that does not
uniquely identify the protected thing. The sixth (`mknod`) was never missed.

## The hypothesis

The discovery prompt's security clause enumerates *"missing authentication/
authorization checks, injection …, unvalidated or untrusted input reaching a
sensitive sink, …"*. That covers **absence** of a check and **untrusted input
reaching a sink**. It does not name the class where a check exists and is keyed
wrongly.

This is a standard weakness family, not a description of these cases: CWE-863
(Incorrect Authorization), CWE-289 (Authentication Bypass by Alternate Name),
CWE-179 (Incorrect Behavior Order: Early Validation), and OWASP A01 Broken Access
Control — the #1 category, covered here by one clause about missing checks.

**Honest disclosure of how the gap was found.** I found it by reading which
expectations the engine missed. That is exactly how one overfits to a dataset. Two
things guard against it: the clause is written from the CWE definitions and names
nothing that appears in any case, and the decision below is made on the **dev**
half with the **held-out** half as confirmation. If the clause is a description of
these fixtures rather than of a real class, it will move dev and not held-out.

## The intervention

One clause appended to the security defect-class enumeration in
`modelHolisticReviewerInstructions`. Generic and language-neutral, naming no
framework, vendor, or case:

> Authorization and validation scope: a check that exists is not a check that
> holds. Report as a defect any case where the value checked is not the value
> used — a different parse, a different normalization, or a narrower object than
> the operation reaches — and any case where the guard itself is installed
> conditionally, so an input can stop it applying at all.

Nothing else changes. Both arms are the same engine commit; the arms differ by this
clause alone.

## The design

Three seeds per arm, both arms over all 50 cases, arms interleaved so neither
inherits the other's warm prompt cache. The dev/held-out split is read out of the
same runs — one measurement, two populations, no extra spend.

Denominators: dev 15 expectations, held-out 36, `authorization` 6 (18
seed-observations). Corpus sd is **3.92pp**, so the whole-corpus recall figure
resolves about 8 percentage points at three seeds. `authorization` at n=6 resolves
almost nothing and is reported as counts.

## The decision rule

**Ships** only if all three hold:

1. `authorization` recall rises on the **held-out** half, counted as
   seed-observations, and does not fall on dev;
2. whole-corpus recall does not fall by more than 4 percentage points (half the
   resolvable difference — a token clause should not cost general recall);
3. genuine false positives do not rise above 0 across three seeds, and adjusted
   precision does not fall.

**Is rejected** if whole-corpus recall falls by more than 4 points, if genuine false
positives appear, or if `authorization` moves only on dev. Dev-only movement is the
signature of a clause fitted to the cases I read, and is the outcome this
pre-registration exists to catch.

**Is recorded as inconclusive** — and the clause reverted — if `authorization` does
not move in either direction. A clause that changes nothing is prompt weight that
costs cache invalidation and buys nothing.

Cost is recorded and is not a criterion. The clause sits mid-prompt, so shipping it
invalidates the prompt-cache prefix once; that is a one-time reset, not a running
cost.

## Prior probability, stated in advance

This project has run prompt A/Bs before and **rejected them**: the 2026-08-01
out-of-diff prompt change moved raw discovery (56→58 candidates) and landed
nowhere, costing 5 points of in-diff recall. The single prompt line that did work —
the injection guard — took recall 62.5% → 81.3%. Both outcomes are live
possibilities and the rule above does not favour either.
