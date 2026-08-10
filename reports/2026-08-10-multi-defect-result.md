# Result: the out-of-diff wall, proved with defects the engine is known to find

Ran 2026-08-10. Engine `ee31bc9`, corpus `multi-defect-2026` (5 cases, 11
expectations), `openai/gpt-5.3-codex`, zero provider errors. **Cost: $0.20.**

Two questions were asked. One is answered hard; the other is not answered at all,
which was known before the run and is restated here so the numbers are not
over-read.

## Answered: out-of-diff recall is 0/5, and now it means something much stronger

| | |
| --- | --- |
| in-diff expectations found | **3 of 6** |
| out-of-diff expectations found | **0 of 5** |

The 0 replicates the standing 0/27 exactly. What is new is *which* defects were
missed. Each of these five sits in a changed file the reviewer was shown in full,
and each is a curated case in its own right — so we can check whether the engine
finds it when it IS the diff. It does:

| defect, scored as its own case | matched in 3 control runs |
| --- | --- |
| `datamodel-code-generator-local-ref-arbitrary-file-read` | 1 / 1 / 1 |
| `gitpython-checkout-index-forwards-unscreened-git-options` | 1 / 1 / 1 |
| `ipv4-classifiers-suppressed-by-cidr-suffix` | 1 / 1 / 1 |
| `redirect-copies-credentials-to-cross-origin-location` | 1 / 1 / 1 |
| `x-python-type-extension-emitted-into-generated-annotation` | 0 / 0 / 1 |

**13 of 15 case-runs find these defects when they are the diff. 0 of 5 find them
when the same defect is in the same file, outside the changed lines.**

Every previous statement of this gap ("0/27") was open to the objection that those
expectations might simply be hard. This one is not: it is the same engine, the same
model, the same file, the same defect, and the only thing that changed is whether
the defect happened to be in the hunk. **The engine does not fail to find these
defects. It fails to look outside the diff.**

That also closes the last alternative explanation for the 0/27 wall. It is not
retrieval (the file is shown in full), not context size, not the defect's
difficulty. It is where attention goes.

## Not answered: whether one file yields more than one finding

Only `traefik-gateway-httproute-multi-defect` has both defects inside the diff
hunks, so it is the only case that can pose the question. It produced **one**
finding and matched one of its two expectations.

**n = 1, and it is the hardest possible version of the question**: those two
expectations overlap in line range (256–328 and 254–284), so a single reported
defect covering that region is exactly what a model would emit whether the limit
is real or the two defects are genuinely hard to separate. This is a data point,
not a result, and it does not license a conclusion in either direction.

The other four cases contribute nothing here, by construction — their second
defect is out-of-diff, so their misses are the wall above, not a multi-finding
limit. That was documented before the run rather than discovered in it.

## Two cases found nothing at all

`datamodel-code-generator-jsonschema-multi-defect` and
`gitpython-index-base-multi-defect` produced zero findings and missed their
in-diff defect too. That is ordinary recall variance at n=6 in-diff expectations
(3/6 here against a ~63% baseline), not a finding about this corpus.

## What to do with this

**The multi-finding question stays open and needs more both-in-diff pairs.** The
traefik case occurred naturally because its two defects live in overlapping
regions of one function. Finding more means widening the search beyond this
corpus — curation, not code. Until then, "one finding per file" remains
unestablished, and the investigation that preceded this run
(`2026-08-10-one-finding-per-file-investigation.md`) found every mechanical cause
inactive: the candidate cap is never reached, nothing is suppressed, and the model
stops writing far short of any budget.

**The out-of-diff result is the actionable one, and it is now the best-evidenced
gap this project has.** Four prior attention mechanisms were measured against it
and all were flat — but every one of those was tried before this evidence existed,
against expectations whose findability was unknown. A mechanism aimed at it now
has something no previous attempt had: five defects with a proven in-diff hit rate,
in files already in the packet, where any change can be scored against a known
ceiling of 5/5 rather than against an unknown.
