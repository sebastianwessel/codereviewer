# 18: Context Scout

Status: Approved (capability off by default; measured neutral)
Date: 2026-07-25

## Purpose

Give the reviewer the out-of-change code a defect depends on, **without** making the
reviewer go and get it.

Measurement drove this design. Cross-file defects are the dominant remaining recall
gap: of the five cases the reviewer misses on the real-repository corpus, four depend
on evidence outside the changed set. The obvious remedy — handing the discovery agent
repository tools (`16-agentic-cross-file-discovery.md`) — was built, hardened, and
measured three times, and it **lost** recall each time (flat at four cases, 66.7% to
44.4% at nine, 68.8% to 56.3% at sixteen) while precision stayed perfect. The public
literature names the same effect: tool use costs accuracy when context selection and
reasoning happen in one step, and the recommended remedy is to pre-assemble context
or delegate retrieval to a separate agent. Production security harnesses converge on
the same shape — plan and scope first, analyse second.

The context scout applies that separation: a **cheap, narrow model call decides what
extra code is relevant**, deterministic code **fetches it**, and the reviewer stays a
**single-shot, tool-free** review over a pre-assembled packet — the configuration that
measured 68.8% and 62.5% recall on the sixteen-case corpus in the two runs recorded in
this spec and in `16-agentic-cross-file-discovery.md`, at 100% adjusted precision with
zero genuine false positives in both. The spread between those two figures is the
run-to-run band `06-evaluation-and-quality-gates.md` requires be reported rather than
resolved to its best observed run.

## Mechanism

For each review task, when enabled:

1. **Scout.** One model call receives the task's diff and a compact inventory of the
   symbols the changed files reference from outside themselves (name plus the file
   that declares it, derived from the existing deterministic import/declaration
   facts). It receives **no file bodies and no tools**. It returns a bounded, ranked
   list of the symbols whose behavior the changed code's correctness depends on, each
   with a short reason.
2. **Resolve.** Deterministic code maps each requested symbol to a declaring file and
   extracts that symbol's **body** — not merely its signature — bounded per symbol and
   in total. A request that cannot be resolved is dropped; nothing is invented.
3. **Review.** The extracted bodies are injected as ordinary
   `referenced-definition` review context, which the discovery prompt already frames
   as context-only, never a review target. Discovery runs exactly as it does today:
   one call, no tools.

The scout never decides anything about findings. It only selects context. Its output
is untrusted input: a symbol it names is fetched only if deterministic resolution
finds it, and fetched content passes the same eligibility gate, redaction, and
containment as any other retrieval (spec 07).

## Why This Is Not Spec 16 Again

Spec 16 gave the *reviewing* agent tools, so one agent both chose context and judged
code. Here the reviewer's prompt shape and step count are unchanged; the only
difference is that its `referenced-definition` section contains bodies chosen for
this change instead of signature windows chosen by import frequency. If this also
fails to help, the failure is attributable to the *content* of the context rather
than to tool-use behavior, which spec 16 could not separate.

## Bounds And Cost

- One extra model call per task, over a small prompt (diff plus a symbol inventory),
  with a bounded number of requested symbols.
- Per-symbol and total byte caps on extracted bodies, so a large callee cannot flood
  the packet. The existing referenced-definition budget governs the section.
- The reviewer's packet still obeys `maxTaskInputBytes`; budget pressure sheds scout
  context before it sheds changed-file source.
- Disabled, no scout call is made and the referenced-definition section is produced
  exactly as it is today.

## Configuration

A `review.contextScout` block, disabled by default: `enabled` (default false),
`maxSymbols`, and `maxBytesPerSymbol`. Invalid configuration fails validation with
exit code 2. Keys are defined in `04-configuration-and-providers.md`.

## Observability, Safety, Privacy

- Scout steps are no-content: requested symbol count, resolved count, dropped count,
  and bytes injected. No source appears in logs or events.
- The scout cannot grant authority, change admission, severity, gates, or baseline,
  and cannot widen the eligibility gate. Repository content and the scout's own
  output are untrusted.
- Symbol extraction is deterministic and reproducible for a given tree.

## Testing

- Unit: symbol-body extraction (a body is captured whole, a nested body does not
  truncate early, an unresolvable symbol is dropped, per-symbol and total caps hold,
  and extraction is deterministic); the symbol inventory built for the scout prompt;
  the disabled path producing today's referenced definitions unchanged.
- Integration (hermetic, deterministic provider): with the scout enabled, a symbol it
  requests appears as `referenced-definition` context in the discovery packet and the
  discovery agent is still offered no tools and one step; a symbol the scout invents
  is not injected; with the scout disabled, no scout call is issued.
- No real-provider run in the test suite.

## Measured Outcome

**This measurement is void, and is retained only as a record of what was run.** Two
independent reasons, both recorded elsewhere in this repository rather than inferred
here:

- The arm was measured on an implementation that does not conform to the *Mechanism*
  section above — the scout is handed the full line-numbered discovery packet while
  its own prompt tells it that it has no file bodies, and the symbol inventory this
  spec requires is not built anywhere. `reports/2026-07-26-accuracy-and-measurement-plan.md`
  states the consequence directly: the neutral verdict "should be treated as void."
  See *Known Divergences From This Spec* below.
- It predates the harness-wide suppression of conversation history on 2026-07-27
  (see *Conversation History* in `21-independent-sampling.md`), so neither arm is
  comparable to a current run.

Nothing below may be quoted as evidence that the scout is neutral, harmful, or
helpful. The capability's default is unaffected: it was already off, and it stays off
until a conforming implementation is measured.

Measured on the sixteen-case real-repository corpus against the same-model baseline,
single variable, with zero provider errors in both arms: recall flat at 62.5%
(ten matched in each), **adjusted precision held at 100% with zero genuine false
positives**, severity accuracy unchanged at 70%, cost +27%. Four cases gained and
four lost — churn, not signal.

The reason the churn is noise is visible in the engagement data: the scout resolved a
symbol on only **three of eighteen tasks**. On thirteen of sixteen cases it added
nothing at all, so a flip on those cases cannot be attributed to it. Where it did
engage it stayed focused — one to three symbols, 879 to 2255 bytes — which is the
behavior the design intends and the opposite of the 162KB single reads that
characterised the tool-enabled reviewer.

Read against `16-agentic-cross-file-discovery.md`, the comparison is informative:
giving the reviewer tools cost recall in every measurement, while moving the same
job into a separate selection call costs nothing and damages nothing. Separating
selection from judgment removed the harm; it has not yet produced a gain. The
capability therefore stays off by default.

The actionable gap is engagement, not safety: either the scout is too conservative
about asking, or these cases' evidence is not reachable by naming a symbol in an
imported file. That is what a next iteration should attack, and a wider corpus should
confirm, before this ships enabled.

## Known Divergences From This Spec

Recorded on 2026-07-27 by an alignment audit. **These are unmet requirements, not
amendments.** The requirements above stand as written; this section exists so the gap
is visible instead of silent, and so no future measurement is run against a
non-conforming build without knowing it. Every item was verified against the
implementation in `src/domains/review-workflow/pipeline/discovery/context-scout.ts`
and its callers.

| Requirement | What the implementation does |
| --- | --- |
| *Mechanism*: the scout "receives no file bodies and no tools" | It is passed the discovery packet's full line-numbered changed-file content, while its own prompt asserts it has none. |
| *Mechanism*: a compact **symbol inventory** derived from the deterministic import/declaration facts | No inventory is built. The prompt requires every request to name a symbol "in the inventory" the model is never given. |
| *Mechanism*: resolution derived from existing deterministic facts | The declaring path is a model-supplied hint and the declaring line is found by a heuristic text scan. |
| *Mechanism*: bodies injected as `referenced-definition` review context | A string is appended to the review text after packet assembly, so a packet can carry two sections under the same heading. |
| *Bounds And Cost*: a **total** byte cap across extracted bodies | Only the per-symbol cap exists. |
| *Bounds And Cost*: the packet obeys `maxTaskInputBytes` and sheds scout context before changed-file source | The scout section is appended after budget fitting, so it is never measured or shed. |
| *Purpose*/*Bounds And Cost*: a **cheap** model call | The scout uses the same model alias as the reviewer; only the prompt is narrower. |
| *Observability*: a dropped count | Requested, resolved, and injected-byte counts are emitted; dropped is not. |

Closing these is a prerequisite for any future scout measurement. Until then the
*Measured Outcome* above is void, as that section states.

## Acceptance

- With `review.contextScout` disabled, no scout call is issued and discovery context
  is byte-for-byte what it is today.
- When enabled, the reviewer receives symbol **bodies** selected for this change, and
  the discovery agent remains single-shot with no tools.
- A symbol the scout names that deterministic resolution cannot find is never
  injected, and injected content never bypasses eligibility, redaction, containment,
  scope, severity, baseline, or the gate.
- Any recall improvement is demonstrated on the real-repository corpus against the
  current baseline, with adjusted precision not regressing; the capability ships
  enabled by default only on that evidence.
