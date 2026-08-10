# Pre-registration: the citation spine

**Written before the run.** Engine `91f1a1f` for both arms, corpus
`security-advisory-2026` (72 cases), `openai/gpt-5.3-codex`, judge pinned to the
same model as every prior entry on this corpus. Arms differ by
`review.citations.enabled` alone, order alternated.

## The mechanism, and why the prior differs from the last five nulls

Discovery built every candidate with `evidenceIds: []`. The refutation packet
selects its evidence by intersecting candidate ids with the run's records, so that
array was **empty for every candidate since inception**, as was
`supportSignalCandidates`. Measured: `evidenceCount` is 1 for 78/78 admitted
findings, and that 1 is the refuter's own rationale written afterwards. The refuter
was told to prove a claim while holding nothing, and `needs-more-evidence`
outnumbered `refuted` 5:1.

This is the first intervention this session aimed **downstream** of discovery.
The six prior nulls all changed what discovery was SHOWN or TOLD; this changes what
the REFUTER can check. That is a different stage with a different, untested
constraint.

**The unfavourable half, stated plainly.** It still alters the discovery prompt
(the model is asked to quote), so it inherits some of the same prior. And the
nearest attempt at the refutation stage — spec 05's withdrawn retrieval — made
adjusted precision FALL and false positives RISE. That record's removal rule is
inherited verbatim below rather than reinvented.

## Decision rule — all four cells, enumerated in advance

The 2026-08-10 signal-facts rule under-specified the
unfavourable-and-not-significant cell and had to be resolved after the fact. All
four are named here.

Primary outcome: in-diff recall. Significance: pooled per-expectation paired sign
test over the in-diff population, exact two-sided, threshold p < 0.05.

| recall vs control | significant | decision |
| --- | --- | --- |
| improves | yes | **PROMOTE** to enabled by default |
| improves | no | **KEEP, DISABLED** — real but unproven, where the security pass already lives |
| flat or worse | no | **KEEP, DISABLED** — the mechanism is sound and cheap; a null inside the resolution band is not evidence of harm |
| flat or worse | yes | **REMOVE** the key, the verifier, the prompt segment and the `citation` evidence kind |

**Overriding kill rule, inherited from spec 05 and applied regardless of the table
above:** remove if adjusted precision falls below the control arm, or if genuine
false positives rise. A capability that costs prompt on every call and makes the
verifier MORE credulous is exactly what that record withdrew.

**Secondary observations, recorded but decision-free** (they cannot promote or
kill on their own): the refutation verdict mix (`proved` / `needs-more-evidence` /
`refuted`), the artifact-only population size, and the citation verification rate
— what fraction of emitted citations actually verified. That last one is the
mechanism's own health check: a low rate means the model is quoting badly, not
that the idea is wrong.

## Committed in advance

- **Three seeds per arm**, alternating order, single pinned engine SHA resolved
  once. Three seeds resolve roughly 11pp on this corpus; an effect smaller than
  that reads as null here, and that is a bound on the conclusion, not a reason to
  add seeds after seeing the number.
- **No optional stopping.** No re-runs, no extra seeds, no post-hoc subgroup.
- **Cost reported as measured**, alongside the $10.52 already spent this session.
- The engine carries one change that touches both arms equally: the reviewed diff
  is now redacted before it reaches a packet (`91f1a1f`). Both arms see it, so it
  cannot bias the comparison — but it means neither arm's absolute recall is
  directly comparable to figures recorded before `91f1a1f`.
