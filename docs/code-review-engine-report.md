# CodeReviewer — What It Is, How Good It Is, and What We Learned

> **Who this is for:** anyone who wants to understand our AI code‑review engine
> without reading the code — what it does, why it matters, how well it works
> compared to other tools, and what our recent round of improvement work found.
>
> **Last updated:** 2026‑06‑25. All performance numbers are our own measurements;
> we flag where they should be read with caution.

---

## In one minute

- **What it is:** a tool that automatically reviews a code change (a “pull
  request”) and points out real problems — bugs, security holes, broken logic —
  the way a careful senior engineer would.
- **How good it is:** on a realistic test set of 59 real‑world changes, it finds
  about **39% of the important bugs**, and **~53% of what it flags is a genuine
  problem** (i.e. fairly low noise). That puts it **on par with the best
  commercial tools** on the same kind of test.
- **The honest catch:** *no* tool in this field is great yet — the best ones catch
  only **30–40%** of bugs. Catching ~1 in 3 with low noise *is* roughly the state
  of the art.
- **What we tried recently:** a series of experiments to push accuracy higher.
  Most **did not work**, and we explain why. The durable wins were a **bug fix**
  and **better cost tracking**, not higher accuracy.
- **The big takeaway:** the easy and medium improvements are used up. Real further
  gains now need either a **stronger underlying AI model** or a **bigger
  architectural change** — not more small tweaks.

---

## 1. What this tool is

When developers change code, another developer normally **reviews** that change
before it goes live — reading it to catch mistakes. Our tool does an automated
first pass of that review using an **AI model** (an LLM — a “large language
model”, the kind of AI that reads and writes text and code).

It plugs into the normal development workflow: when someone proposes a change, the
tool reads the change and leaves comments about problems it found — bugs, security
risks, logic errors. The goal is to catch issues **early**, before a human
reviewer or the customer does.

> **Why it matters:** human review is slow and inconsistent, and real bugs slip
> through. A good automated reviewer catches more, faster, and frees humans to
> focus on the hard judgment calls.

---

## 2. How it works (the flow, in plain English)

The tool is deliberately built to be **trustworthy over noisy** — it would rather
stay quiet than raise a false alarm. It does this with a **find‑then‑double‑check**
design:

| Step | What happens | Plain meaning |
| --- | --- | --- |
| **1. Get the change** | Read the “diff” | Look at exactly what lines were added/removed, plus the full files for context |
| **2. Understand structure** | Parse the code | A fast, exact tool maps out the functions, types, and imports — no AI yet |
| **3. Group the work** | Cluster into review units | Break the change into sensible chunks instead of one big blob |
| **4. Find problems** | AI reads each chunk | The AI lists *every* concrete problem it can find — cast a wide net |
| **5. Double‑check each one** | AI tries to *disprove* it | A separate AI step tries to prove each finding wrong; only the ones it can’t disprove survive |
| **6. Filter & report** | Apply rules, write output | Drop trivia, keep the serious findings, and write them as review comments |

Two things are worth highlighting:

- **The double‑check (step 5) is the key to staying trustworthy.** We call it
  *refutation*: for every problem the AI flags, a second AI pass actively tries to
  shoot it down. Only findings that survive are reported. This is what keeps the
  noise low.
- **AI is used in only two of the six steps.** The rest is fast, exact,
  non‑AI work. This keeps the tool cheaper and more predictable.

> **Jargon:** a *diff* is the list of exactly what changed. *Parsing* is reading
> code into a structured form a computer understands. *Refutation* is our
> double‑check step that tries to disprove each finding.

---

## 3. How we measure “good”

To know whether the tool is actually helping, we test it on **59 real code
changes** taken from five large, well‑known open‑source projects (the companies
behind Sentry, Grafana, Cal.com, Discourse, and Keycloak). Each change has a known
list of real problems, written by human reviewers. We run our tool and check how
well its findings match that known list — using *another* AI as an impartial judge
to decide whether two descriptions refer to the same problem.

We score the result with four standard measures. In plain terms:

| Measure | The question it answers | Higher = |
| --- | --- | --- |
| **Recall** | Of all the real problems, how many did we **catch**? | Fewer bugs slip through |
| **Product recall** | Same, but counting only the **important** problems (real bugs, not trivia) — our headline score | Fewer *important* bugs slip through |
| **Precision** | Of everything we **flagged**, how much was a **genuine** problem? | Less noise / fewer false alarms |
| **F1** | A single **balanced** score combining recall and precision | Better overall |
| **False positives** | The **count** of things we flagged that turned out *not* to be real | Quieter, more trustworthy |

> **The trade‑off to keep in mind:** recall and precision pull against each other.
> Flag more things and you catch more real bugs (recall up) but also raise more
> false alarms (precision down). A tool can cheat one number by sacrificing the
> other — that’s why the balanced **F1** score matters.

---

## 4. Where we stand today

On that 59‑change test (using the `gpt-5.3-codex` AI model, ~32 minutes, ~$12 per
full run):

| Our result | Value | In plain terms |
| --- | --- | --- |
| **Product recall** | **39.4%** | We catch ~2 in 5 of the important bugs |
| Overall recall | 33.1% | ~1 in 3 of all listed problems |
| **Precision** | **53.0%** | About half of what we flag is a genuine problem |
| **F1** (balance) | **40.7** | Competitive overall (see next section) |
| False positives | 39 | The noise we’d like to reduce |
| Cost / time | ~$12 / ~32 min | Per full run of all 59 changes |

**What we’re good at and where we struggle** (from breaking the results down):

- ✅ **Strong on the serious stuff:** we catch ~50–56% of *critical/high* severity
  bugs, and we (deliberately) ignore trivial style nits.
- ✅ **Low noise:** precision ~53% is high for this field.
- ⚠️ **Weaker on:** problems that span **multiple files**, subtle **security
  validation** gaps, and **timing/concurrency** bugs — these need deeper reasoning
  or wider context than the tool currently has.
- ⚠️ **Most false alarms** are plausible‑sounding **logic** guesses that turn out
  to be wrong.

---

## 5. How we compare to other tools

Here is the honest part. We compared against an **independent, public benchmark**
(run by a neutral third party, Martian) that scores the major commercial AI
reviewers on **the same five projects and the same method** we use. Numbers below
are from that benchmark family:

| Tool | Recall | Precision | F1 |
| --- | ---: | ---: | ---: |
| Tenki | 68.9% | 29.9% | 41.7 |
| **CodeReviewer (ours)** | **33.1%** | **53.0%** | **40.7** |
| Devin | 36.1% | 47.3% | 40.9 |
| Cursor BugBot | 32.0% | 51.3% | 39.4 |
| CodeRabbit | 28.7% | 25.0% | 26.7 |
| Greptile | 36.1% | 15.9% | 22.1 |
| GitHub Copilot | 24.6% | 18.9% | 21.4 |
| Graphite | 3.3% | 50.0% | 6.2 |

**What this shows:** we are **in the top group on the balanced F1 score**, we have
**the highest precision** (least noise) in the table, and our recall is
**mid‑pack**. That’s exactly the “trustworthy over noisy” profile we designed for.

**Read these comparisons with care (we want to be straight with you):**

- It is **not the identical test** — same projects and method, but our exact list
  of expected problems differs, so think “same league”, not “officially ranked”.
- Our scoring may be **slightly more generous** than the strictest benchmark, which
  could flatter our recall a little.
- These are **our own measurements**, and most published tool numbers are
  *vendor‑run* (each vendor tends to rank itself #1). Treat everyone’s self‑reported
  numbers — including ours — with healthy skepticism.

> **The blunt reality of the whole field:** AI code review is **mediocre in
> absolute terms today.** The best tools catch only 30–40% of real bugs, and the
> one tool with high recall (Tenki, ~69%) pays for it with lots of noise (low
> precision). Nobody has “solved” this. Catching ~1 in 3 bugs with low noise *is*
> the current frontier — and that’s where we are.

---

## 6. The most important insight: which problems are even *findable* by tools

A natural idea is: “let cheap, exact tools (type checkers, linters, build systems,
security scanners) find what they can, and focus the AI on the rest.” We tested
this against our data, and the result reshaped our thinking.

**Jargon, briefly:**
- A **type checker / build** catches things like using a value the wrong way or
  code that won’t compile.
- A **linter** flags known bad patterns automatically.
- A **security scanner (SAST)** flags known vulnerability patterns.
- These are all **deterministic** — they give the same exact answer every time, at
  essentially 100% reliability for the patterns they know.

We sorted the 133 known problems in our test into “a cheap exact tool could catch
this” vs. “only an AI that *understands* the code could catch this”:

| Category | Share | Examples |
| --- | ---: | --- |
| **Catchable by exact tools** | **~8%** | type/build errors, a known injection pattern |
| **Needs AI understanding** (the “semantic” part) | **~92%** | wrong logic, mismatched intent, business‑rule mistakes, timing bugs |

**Why this isn’t a surprise once you see it:** the test’s problem list is made of
**human review comments**. Humans don’t bother commenting on things the compiler
or linter already flags — those get fixed automatically *before* review. So
**reviewing is, almost by definition, the ~92% that the exact tools can’t catch.**

**What that means for us, honestly:**
- Handing work to exact tools is **good practice but a small slice** (~8%). It
  improves *trust* (don’t re‑report what the build already caught; security
  scanners are precise) — it is **not** a way to catch a lot more.
- The hard ~92% — and our biggest opportunity *and* our biggest source of false
  alarms — is the **semantic** part, which depends entirely on how well the AI
  *reasons*. There is no shortcut around that.

---

## 7. What we tried this round, and what happened

We ran a series of experiments to push accuracy up. Here they are in plain terms,
with the honest outcome of each.

### Kept (real, durable wins)

| Change | What it is | Why it’s worth keeping |
| --- | --- | --- |
| **Refutation budget fix** | A plumbing bug meant the double‑check step could get cut off early and let unverified findings through | A genuine bug fix — the double‑check now always runs |
| **Cost tracking** | The tool now records cached/reused AI usage and discounts it | We can see and reduce cost; runs got ~12% cheaper |
| **Measured baseline + comparison** | The numbers and competitor analysis in this document | We now know exactly where we stand |

### Tried and dropped (didn’t help — and *why* matters)

| Experiment | The idea | Result | Why it failed |
| --- | --- | --- | --- |
| **Two‑pass review** | Have the AI review each change twice with different focus | ❌ Reverted | Caught a bit more but **halved precision** — flooded noise |
| **Stronger prompts + language tips** | Tell the AI to “analyze deeper”, add language‑specific hints | ❌ Reverted | **Lowered both** recall and precision — extra instructions distracted the model |
| **Custom bug detector** | Hand‑built a detector for a specific bug pattern | ❌ Reverted | It re‑invented (badly) something standard linters already do; too noisy |
| **Caller context** | Show the AI who *calls* the changed code | ❌ Reverted | Safe but **inconclusive** and added cost; didn’t reliably help |
| **Stricter double‑check rules** | Tell the double‑check step to demand more proof | ❌ No effect | The AI is **confidently wrong**, not vague — instructions don’t fix confidence |
| **Independent double‑check** | Tell it to treat each finding as *unproven* and re‑verify | ❌ Backfired | It re‑built a justification and confirmed *more*, not less |

> **The pattern across all the failures:** changing the **instructions** we give
> the AI did **not** move the result. The model’s tendency to be *confidently
> wrong* about plausible logic bugs is built into the model — we can’t talk it out
> of that with better wording. We confirmed this five separate ways.

---

## 8. What we learned (honest conclusions)

1. **We’re at a strong, competitive baseline.** Top‑tier balanced score,
   best‑in‑class low noise, on par with the leading commercial tools on a fair
   test.
2. **The easy and medium improvements are used up.** Every cheap‑to‑moderate
   tweak we tried this round was neutral or made things worse.
3. **Prompt wording is not the lever.** The remaining problems live in the AI’s
   *reasoning ability*, which instructions don’t change.
4. **Exact tools are a precision/security helper, not a recall savior.** ~92% of
   real review needs genuine understanding.
5. **The field as a whole is early.** Being competitive here means being good at a
   genuinely hard, unsolved problem — not being near “perfect”.

---

## 9. Recommendations (where to go next)

**Short term — consolidate.** Bank the real wins (the bug fix, cost tracking,
this measured baseline) and **stop spending on small tweaks**, which the evidence
says won’t help.

**If we want to push accuracy further, the only bets with real upside are bigger:**

| Option | Upside | Honest cost / risk |
| --- | --- | --- |
| **Use a stronger AI model** | Most likely to actually raise the ceiling | Depends on model availability/cost; a different kind of effort |
| **Wider “whole‑codebase” understanding** | What the higher‑recall rivals have; could catch cross‑file bugs | Significant engineering; the leading rivals invested heavily here |
| **“Multiple judges” double‑check** | Could cut false alarms | Several times the cost, and it improves precision (already our strength) more than recall (our actual gap) — likely the wrong priority |
| **Plug in standard security scanners** | High‑precision wins on the security slice | Modest scope, but genuinely worth doing for security |

**Bottom line:** the tool is in good, competitive shape for a genuinely hard
problem. The next real step is a **bigger investment (a stronger model or
whole‑codebase understanding)**, not more fine‑tuning of the current approach.

---

## Glossary

| Term | Plain meaning |
| --- | --- |
| **LLM / AI model** | The text‑and‑code AI that reads the change and writes findings |
| **Pull request / change / diff** | A proposed set of code edits; the “diff” is exactly what changed |
| **Recall** | Of the real problems, how many we caught |
| **Precision** | Of what we flagged, how much was genuine |
| **F1** | A single balanced score of recall + precision |
| **False positive** | Something we flagged that wasn’t a real problem |
| **Refutation / double‑check** | Our step that tries to disprove each finding before reporting it |
| **Deterministic tool** | A non‑AI tool (type checker, linter, build, security scanner) that gives an exact, repeatable answer |
| **Semantic bug** | A problem you can only find by *understanding* what the code is meant to do |
| **Benchmark** | A fixed test set used to measure and compare tools fairly |

---

*Deeper technical detail lives in two companion documents: the full competitive
analysis and the eval breakdown + improvement plan. This document is the
plain‑English summary of both.*
