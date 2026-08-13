# 28: Targeted Reads Instead Of A Guessed Read Cap

Status: **Approved** (human, 2026-07-31)
Date: 2026-07-31

## Purpose

Remove the last guessed upfront limit in the review path. **Let the reviewer ask for
the part of a file it needs, and shrink only when a real limit is actually hit.**

## The Problem

Cross-file retrieval exists so the reviewer can open the callee, interface, or
permission definition a suspected defect depends on. Every such read was cut at
**24,000 bytes**, chosen defensively and never measured.

That cap did real damage. It cut files mid-read while telling the model nothing, so
the reviewer concluded things were absent from code it had only partly seen — and
three separate measurements recorded the feature as harmful when they were measuring
the cap. The verdict was wrong for months and the feature shipped disabled because
of it.

The cut is disclosed now, which makes the failure honest. It does not make the limit
right: 24,000 bytes is roughly 600 lines, and the files most worth consulting —
the large interface, the central service — are exactly the ones it truncates.

## Design

1. **No proactive byte cap on a read.** A read returns the file.
2. **The reviewer can ask for a line range.** `repo_read` accepts an optional
   `startLine`/`endLine`. Combined with `repo_grep`, the model locates what it needs
   and reads that, rather than us guessing a prefix for it. A prefix is the worst
   possible guess: definitions are rarely at the top of a file.
3. **A read reports the file's size and how to narrow it.** When a file is large the
   output says so and names the range facility, so narrowing is the model's informed
   choice rather than our silent one.
4. **On a real overflow, shrink and retry.** If a tool-enabled discovery call fails
   with the provider's normalised `context_length_exceeded`, the read budget is
   halved and the call retried, before any task split is attempted. The limit that
   binds is then the provider's, discovered by hitting it.
5. **A runaway guard remains**, sized against memory rather than context — a read
   cannot materialise an arbitrarily large file — and it refuses loudly.

## Requirements

- A read MUST NOT be silently truncated. Any narrowing MUST be disclosed.
- The per-read limit MUST NOT be sized against a context window. It is a runaway
  guard against materialising a pathological file, and its value MUST be far beyond
  any plausible source file.
- `repo_read` MUST accept an optional line range, and MUST report the file's total
  line count so the model can narrow deliberately.
- An oversized-context failure on a tool-enabled call MUST cause a read-budget
  reduction and retry BEFORE the task is split. Splitting a task does not help when
  the overflow came from a tool result, because the retry would fetch the same file.
- Reduction MUST be bounded, and a call that still overflows at the floor MUST fail
  loudly rather than silently degrade.
- An explicitly configured `crossFileRetrieval.maxBytesPerRead` MUST still bind — a
  deliberate operator choice — and MUST disclose when it does.

## Why Not Just Raise The Number

Raising 24,000 to some larger number repeats the mistake at a different value. The
point is that no value chosen in advance is correct: it depends on the file, the
model, and how much else is already in the packet. The provider knows; we do not.

## Status: SHIPPED AND UNMEASURED

**Recorded 2026-08-13. This change shipped on by default on 2026-07-31 and has never
been measured — it is the only shipped default in this spec set with no measurement
anywhere.** Nothing below is withdrawn; the diagnosis of the 24,000-byte cap under
*The Problem* is independently corroborated by the spec 16 verdict reversal, and this
section is about what happened *after*.

**Verified by command.** `grep -niE "spec 28|targeted read|maxBytesPerRead"` over the
3,450-line `reports/eval-results-ledger.md` returns **two hits, both inside spec 16's
entries**, where `maxBytesPerRead` appears as the cap being diagnosed. There is no
entry for this spec, the Measurement Plan below has never been run, and until now
nothing recorded it as outstanding.

**What is being assumed in the meantime**, stated so the assumptions are visible
rather than inherited:

1. **That removing the cap is net-positive on recall.** This is a prediction, and the
   plan below still labels it one. The evidence for it is indirect: three
   measurements recorded cross-file retrieval as harmful while the cap was in place,
   and the verdict reversed when a *different* truncation defect was fixed (ledger,
   2026-08-01). That establishes the cap was doing damage; it does not establish the
   size or sign of removing the remaining ceiling.
2. **That the overflow-and-shrink safety net is sufficient containment.** It is aimed
   at the one failure this project has measured to be **absent**: spec 26's A/B
   recorded the provider refusing **zero** packets across 21 cases including one
   carrying 1.2 MB of changed source. *"The provider knows; we do not"* names an
   authority that has never yet said no, so requirement 4 (halve and retry on
   `context_length_exceeded`) is, like spec 26's split path, defended by unit tests
   alone. What is therefore uncontained is not a context error — those are loud — but
   **token spend and attention dilution**, which are silent.
3. **That an unbounded read costs what one read costs.** It does not, under this
   project's own shipped default. `reports/2026-08-07-subfile-partitioning-result.md`
   records that *"in any partitioned mode the token cost is dominated by
   shared-context duplication, not by the reviewed file body"*, and spec 27 partitions
   at 2 files per call by default — so a `repo_read` of a large generated, vendored or
   bundled file is paid **once per partition**, not once.

**The unstated tension with spec 27, named here because neither spec cites the
other.** Spec 27's model has per-file attention decaying as `shown^-0.30` and
partitions in order to reduce what one call is shown; spec 28 removes the ceiling on
what that same call can pull into itself. The two optimise in opposite directions and
no document arbitrates between them. That is not an argument that either is wrong —
spec 27's decay model is itself now qualified (see spec 27, *The Yield Law Does Not
Extrapolate*) — but an operator tuning either one should know the other exists.

## Measurement Plan

**Never run.** Kept as written, with two corrections that must be applied before it
is run rather than after.

Against the 37-case real-repository corpus — the only corpus with full working trees,
so the only one where retrieval does anything — with cross-file retrieval on in both
arms, pinned engine, paired.

| arm | |
|---|---|
| control | reads capped at 24,000 bytes (today) |
| **1** | targeted reads, no proactive cap |

Pre-registered:

- ~~Recall movement inside **±4.8pp** is not a result.~~ **Superseded.** The ±4.8pp
  band was retracted by the 2026-08-07 variance correction: four three-seed estimates
  of the same quantity span 2.22–8.38pp, pooled **5.71pp**, and *"three seeds resolve
  ~11pp"*. A plan whose non-result band is 4.8pp on an unstated seed count cannot
  resolve its own bar; restate the band from the pooled figure and state the seed
  count, or the run produces a number that means nothing.
- **Adjusted precision MUST NOT fall** below the control. (Cite no precision delta
  from a two-arm harness without alternating arm order per seed — the recorded
  arm-order artifact gives the second arm +5–6pp raw precision with a tighter sd,
  replicated across two unrelated interventions.)
- Report cost and the number of overflow-driven retries. If retries are frequent the
  design is wrong and the reduction should start earlier. **Report bytes read per
  discovery call as well**, and multiply by the effective partition count: assumption
  3 above is what this run is really being asked about, and a recall-only report
  cannot see it.
- A gain is the expected direction, because the cap demonstrably removed information
  the reviewer had asked for. That expectation is a prediction, not a result.
- Run the free measurability precheck first, on data already on disk: count how many
  corpus cases issue a read that the 24,000-byte control would have cut. If the two
  arms are byte-identical on most cases, this A/B costs money to produce noise — the
  failure spec 26's precheck caught before it was paid for.
