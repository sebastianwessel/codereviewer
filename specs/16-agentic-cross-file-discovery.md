# 16: Agentic Cross-File Discovery

Status: Approved (capability **enabled by default** since 2026-08-01; the earlier
"measured net negative" verdict is **overturned** — see *Measured Outcome*)
Date: 2026-07-24
Amended: 2026-08-01 — default flipped on; the per-read excerpt cap removed (spec 28)
Amended: 2026-08-07 — a configured `paths.include` no longer refuses this lane's
traversals (specs 04 and 07)

## Purpose

Close the cross-file recall gap. Holistic discovery sees only the changed files,
the diff, and bounded signature-level digests of directly-imported unchanged files
(the referenced-definition context injection defined under *Review Planning* in
`05-review-workflow-and-runtime.md`). Defects whose presence depends on the
*behavior* of code in another
file are therefore invisible: on the committed benchmark, cross-file recall is
**0%**. The dominant cross-file misses are high-severity authorization defects — a
changed file calls a helper defined elsewhere (e.g. `getOrCreateResource`,
`findByName`) and the bug is a mismatch between how that helper creates a resource
and how the changed code looks it up. Catching these requires the callee's *body*,
not its signature.

This spec adds a bounded, **tool-enabled discovery mode**: during discovery the
model may read specific other-file code on demand through the same mediated
retrieval seam the verification flow already uses, then reason with it.

## Non-Negotiable Reuse

This is not a new pipeline. It reuses these existing components:

- the **context-retrieval** domain (`ContextRetriever`: mediated `read`/`list`/`grep`
  with eligibility, redaction, byte/match caps, path containment — spec 07);
- the **bounded tool wrapper** (`createBoundedRetrievalTools`) that caps total tool
  calls in CODE, shared by the per-claim investigation lane and the per-task
  discovery lane;
- the **harness tool-agent loop** and the custom-tool wiring that `investigate_claim`
  (spec 12) already uses (`repo_read`/`repo_list`/`repo_grep`, `builtinTools: false`,
  `maxSteps = budget + 1`);
- the existing **holistic discovery output** and the shared **refutation + admission**
  filter. Retrieved-context findings are ordinary candidates and face the same gate.

## Mechanism

When enabled, the holistic discovery agent for a task is given the mediated
`repo_read`/`repo_grep`/`repo_list` tools and a per-task tool-call budget. Its
instructions direct it to use them **only** when a concrete suspected defect's
presence or absence depends on the behavior of a symbol it cannot see in the provided
context (an imported callee, an interface contract, a permission definition) — read
that symbol before deciding, rather than guessing or staying silent. It then emits
findings as today.

- **Bounded by a runaway-loop guard.** A per-task cap on total tool calls is enforced
  by CODE (not the model), mirroring `verification.maxToolCallsPerClaim`. Its purpose
  is to stop a model that never stops requesting reads, NOT to ration context:
  measurement showed the model self-limits well below the cap (0-7 calls when 8 were
  allowed, never exhausting it), so a tight cap only starves the tasks that genuinely
  need several lookups. The cap is therefore set generously; focus comes from the
  instruction to retrieve only what a specific suspicion requires, and from the
  retriever's own per-call byte/match caps. "More context reduces quality" — the
  measured result recorded under *Withdrawal Of The Context Scout* in
  `05-review-workflow-and-runtime.md` — is respected by demand-driven, targeted
  reads, never a whole-repository dump. That same finding sharpens the caution: the
  reviewer largely does not read the context it already holds.
- **Steps, not delegation budget.** A mediated tool call is an agent STEP, bounded by
  the discovery agent's step allowance. The allowance MUST exceed the tool-call cap by
  enough headroom that a model which exhausts the budget can still receive the
  recoverable budget error and answer; too tight an allowance makes the agent loop
  throw `iterations_exceeded`, costing the task every finding it had — the opposite of
  an additive mode. A tool call never counts against the workflow's child-agent call
  budget, which counts agent invocations.
- **Mediated and safe.** Every read/list/grep goes through `ContextRetriever`:
  eligibility gate (no dotfiles, `node_modules`, `.git`, secrets, excluded globs),
  redaction, path containment (no escape via symlink, re-checked against the real
  target), and repository content treated as untrusted (spec 07). Retrieved content
  cannot grant authority, change admission, severity, gates, or baseline, and the
  discovery prompt is hardened against injection from it.
- **Traversable is not readable.** This lane is the one that starts traversals —
  `repo_grep` with no `paths` walks from the repository root — so it is where the
  include layer's scope matters most. `paths.include` scopes FILES: a directory is
  traversable when an included file could live beneath it, and every entry that
  traversal yields is gated individually as a file. The rule is defined under
  *Paths* in spec 04 and its safety requirements under *Mediated Read Eligibility*
  in spec 07. Before it, an operator who scoped the review to a subtree got a
  discovery lane whose `repo_grep` and `repo_list` were refused outright.
- **Deterministic mediation, non-deterministic use.** The tool surface and its bounds
  are deterministic; the model's decision to call a tool is not. Like every other
  model lane it is quarantined: findings still pass untrusted refutation and
  deterministic admission, so the precision guarantees are unchanged.
- **Additive to recall only.** With the mode disabled, discovery is a single-shot
  review with no tools and the run is byte-for-byte unchanged: the cross-file prompt
  segment is a strict SUFFIX of the base discovery prompt, so the disabled prompt is
  unchanged to the byte and every configuration shares the longest possible cached
  prefix. Enabling it can only let the model see more; it never removes a finding the
  single-shot pass would make.
- **Partitioned with the task.** A task whose files are partitioned across several
  discovery calls (spec 27) exposes the tools on each call, and each call carries its
  own bounded tool budget.

## Truncation Must Be Disclosed

A read that is cut and not disclosed is worse than no read: the model concludes a
guard is absent from a file it only partly saw, which is exactly the "recall falls,
precision holds" signature this capability's original verdict recorded.

**The rule is about truncation, not about tools, and it was scoped too narrowly.**
Amended 2026-08-07. As written below it reads as a property of `repo_read`,
`repo_list` and `repo_grep` output — so it did not reach the referenced-definition
digest the discovery packet builds, which no tool mediates. That digest was cut at a
byte budget with no disclosure and, because the cut was not line-aware, could end
mid-line and present a fragment of a source line as if it were the whole line. The
defect sat outside this section purely because of where the section was drawn.

**The rule therefore binds every truncation this engine performs on text a model
reads**, whatever produced it — mediated tool output, packet sections, digests,
summaries. Each of the requirements below applies to all of them; the tool wording
that follows is an instance, not the scope.

**A cut MUST fall on a boundary the format itself defines.** A digest whose skipped
regions are marked cannot end unmarked, because within that format an unmarked end
asserts that nothing follows; and a cut taken at a byte offset rather than a line
boundary makes the packet state something false rather than merely incomplete. That
distinction is what makes such a fix correctness rather than a recall bet — see spec
05's referenced-definition bullet.

So:

- A read that is narrowed MUST say so in the content the model reads, not only in a
  field it may ignore, and MUST state that absence of something below the cut is not
  evidence the thing is missing.
- The read MUST report the file's total line count, so the model can decide whether
  what it received is the whole file.
- `repo_read` MUST accept an optional `startLine`/`endLine` range so the model can
  narrow deliberately after locating what it needs with `repo_grep`. A prefix chosen
  for the model is the worst possible guess: the definition worth consulting is rarely
  at the top of a file.

Spec 28 owns this design and its rationale.

## Refusals Must Be Disclosed

The same argument applies to a lookup that returned nothing at all, and until
2026-08-06 this spec's promise to the model was false. The prompt segment tells the
reviewer that "a path may be reported as not found, not eligible, or
budget-exceeded" and to treat that as information. It was not reported: the harness
normalizes any non-harness error to `Tool execution failed.` and drops the message,
so every one of those conditions reached the model as an unexplained failure and it
filled the gap the way it fills every gap — the code it meant to check is not there.
That promise now holds. So:

- The conditions a caller is EXPECTED to hit are a CLOSED, typed set: path not
  eligible, path not found, retriever read budget exhausted, retriever search budget
  exhausted, plus the scope's own tool-call bound. Each is disclosed as ordinary
  tool-result content that names the specific reason, in ONE shape shared by every
  lane exposing these tools, so a model never learns two vocabularies for "your
  lookup did not happen".
- Each disclosure MUST state that the tool did not run and returned no repository
  content, and that this is **not** evidence that anything is absent, correct, or
  safe. A refusal that a model can mistake for an observation is worse than no tool.
- Everything else is a FAULT and MUST propagate. A **path-containment violation in
  particular is never disclosed**: an escape from the repository root is a
  security-relevant invariant breach, not a condition to shrug off. The distinction
  is made by ERROR TYPE, never by matching an error message, so a reword in a shared
  helper cannot silently reclassify a containment breach as an ordinary miss.
- A disclosure carries only the tool id and the repository-relative path the caller
  itself supplied — never file content, an absolute filesystem path, or which
  eligibility rule fired. Eligibility is evaluated before existence, so a refusal
  cannot be used to probe for excluded or secret files.

## Configuration

A `review.crossFileRetrieval` block. Keys are defined in
`04-configuration-and-providers.md`:

- `enabled` — **default true** (see *Measured Outcome*). With it false, no discovery
  tool call is issued, no tool is registered on the harness, and the discovery agent
  is configured exactly as it was before this spec (no tools, compact step allowance).
- `maxToolCallsPerTask` — the runaway-loop guard, bounded 1–500, default 100.
- `maxBytesPerRead` — **optional and unset by default** (spec 28), bounded
  1 000–4 000 000 when set. It used to default to 24 000 bytes; that value was chosen
  defensively, never measured, and is the bug the original verdict was measuring.
  Setting it is a deliberate operator choice and still binds, with the cut disclosed.

Invalid configuration fails validation with exit code 2.

With `maxBytesPerRead` unset, the only per-read bound is the retriever's own runaway
guard — sized against memory (4 MB), not against a context window, so it is far
beyond any plausible source file. When a tool-enabled discovery call is refused by
the provider for oversized context, that read allowance is **halved and the call
retried, before any task split is attempted**: splitting cannot help when the
overflow came from a tool result, because each half would fetch the same file.
Reduction stops at a floor below which a read is not worth the round trip, and a call
that still overflows there falls through to splitting rather than degrading silently.

## Budget And Cost

Enabling the mode adds, per task, the mediated reads the model actually requests (in
practice far below the cap) plus the discovery steps to consume them. No child-agent
call reservation is needed: tool calls are agent steps, not agent invocations. Cost is
accounted for by the existing transport-level usage recorder (no new accounting).
Measured cost is not an increase: both post-fix arms cost **less** with the mode on
than off (−7%, −5%).

## Observability, Safety, Privacy

- Discovery tool calls are no-content: tool, path, byte counts, and durations only;
  redacted retrieved content is recorded in the context ledger exactly as the
  verification flow records it. No secret value or payload appears in logs or events.
- The per-task tool-call bound, retrieval budgets, and eligibility gate are the hard
  floors; the model cannot widen them.

## Testing

- Unit: the generalized bounded per-task tool wrapper caps total calls in code and
  reports budget exhaustion; the disabled path configures the discovery agent with no
  tools and the compact step allowance (byte-for-byte unchanged prompt); the retriever
  mediation (eligibility, redaction, containment) is exercised as today.
- Unit: each expected condition, driven through the real retriever and the real tool
  handlers, produces content naming that reason and stating it is not evidence about
  the code; a containment violation still throws; the disclosed text passes the
  prompt-genericity guard.
- Integration (hermetic, deterministic provider): a planted cross-file defect whose
  evidence lives in an unchanged imported file is caught only when the mode is enabled
  and the model reads that file; a run with the mode disabled is unchanged; an
  untrusted payload in a retrieved file cannot alter admission or the gate; the
  per-task tool-call budget bound is enforced by code even if the model keeps
  requesting reads.
- No real-provider run in the test suite; cross-file recall is measured in the
  explicit, cost-gated eval.

## Measured Outcome

### The withdrawn verdict, and why it does not stand

This capability shipped **off by default** on a recorded verdict of "measured net
negative". Three single-seed arms on the corpus built to favour it: at four cases the
result was flat (one gained, one lost) at 2.5x cost; at nine cases recall fell 66.7%
to 44.4% (two lost, none gained) at +78% cost; at sixteen cases recall fell 68.8% to
56.3% (one gained, three lost) at +71% cost. Adjusted precision stayed at 100% in
every arm, so the loss was recall, not noise.

**That verdict is overturned.** Every one of those arms was measuring a defect, not
the idea. `maxBytesPerRead` cut each retrieved file mid-content and the model-facing
tool output carried **no truncation field at all** — the summary said only *"Read
&lt;path&gt; for investigation context"*. A model handed a file that stops at an
arbitrary line, with nothing saying it continued, concludes a guard is absent when the
guard was below the cut. That mechanism produces *precisely* the recorded signature —
recall falls, precision holds — and it was never ruled out (ledger, 2026-08-01).

The record is kept rather than rewritten: the withdrawal was reached honestly against
the evidence available, and the evidence was wrong because the implementation was.
This is the third withdrawal in this project voided by a defect found afterwards.

### The re-measurement

Two paired runs on the 37-case real-repository corpus (87 expectations), pinned
engine, after the cut was disclosed to the model:

| | recall | adjusted precision | cost |
|---|---|---|---|
| run 1, off | 42.5% | 97.4% | $2.05 |
| run 1, **on** | **48.3%** | **100%** | **$1.89** |
| run 2, off (shipped defaults) | 43.7% | 95.0% | $2.31 |
| run 2, **on** | **46.0%** | **100%** | **$2.20** |

Run 1: **+5.7pp**, 95% CI [−1.1, 12.6], discordant 9 (gained 7, lost 2), McNemar
z 1.67, **p = 0.096**. Run 2: **+2.3pp**, 95% CI [−4.6, 9.2], discordant 10 (gained 6,
lost 4), McNemar z 0.63, **p = 0.527**. Zero provider errors across all four arms;
latency inside noise.

### What is and is not claimed

**Not claimed: any specific improvement.** Neither run reaches significance, and the
second is much weaker than the first. Two runs, one model, one corpus, both positive
in direction, is *not* evidence of a recall benefit and must never be quoted as one.

**Claimed: nothing measured argues against it.** Recall up twice, adjusted precision
at 100% twice, cost down twice, latency inside noise, no provider errors. Significance
is the bar for CLAIMING a benefit; it is not the bar for permitting a default that is
free, harmless, and directionally positive twice. Holding it off until a gain is
proven would also keep it off for models that use tools better than the one it was
measured on, and this is precisely the kind of capability whose value is
model-dependent.

**If a regression appears, this is the first switch to flip.**

Two caveats on the figures, so nobody re-derives them:

- Both arms ran against the **disclosed 24 000-byte per-read cap**, which was still
  the default at the time (run 1 additionally set `maxToolCallsPerTask: 8` against a
  default of 100). The shipped configuration — no proactive per-read cap, halve-and-
  retry on a provider overflow — is **unmeasured**. So is the interaction with a
  larger tool-call budget.
- The **0% cross-file recall** quoted in *Purpose* is a property of the slices it was
  measured on, not of the engine: a changed-files-only slice contains no other file to
  read, so a cross-file defect cannot be represented in it at all. The user
  documentation on datasets records this directly. The consequence is that the final
  acceptance criterion below cannot be evaluated against that baseline; it needs a
  general cross-file recall metric, which does not exist yet.

## Acceptance

- With `review.crossFileRetrieval` disabled, discovery issues no tool call and the
  discovery prompt is byte-for-byte the base prompt.
- When enabled, discovery may read other-file code through the mediated retriever,
  bounded by a code-enforced per-task tool-call cap; retrieved-context findings pass
  the same untrusted refutation and deterministic admission as any other candidate.
- The mode never bypasses eligibility, redaction, path containment, scope, severity,
  baseline, or the gate.
- A narrowed read is disclosed to the model, reports the file's total line count, and
  can be re-issued for a specific line range.
- Any cross-file recall improvement is demonstrated by measurement (cross-file recall
  vs the 0% baseline) without a regression to overall recall or adjusted precision.
