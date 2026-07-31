# Tuning Noise and Recall

Every dial in this guide trades one of two things against the other:

- **Recall** — how many real defects the review finds.
- **Noise** — how much of what it reports is not worth a developer's time.

The engine is precision-first by construction: a whole-file discovery pass
proposes candidates, an independent refutation pass adjudicates them, and only
survivors are admitted. The dials below decide how much the discovery side
proposes and how much the admission side lets through.

Change **one dial at a time** and measure. Per-case model variance is real, so
a small difference between two runs is noise, not a result. See the
[quality docs](../05-quality/README.md) for how to measure a change honestly.

---

## The decision path

```mermaid
flowchart TD
  A[Discovery: candidates per task] --> B[Refutation: proved / refuted / needs-more-evidence]
  B -->|refuted| R1[Rejected finding<br/>artifact only]
  B -->|needs-more-evidence| P{promotionPolicy.modelWeakOrRefuted}
  P -->|artifact-only| A1[Admitted, reporterEligibility = artifact-only]
  P -->|rejected| R2[Rejected finding]
  B -->|proved| S{severity floor:<br/>aiReview.actionableSeverityThreshold}
  S -->|below| R3[Rejected: below-threshold]
  S -->|meets| T{review.inlineSeverityThreshold}
  T -->|below| U[Admitted, summary-only]
  T -->|meets| V[Admitted, inline]
  V --> W[Quality gate + baseline]
  U --> W
```

---

## Dial 1: the severity floor

```json
{ "aiReview": { "actionableSeverityThreshold": "medium" } }
```

Default `medium`. A model-origin candidate whose severity is below the floor is
**rejected** with reason `below-threshold`. It is still written to the run's
rejected findings, so nothing is lost — it just does not reach the actionable
surface.

| Value | Effect |
| --- | --- |
| `critical` / `high` | Only high-impact defects are actionable. Quietest setting. |
| `medium` (default) | Keeps the review on runtime and security impact, out of nit territory. |
| `low` / `info` | Surfaces minor correctness and resource issues. Expect more to read. |

Trusted deterministic-rule candidates are exempt from this floor.

**Raise it** when reviewers complain about volume. **Lower it** when you are
hunting for misses and are willing to triage.

---

## Dial 2: what becomes an inline comment

```json
{ "review": { "inlineSeverityThreshold": "high" } }
```

Default `high`. This does not admit or reject anything — it decides whether an
already-admitted finding is `inline` or `summary-only`. A finding also has to be
anchorable to become a draft: its reported line must fall inside a reviewed diff
range. One that meets the severity but sits outside every changed hunk stays
`summary-only`.

Lower it to `medium` to put more findings directly on the diff; raise it to
`critical` to reserve inline comments for blockers.

---

## Dial 3: what to do with weak candidates

```json
{ "promotionPolicy": { "modelWeakOrRefuted": "artifact-only" } }
```

The refuter returns one of three verdicts. `proved` is admitted; `refuted` is
rejected. This key decides `needs-more-evidence`:

| Value | Behavior |
| --- | --- |
| `artifact-only` (default) | Admitted with `reporterEligibility: artifact-only`. It appears in a dedicated section of the Markdown report and in `report.json`, but is excluded from SARIF, from review comments, and from the quality gate. |
| `rejected` | Dropped entirely and recorded as a rejected finding. |

Use `artifact-only` when someone reads the full report. Use `rejected` when
only the gate and the inline comments are consumed and the extra section is
just noise.

---

## Dial 4: depth

```json
{ "review": { "depth": "balanced" } }
```

Depth shapes task planning and sizes the cross-file retrieval budget. It does not
change which files are reviewed, and — since the proactive caps were removed — it
no longer bounds the review packet either.

| Depth | Task planning | Cross-file retrieval caps (reads / searches / matches / traversal depth) |
| --- | --- | --- |
| `fast` | One task per changed file | 200 / 100 / 50 / 4 |
| `balanced` (default) | Import-connected files clustered into one task, at most 8 paths per task | 1 200 / 600 / 150 / 8 |
| `thorough` | Same clustering as `balanced` | 4 800 / 2 400 / 320 / 12 |

There is deliberately **no per-depth byte cap** in that table any more. A read is
not cut in advance; the per-read bound was sized from the old per-depth context
cap, which is exactly the "sized against a context window" value the current
design forbids. The change is sent whole and split only if the provider refuses
it; a single serialized packet is capped at 8 MB as a runaway guard.
`review.contextMaxBytes` lowers that ceiling when set — leave it unset unless you
have a specific reason.

`fast` is not the cheap setting: one task per file means *more* provider calls for
the same change, each with less context. `balanced` and `thorough` differ only in
how far cross-file retrieval may range.

> `review.mode` (`local` / `ci` / `pr` / `full`) is run metadata. It appears in
> the run summary and in logs and changes no behavior.

---

## Dial 5: deterministic support signals

```json
{ "aiReview": { "deterministicSignalMode": "support" } }
```

| Value | Effect |
| --- | --- |
| `support` (default) | Locally computed facts (anchors, symbol spans, import/test/config hints, contradiction signals) are injected as model context. |
| `disabled` | Clustering and planning still use the facts; the injection into the model packet is skipped. Cheaper packets, less grounding. |

---

## The optional discovery passes

All of the ones below are **off by default** (cross-file retrieval is *on* — see its
own section). Each one adds provider calls per task — see
[controlling-cost.md](controlling-cost.md) for the arithmetic before you turn
one on.

> **There is no dial for the second defect in a file.** A discovery response tends
> to answer the diff and stop, so a file holding two defects usually yields one.
> Three passes aimed at exactly this — an enumeration sweep, a diverse-lens pass,
> and an un-anchored pass that withheld the diff — were built, measured, and
> [removed](../03-concepts/optional-capabilities/extra-discovery-passes.md);
> none earned its cost, and the limitation is still open.

### Cross-file retrieval — **on by default**

Gives the discovery agent the mediated `repo_read`, `repo_list` and `repo_grep`
tools so it can inspect a callee body, interface or permission definition outside
the changed set. Findings are still restricted to the task's paths and still pass
the same refutation and admission.

It was long recorded here as *net negative* and shipped off. **That verdict was
wrong**: it was measuring a bug, not the feature. Every retrieved file was cut
part-way through and the reviewer was never told, so it concluded things were
absent from code it had only partly seen. With the cut disclosed, two runs put it
ahead on defects found, false alarms, cost and reliability alike. No specific gain
is claimed — the recall difference alone is inside noise — but nothing measured
argues against it.

There is no longer a per-read byte cap. The reviewer narrows a large file itself
by asking for a line range after locating what it needs with grep, rather than
receiving a prefix we chose for it. `maxToolCallsPerTask` is a runaway-loop guard,
not a context ration.

### Dedicated security pass

```json
{ "security": { "dedicatedPass": { "enabled": true } } }
```

A second, security-only discovery call per task applying a generic OWASP/CWE
checklist (access control, injection, SSRF, insecure deserialization, secrets,
cryptography, path traversal, misconfiguration, security-relevant races) with a
source-to-sink method.

Its candidates are **additive**: they merge with the general pass's candidates
and never displace them, and they flow through the same refutation and
admission. It is a separate call rather than an in-prompt checklist because
folding the checklist into the general prompt trades the dominant authorization
class for the injection classes — finite attention.

The security-specific lift is **not established**: it was measured once, at a
sample size too small to resolve against run-to-run variance. What that run did
show was an overall recall gain at roughly +50% on the discovery side of the bill.
Treat it as an experiment you are running, not a fix you are applying.

There is no `security.signals` key. The deterministic security-signal evidence
layer has no implementation, and a configuration surface for it would be a switch
that lies about doing something; it ships alongside the layer, not before it.

---

## Order to try things

1. **Too much noise?** Raise `aiReview.actionableSeverityThreshold`, then set
   `promotionPolicy.modelWeakOrRefuted` to `rejected`, then raise
   `review.inlineSeverityThreshold`.
2. **Missing security specifically?** `security.dedicatedPass`.
3. **Missing defects that depend on unchanged code?** `crossFileRetrieval` is on
   by default and is the dial for this; its old net-negative verdict was measuring
   a truncation bug and does not stand.

   But be clear about what this will *not* fix. Measured on the 37-case corpus,
   recall on defects outside the diff is **0 of 27** — and every one of those 27
   sat in a file the reviewer had already been shown **in full**. None needed
   retrieval at all. That is an attention problem, not an information problem, and
   no amount of extra context addresses it. A context scout that pre-selected the
   missing symbols was
   [removed](../03-concepts/optional-capabilities/context-scout.md) for the same
   reason: the reviewer largely does not read the context it already has.
4. **Still missing?** `review.depth` is not the answer — it does not bound the
   review packet, so raising it to `thorough` does not put more source in front of
   the reviewer. It only widens the cross-file retrieval budget.
5. **Missing a second defect in files that already produced one?** No dial
   addresses this today — see the note above. What does help is running the review
   again after the first round of fixes: the diff moves, and so does what the
   reviewer is pointed at.

After each step, re-measure on the same corpus and compare two reports:

```bash
npm run cli -- eval compare --base .codereviewer/eval/before.json --head .codereviewer/eval/eval-report.json
```

---

## What you cannot turn off

Refutation. `aiReview.requireRefutation` accepts the literal `true` only —
setting it to `false` is a validation error. Every model-origin candidate is
adjudicated before it can be admitted.
