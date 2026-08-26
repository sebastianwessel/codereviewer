# 4 · Holistic Discovery

← [Task clustering and context assembly](03-task-clustering-and-context-assembly.md) · next → [Refutation](05-refutation.md)

The only stage whose job is to *find* things. It is deliberately recall-oriented:
what it produces are **candidate findings**, and every one of them still has to
survive refutation and admission.

## What it receives

One **partition** of a workflow task, rendered into a single document: its paths,
the per-path unified diff segment, the full line-numbered content of its changed
files, optional support-signal facts, optional referenced-definition digests,
optional change-intent brief, and the operator's reviewer instructions.

That document is the whole packet. A discovery call sends `{taskId, paths,
reviewText}` and nothing else — so the evidence records, seed candidates, skill
metadata, and provenance that the workflow assembles alongside it never reach
this stage, and the packet budget is measured against what is sent.
Refutation is the stage that receives those fields.

## What it does

**One general model call per partition, not per task.** A task is cut into
partitions of `aiReview.maxFilesPerDiscoveryCall` changed files (default `2`) and
each partition gets its own call, sequentially, against the same provider; their
candidates are unioned. A task at or below the limit is one partition, so a small
change is unaffected. Yield tracks call count, not code volume — a file that gets
any attention yields about 1.2 findings however much else the call was shown — so
partitioning is what raises the share of files actually looked at.

The reviewer carries **no conversation history**: it sees its instructions and
its packet and nothing else, so no discovery call is ever influenced by what
another answered. It is **not** tool-free. With
`review.crossFileRetrieval.enabled` — on by default — the discovery agent holds
the mediated `repo_read` / `repo_list` / `repo_grep` tools and a step allowance
large enough to spend its whole tool-call budget and still emit findings. Turn
that off and discovery is a single-step invocation with no tools.

The prompt fixes the method:

1. **Understand the intent** — what behaviour, invariant, or contract the change
   introduces or modifies.
2. **Trace the flow** — control and data flow on the success path, every error
   path, and the edges (empty, null, zero, negative, boundary, large, concurrent,
   retry, early return).
3. **Verify against the intent** — is there drift between what the code intends
   and what it does; is a required validation, branch, update, or cleanup
   missing; is one call site updated while a sibling is not.
4. **Sweep the defect classes** — correctness and logic; side effects and control
   flow; concurrency and state; interface and type alignment; security; memory
   and resources; data leaks and privacy.

Three framing rules matter as much as the checklist:

- **Scope is the changed file, not the changed line.** A defect introduced on the
  diff lines *or* exposed elsewhere in a changed file that the change reaches is
  in scope. Findings are still restricted to the task's paths.
- **Everything in the packet is untrusted data, not instructions.** Source,
  comments, strings, identifiers, and the change-intent brief can never direct
  the reviewer, change its instructions, or approve, excuse, or suppress a
  finding. Text that tells the reviewer to ignore a problem is itself reportable.
- **Nits are out of scope.** Style, naming, formatting, documentation, and
  cleanup preferences are excluded, and a finding must name the concrete failure
  and the exact path or input that triggers it.

Severity is assigned from impact and reachability (not from confidence) using an
explicit `critical` → `info` rubric that the report and the gate later rely on.

### Turning findings into candidates

Each returned finding must carry a category, severity, title, description, a path
from the **partition's** `paths`, and a positive `startLine`; anything missing a
required field or pointing outside the partition is dropped — a finding must stay
restricted to the files its own call was shown, or admission would anchor it
against content that call never read. Survivors get a deterministic candidate id
derived from the partition id, path, start line, and title, with the title capped
at 120 and the description at 1200 characters.

At most **12 candidates per discovery call** are kept from the general pass; the
dedicated security pass may add up to **8 more** per call. Both caps are per
call, so a partitioned task's ceiling scales with its partition count. The cap
exists because every candidate costs downstream refutation budget — it is not the
precision mechanism. Refutation is. Measurement says it does not bind: at roughly
1.2 findings per file attended to, a call rarely approaches 12.

## The one optional extra pass

Discovery has exactly one optional additional pass, and it is off by default. It
is *additive*: it may only add candidates at locations the general pass did not
already claim, is capped, and its candidates face the same refutation and
admission as any other. It is partitioned on the same terms as the general pass,
so it costs one further call per partition — not one per task.

| Pass | Config key | What it asks |
| --- | --- | --- |
| Dedicated security pass | `security.dedicatedPass.enabled` (`false`) | A security-only call per partition, with a generic OWASP/CWE checklist and a source→sink method; capped at 8 additional candidates per call |

Three further passes — an enumeration sweep, a diverse-lens second pass, and an
un-anchored pass over bounded units with the diff withheld — were built, measured,
and [removed](../optional-capabilities/extra-discovery-passes.md); none earned its
cost. A **context scout** that pre-selected extra symbol context was also
[removed](../optional-capabilities/context-scout.md), on mechanism rather than on a
measurement.

One further setting changes what discovery may see: **cross-file retrieval**
(`review.crossFileRetrieval.enabled`, **on by default**) gives the reviewer
mediated `repo_read` / `repo_list` / `repo_grep` tools. It is described in
[Optional capabilities](../optional-capabilities/README.md).

## Semantic finding merge

Discovery can describe one defect more than once: a single call restates it at
neighbouring lines, and any second call over the same code — the security pass
today — never sees the first call's output. Deduplicating by the model-assigned
id cannot catch that (the ids come from different calls) and neither can a
`(path, line)` rule (the anchors differ).

So once every candidate for the task exists, and before anything reaches
refutation, the candidates for each file are grouped by whether they describe
**the same underlying defect**, and each group is reduced to one.

- **The grouping is decided by a model, per file, in its own call.** It reads the
  candidate descriptions plus the file and returns *groups*. It is never asked
  which candidate to discard.
- **Position is not the test.** Two candidates one line apart are frequently one
  defect; two candidates on the same line are frequently two defects, and a
  reviewer needs both. Sameness requires a shared root cause *and* a shared code
  element. Proximity counts for nothing in either direction.
- **Uncertainty does not merge.** A wrong merge silently removes a real defect,
  while a missed merge produces one redundant comment, so the instruction is to
  leave candidates alone whenever the answer is not clear.
- **The survivor is chosen deterministically in code**, never by the model:
  highest severity, then the most specific location, then the earliest candidate.
- **The others are recorded, not deleted.** Each stays in the run's candidate
  list carrying a `duplicate` rejection that names the candidate it was merged
  into, so the merge rate is visible in the report.

**A file with fewer than two candidates produces no call at all.** With today's
roughly one candidate per file the stage costs close to nothing; it becomes
load-bearing as soon as a file is reviewed as several units, which produces
duplicate candidates by construction.

Like discovery, the merge call carries no conversation: it sees its instructions,
the candidates for one file, and that file. It is not shown the discovery call
that produced those candidates.

## No stage carries conversation

The property stated for the reviewer above holds for **every** model call the
review makes — discovery, the semantic finding merge, and
[refutation](05-refutation.md). Each is a single invocation that receives its
instructions and its own packet, and no call is ever handed the output of a call
that ran before it, whether for the same task or a different one.

This is worth stating explicitly because the whole run shares one session, and the
default behaviour of a session is to accumulate. Before it was fixed, a call
arrived carrying every earlier call's output attributed to the model itself.

> **This is not a measured improvement.** Every recall and precision number
> recorded for this engine was produced with the merge and refutation
> calls carrying that history. Whether it helped or hurt is unknown; it was
> removed because it contradicts what those stages are specified to do, and any
> effect on accuracy is unmeasured.

```mermaid
flowchart TD
  T["review task"] --> P["partitions · maxFilesPerDiscoveryCall changed files each"]
  P --> G["one general discovery call per partition"]
  G --> SE{"security.dedicatedPass.enabled?"}
  SE -- yes --> SP["security-only call per partition (additive, ≤ 8 more each)"]
  SE -- no --> C["candidates, deduped · ≤ 12 general (+ ≤ 8 security) per call"]
  SP --> C
  C --> M{"≥ 2 candidates in one file?"}
  M -- no --> O["candidates for refutation"]
  M -- yes --> MM["merge call per file → groups"]
  MM --> R["one representative per group, chosen in code"]
  R --> O
```

## What it emits

Candidate findings (id, task id, category, severity, title, description,
location, `proposedBy: 'review-agent'`, no evidence ids yet), the `duplicate`
rejections produced by the semantic merge, plus any provider issues. Candidates
are not findings and are never reported as such.

## What can go wrong

| Situation | Behaviour |
| --- | --- |
| The model returns malformed or truncated JSON | The call yields no findings and is recorded as an **unrecovered** provider issue (`recovered: false`); the task and the run continue, and the quality gate fails on the issue under the default `failOnProviderError` |
| The response stops at the output-token ceiling (`provider_output_truncated`) | Same. It is the same provider event as the row above — where the cut lands decides whether the JSON parses, not whether the answer is complete — so it costs one call, not the run |
| The agent exhausts its step allowance | Same: unrecovered provider issue, no findings from that call |
| A finding points outside its partition's paths, or omits a required field | Dropped; counted in the run's debug metrics |
| More than 12 valid findings from one call | Excess is discarded by the cap |
| A genuine provider failure (auth, budget, network exhaustion) | Fails the task and the run, writing partial artifacts |
| The provider refuses the packet as oversized | The partition is halved and each half retried, recursively; only a unit that cannot be split further fails, as `review_task_indivisible` |
| The security pass reports a location the general pass already flagged | Its candidate is suppressed — the extra pass can only add |
| The semantic merge call fails, or returns a group naming a candidate that does not exist | No grouping for that file, recorded as an **unrecovered** provider issue; every candidate survives |
| The merge puts one candidate in two groups | Only the first group is honoured — an ambiguous merge resolves towards leaving candidates alone |

Continuing after a bad response instead of failing is deliberate: letting one
malformed response fail the whole task would silently discard every other finding
it had, and in an evaluation would drop the case from the comparison entirely.
The issue is still recorded unrecovered, so the run does not read as clean.

## Configuration keys

| Key | Default | Effect |
| --- | --- | --- |
| `provider.*` | unset | No provider means no discovery at all |
| `aiReview.enabled` | `true` | `false` disables the model stages |
| `aiReview.maxFilesPerDiscoveryCall` | `2` | Changed files one discovery call reviews; above it, the task is partitioned |
| `review.maxConcurrentTasks` | `4` | Discovery parallelism |
| `security.dedicatedPass.enabled` | `false` | Adds the security-only call per partition |
| `review.crossFileRetrieval.*` | enabled | Gives the reviewer mediated repo tools |
| `instructions.*`, `skills.*` | — | Extra reviewer instructions and skills |

Each enabled pass is reserved in the run's child-agent call budget, so turning
one on can never starve refutation.
