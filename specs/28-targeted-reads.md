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

## Measurement Plan

Against the 37-case real-repository corpus — the only corpus with full working trees,
so the only one where retrieval does anything — with cross-file retrieval on in both
arms, pinned engine, paired.

| arm | |
|---|---|
| control | reads capped at 24,000 bytes (today) |
| **1** | targeted reads, no proactive cap |

Pre-registered:

- Recall movement inside **±4.8pp** is not a result.
- **Adjusted precision MUST NOT fall** below the control.
- Report cost and the number of overflow-driven retries. If retries are frequent the
  design is wrong and the reduction should start earlier.
- A gain is the expected direction, because the cap demonstrably removed information
  the reviewer had asked for. That expectation is a prediction, not a result.
