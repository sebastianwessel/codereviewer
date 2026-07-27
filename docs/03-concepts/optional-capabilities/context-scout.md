# Context Scout (Removed)

The context scout was a **separate pre-review model call that chose which extra
symbols the reviewer should be shown.** It named out-of-change symbols,
deterministic code extracted their bodies, and those bodies were injected into the
discovery packet as referenced-definition context — while discovery itself stayed
single-shot and tool-free. It was **removed** on 2026-07-27: code, spec, and
configuration key.

There is nothing to configure here. `review.contextScout` was deleted from the
configuration schema, which is strict: a config file that still sets it now fails
validation with exit code `2`. Remove the block.

This page is the record of what it was and why it went, because the reasoning is
easy to rediscover badly.

## It was removed on mechanism, not on a failed measurement

**Its only A/B is void and may not be quoted in either direction — not as neutral,
not as harmful, not as promising.** Two independent reasons:

- It was measured against a build that **did not implement the spec it was being
  measured as**. The symbol inventory the scout's own prompt required every request
  to draw from was never built anywhere, and the scout was handed the full
  line-numbered discovery packet while its prompt told it that it had no file
  bodies.
- It predates the harness-wide suppression of conversation history (2026-07-27), so
  neither arm is comparable to a current run.

A void measurement is not a failed one. **The scout was never validly tested.**
Earlier versions of this page reported it as *measured neutral*; that verdict was
withdrawn.

## Why it was removed anyway

Three reasons, each of which holds without any measurement of the scout itself.

### 1. It adds context to a reviewer that is not reading the context it already has

The decisive number comes from a controlled decomposition experiment run on
2026-07-27, at production model, prompt, and temperature:

| | Diff shown | Diff withheld |
| --- | ---: | ---: |
| Candidates pointing at a line inside the unit they were shown | **16 / 76 (21%)** | 50 / 50 (100%) |

One 1251-line file returned the same finding at **line 820 from all 31 units it was
reviewed in** — including the unit spanning lines 1201–1251, where line 820 is 400
lines away and **was not in the packet at all**.

The reviewer answers the diff. Giving more context to a reviewer that is not
reading its current context is very unlikely to help — and that is precisely and
only what the scout did.

### 2. The blind spot it targeted was closed by something else

The scout existed for cross-file and caller-dependent defects, the dominant
residual misses on the 16-case corpus. Those were recovered by **a single added
prompt instruction** — the
[untrusted-input guard](../trust-model.md#the-shipped-prompt-injection-guard) — at
identical cost. Neither [cross-file retrieval](cross-file-retrieval.md) nor the
scout recovered them.

Be careful with the size of that win: the 62.5% → 81.3% first reported for the
guard came from a 16-finding corpus whose seed-to-seed deviation is 4.4pp, and
re-measuring on the 133-finding benchmark put the honest effect at about **+4pp**.
What matters here is the direction and the mechanism, not the magnitude. **Framing
beat retrieval.**

### 3. It did not implement its own spec

A spec audit found **six unmet requirements**, including the two named above plus:

| Required | What the implementation did |
| --- | --- |
| Resolution from deterministic import/declaration facts | Model-supplied path hint, declaring line found by heuristic text scan |
| A **total** byte cap across extracted bodies | Only the per-symbol cap existed |
| The packet obeys `maxTaskInputBytes`, shedding scout context before changed-file source | The section was appended *after* budget fitting, so it was never measured and never shed |
| A cheap model call | It used the same model alias as the reviewer |

Closing those is the entry price of a *first* valid measurement — real work, spent
to test a hypothesis reasons 1 and 2 give us cause to disbelieve.

## What this does not establish

**This is not evidence that retrieval-style or demand-driven context is
impossible.** Separating context selection from judgment has still never been
validly tested in this project. What is established is narrower:

- this particular implementation was never validly measured, so it has no verdict;
- the mechanism argues against it, because the reviewer demonstrably under-reads
  the context it is already given.

If you revisit this, bring a design that answers reason 1 first — some reason the
reviewer will actually read what it is handed — rather than a better selector in
front of the same reviewer. A better chooser upstream of a reviewer that answers
the diff changes nothing about what the reviewer answers.

## Related

- [What limits recall](../../05-quality/what-limits-recall.md) — the enumeration
  gap, why attention follows the diff, and every intervention measured against it
- [Cross-file retrieval](cross-file-retrieval.md) — the *other* approach to the
  same blind spot, measured and net negative; it still exists, off by default
- [Extra discovery passes (removed)](extra-discovery-passes.md) — three further
  removals, each with a real (failed) measurement behind it
- [Optional capabilities](README.md) — what actually ships as a switch
