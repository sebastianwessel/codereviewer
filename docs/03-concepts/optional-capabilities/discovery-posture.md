# Discovery Posture (Removed)

The discovery posture was a single configurable dial — `review.discoveryPosture`,
`"precise"` against `"investigative"` — that changed **how much evidence the
discovery reviewer demanded of itself** before raising a candidate, and nothing
else. `investigative` appended one paragraph to the reviewer's instructions: pursue
what looks wrong, report what you can support, say what you could not determine.
It named no defect category, added no call, and left the packet and its field order
untouched. It was **removed** on 2026-07-27: code, spec, and configuration key.

There is nothing to configure here. `review.discoveryPosture` was deleted from the
configuration schema, which is strict: a config file that still sets it now fails
validation with exit code `2`. Remove the key.

## What was measured

36-case / 80-expectation real-repository corpus, **4 seeds per arm**, paired
finding-level test.

| | `precise` | `investigative` |
| --- | ---: | ---: |
| Recall | **45.94%** | **44.69%** |
| Adjusted precision | 0.819 | 0.873 |
| Genuine false positives / run | 8.3 | 5.3 |
| Candidates / run | 74.8 | **70.8** |
| Cost / run | $1.32 | $1.36 |

Recall delta **−1.25pp**, 95% CI **[−4.38, +1.25]**, 5 gained and 5 lost,
**p = 1.0000**. The rule fixed before the run said *remove if recall does not
rise*. Recall did not rise.

## The intervention did the opposite of what it was built to do

The posture existed to **widen** discovery. The candidate count **fell** — 74.8 to
70.8. So this arm never tested the thing it was designed to test: discovery never
widened, and the refutation gate was never asked to absorb anything extra.

The added paragraph appears to have made the reviewer *more* careful rather than
less, plausibly because it repeats that severity must reflect impact rather than
confidence, and asks the reviewer to state what it could not determine.

Anyone revisiting this idea should first show, on a handful of cases, that the
prompt actually raises candidate count — before paying for a full arm.

## The precision movement is not a reason to keep it

Adjusted precision rose 0.819 → 0.873 and genuine false positives fell 36%, at
equal cost. That reads well and means little: it is a post-hoc reading of an
experiment that failed its primary endpoint, taken on the arm whose candidate count
happened to fall. That is the classic shape of a result that does not replicate.

It is recorded as a **hypothesis worth its own pre-registered test** — *does an
instruction that makes the reviewer more explicit about uncertainty improve
precision at no recall cost?* — and not as a finding.

## What this does not establish

**This was not a faithful test of the idea it came from, and the record must not be
read as one.** The source changed **two** things at once: it replaced a fixed
pipeline with an agent that **calls tools and decides its own investigation
depth**, *and* it made prompting aggressive. **We implemented only the prompt.**

This engine's discovery lane is single-shot and tools-off by design, so the
reviewer was told to investigate every suspicious pattern **with no mechanism to
investigate anything**. Words were added, not capability — which is a plausible
reason the candidate count fell rather than rose.

**What was measured here is a prompt. The source's actual architecture — aggressive
prompting paired with an agent that can act on the instruction — is untested in
this engine, and nothing on this page is evidence against it.**

## Related

- [What limits recall](../../05-quality/what-limits-recall.md) — every intervention
  measured against the enumeration gap
- [Holistic discovery](../pipeline/04-holistic-discovery.md) — what discovery does
  today
- [Extra discovery passes (removed)](extra-discovery-passes.md) — three earlier
  removals, each with a failed measurement behind it
- [Optional capabilities](README.md) — what actually ships as a switch
