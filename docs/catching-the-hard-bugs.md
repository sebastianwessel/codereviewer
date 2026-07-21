# Catching the Hard Bugs — A Blueprint for Cross‑File, Security, and Concurrency Issues

> **Who this is for:** anyone who wants to understand *how* an automated code
> reviewer could best catch the three hardest kinds of bugs — without reading any
> code. It explains the problem, the best‑known approaches, what role AI should
> (and shouldn’t) play, and the honest trade‑offs.
>
> **What this is:** a forward‑looking *design exploration* — “if we could build
> anything, what would actually work best?” It is **not** a description of what our
> tool does today. Companion to the [CodeReviewer report](code-review-engine-report.md).
>
> **Last updated:** 2026‑06‑25.

---

## In one minute

- Three kinds of bug are the hardest for any automated reviewer to catch:
  **cross‑file** bugs, subtle **security** gaps, and **timing/concurrency** bugs.
- The biggest lesson from current research: for all three, **a general AI model
  reading the code is the *wrong* primary detector.** AI is excellent at
  *reasoning and explaining*, but weak at the exact, mechanical analysis these bugs
  need.
- The best results come from a consistent recipe: **let a purpose‑built tool find
  the suspects → let the AI judge and explain them → confirm by actually running
  the code → only report what’s confirmed.**
- The single biggest unlock is **running the code** (building it, running its
  tests and safety checkers). That’s higher‑signal than any amount of “reading”.
- The honest catch: doing this well is a **big platform investment**, not a small
  tweak — and even then, concurrency bugs stay only partly solvable.

---

## 1. The three hard problems (and why they’re hard)

| Problem | Plain description | Why it’s hard |
| --- | --- | --- |
| **Cross‑file** | A change in one file quietly breaks code in *another* file that uses it | You can’t see it by looking at the changed file alone — you need the whole web of who‑uses‑what |
| **Security validation** | Untrusted input reaches a sensitive operation without being checked (e.g. a web request that can be tricked into calling internal systems) | Requires tracing how data *flows* across many functions — easy to miss a single gap |
| **Timing / concurrency** | Two things happen at the same time and step on each other (a “race”) | The bug only appears in *specific timings* that aren’t visible in the static text of the code |

> **Why AI struggles here specifically:** these bugs need **exact, mechanical
> tracing** — of relationships, of data flow, of timing. Research consistently
> finds AI models are “blind to control flow” and weak across function boundaries
> and parallel code. They’re great at *understanding intent*, poor at *bookkeeping*.

---

## 2. The key insight: AI is the judge, not the detector

The most effective systems in recent research all follow the same shape:

> **Specialized tool finds the suspects → AI judges and explains them → running the
> code confirms them → only confirmed issues are reported.**

The AI’s job is **reasoning, triage, and explanation** — *not* being the thing that
mechanically finds the bug. Purpose‑built analyzers are far better at the
mechanical part; the AI is far better at deciding which of their findings are real
and worth a developer’s time.

**Jargon, briefly:**
- **Static analysis** = inspecting code *without running it*.
- **Dynamic analysis** = learning from *actually running* the code.
- **SAST** = a security‑focused static analyzer.
- **Taint / data‑flow analysis** = tracing where untrusted data travels.
- **Sanitizer / race detector** = tools that watch a running program and shout when
  something unsafe actually happens.

---

## 3. The best approach, one problem at a time

### 3a. Cross‑file bugs

There are really two sub‑types, and each has its own best tool:

| Sub‑type | Best detector | Why it works |
| --- | --- | --- |
| **Structural breakage** (a function’s shape changed, callers no longer match) | The **type checker / build** | The compiler already knows *every* place that no longer fits — exact and reliable |
| **Behavioural drift** (it still compiles, but the *meaning* changed; one place updated, its siblings forgotten) | **Run the existing tests** + targeted AI check | Tests are the highest‑signal way to catch this — it’s what human teams rely on |

**Best approach:** use a precise **map of “who uses what”** (built exactly, not
guessed) to pull up the real users of the changed code, then ask the AI one narrow
question per user — *“does this still work given what changed?”* — and let the
**test suite catch most of it automatically.**

> ✅ Much of this is *already* solved by tools teams run anyway (compiler + tests).
> The AI only needs to handle the “still compiles but behaves differently” residue.

### 3b. Security validation gaps

This is fundamentally about **following untrusted data** from where it enters to
where it could do harm. Tools are purpose‑built for exactly this:

| Layer | What does it | In plain terms |
| --- | --- | --- |
| **Find** | A security analyzer with data‑flow tracing (e.g. CodeQL, Semgrep, Snyk) | Catches the known dangerous patterns with high coverage |
| **Judge** | The AI | Decides whether a flagged path is *actually reachable/exploitable* — removing the many false alarms these tools are infamous for |
| **Confirm** | A safety checker / reproduction | Only report it if it can actually be triggered |
| **Residue** | The AI | The *judgment* calls a scanner can’t make — e.g. “should this page require a login?” |

**Best approach:** **don’t ask a general AI to do security tracing from scratch** —
run a real security analyzer for coverage, then use the AI to **confirm and
explain** (and to cut the analyzer’s false alarms), and reserve the AI’s own
reasoning for the *judgment‑based* gaps no scanner can define.

### 3c. Timing / concurrency bugs

Be honest: this is the hard one for *everyone*, and AI is **weakest** here. The
best detectors are highly specialized:

| Approach | Tool | Notes |
| --- | --- | --- |
| **Find races without running** | Specialized race analyzers (e.g. Infer/RacerD, O2) | Catch a high‑confidence class of races; used at industrial scale |
| **Find races by running** | Runtime “race detectors” run during the tests | Catch *real* races as they happen; very trustworthy when they fire |
| **AI** | — | Only the *obvious* patterns, plus a low‑confidence “this looks timing‑sensitive — a human should check” flag |

**Best approach:** lean on the specialized race tools (both kinds), run them during
the test suite, and use the AI only for the obvious cases and for flagging risk.

> ⚠️ **Honest limit:** even the best tools don’t fully solve concurrency. Partial
> coverage is the realistic ceiling — for us and for everyone else.

---

## 4. The single biggest unlock: running the code

Across all three problems, the largest difference between a mediocre reviewer and a
great one is **actually running the code** rather than just reading it:

- **Cross‑file** → the **test suite** reveals things that broke.
- **Concurrency** → **race detectors during tests** reveal real races.
- **Security** → **safety checkers / reproductions** confirm a real exploit.

Running the code produces **hard evidence**, which means you can **report only what
you’ve confirmed** — and that is the most powerful way to keep noise (false alarms)
low, which is the thing reviewers are judged on. It’s also exactly what human
engineers do, and what the most advanced tools do (they build the project in a safe
sandbox and run analyzers against it).

---

## 5. The recommended architecture

Putting it together, the best design flips the usual picture. The AI **orchestrates
and judges**; specialized tools and *execution* do the finding:

1. **Build the change in a safe sandbox**, run the **type checker, linter, and test
   suite**.
2. **Run purpose‑built analyzers** — security data‑flow, race detection, and a
   precise “who‑uses‑what” map.
3. **The AI reasons over all that evidence** — it sorts real issues from false
   alarms, fills in the judgment‑based gaps, and proposes how to reproduce a
   suspected bug.
4. **Confirm by running** (a test, a safety checker, a reproduction) and **report
   only what’s confirmed.**

> **The mental shift:** today most tools (ours included) make the AI the *detector*.
> The best design makes the AI the *hypothesis‑former, judge, and confirmer* sitting
> on top of exact tools and real execution.

---

## 6. The honest trade‑offs

| Reality | What it means |
| --- | --- |
| **This is a platform‑scale build** | You need a safe sandbox that can *build and test* real projects, plus integrations with several specialized analyzers — per programming language. This is why only well‑funded tools do it today. |
| **Concurrency stays partly unsolved** | Even with the best tooling, some timing bugs evade detection. Set expectations accordingly. |
| **Execution needs a runnable project** | Building and running someone’s code in a sandbox is powerful but operationally heavy (dependencies, environments, safety). |
| **It’s the *right* answer, not the *cheap* one** | This blueprint maximizes how many hard bugs we catch — it does not minimize effort. |

---

## 7. What this means for us

- The three weak areas in [our current results](code-review-engine-report.md) —
  cross‑file, security, concurrency — are weak for a **structural** reason: our tool
  uses the AI as the detector, and these bugs need exact tools + execution that the
  AI can’t replace.
- The realistic path is **phased**: start with the cheapest high‑value pieces
  (consume the project’s existing type‑check/test results; add a security analyzer
  for the security slice), and only later invest in full sandboxed execution and
  race detection.
- The honest headline: **meaningfully beating these three classes is a different,
  heavier kind of product** — an orchestrator of analyzers and execution with AI as
  the brain — not a better prompt or a bigger single AI pass.

---

## Glossary

| Term | Plain meaning |
| --- | --- |
| **Cross‑file bug** | A change that breaks code in a *different* file than the one edited |
| **Race / concurrency bug** | Two things running at once interfere with each other, only under certain timings |
| **Security validation gap** | Untrusted input reaches a sensitive action without being checked |
| **Static analysis** | Inspecting code without running it |
| **Dynamic analysis** | Learning by actually running the code |
| **Type checker / build** | Tools that verify code fits together and compiles |
| **Test suite** | The project’s own automated checks that it still behaves correctly |
| **SAST** | A security‑focused static analyzer |
| **Taint / data‑flow analysis** | Tracing where untrusted data travels through the code |
| **Sanitizer / race detector** | Tools that watch a running program and report unsafe behavior as it happens |
| **Sandbox** | A safe, isolated environment for building and running untrusted code |
| **Agent / orchestrator** | An AI that coordinates other tools and decides what to do next, rather than doing everything itself |

---

*Further reading (technical): research on combining static analysis with LLMs for
[false‑positive reduction](https://arxiv.org/html/2601.18844v1), security
[reachability triage](https://arxiv.org/html/2411.03079v2),
[concurrency detection](https://www.mdpi.com/1999-5903/17/12/578), and
[reproduce‑to‑confirm](https://arxiv.org/html/2606.22263) approaches informs this
blueprint.*
