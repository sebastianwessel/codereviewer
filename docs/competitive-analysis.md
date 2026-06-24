# Competitive Analysis — CodeReviewer vs. State-of-the-Art AI Code Review

_Last updated: 2026-06-24. Author's note: this is an honest, independently
researched assessment, not marketing. Our own numbers are **self-measured**;
treat them with the same skepticism applied to every vendor below._

---

## TL;DR

- Our 59-case benchmark is a **"style" copy of the Martian Code Review Benchmark's
  offline set** — the same five repositories and the same "golden comments +
  LLM-judge" method. That makes a comparison genuinely meaningful (same family),
  though **not** the identical test.
- On that benchmark family our engine lands **in the top tier on F1** with
  **class-leading precision** and **mid-pack recall** — exactly the
  precision-first profile it is designed for.
- **Honest asterisks:** different exact test cases, our looser semantic matching
  probably flatters recall, and the numbers are self-run.
- **Architecturally** we share the field's most important quality pattern (a
  dedicated verification/refutation pass), but we deliberately skip the field's
  other big lever — **whole-codebase context and agentic exploration** — which is
  likely the main reason our recall has a ceiling.

---

## 1. Is this even comparable?

Yes — more than expected. Our pack (`eval/benchmarks/code-review-bench-style/`,
59 captured-PR slices) mirrors the **offline** mode of the
[Martian Code Review Benchmark](https://github.com/withmartian/code-review-benchmark):

| | Martian offline set | Our pack |
| --- | --- | --- |
| Repositories | Sentry (Py), Grafana (Go), Cal.com (TS), Discourse (Rb), Keycloak (Java) | **same five** |
| Ground truth | Human-curated golden comments w/ severity labels | same shape |
| Matching | LLM-as-judge vs golden comments | LLM semantic judge |
| Size | 50 PRs / 122 bugs | 59 slices (49 positive + 10 negative) |

Two important differences remain: (1) the **exact** golden comments differ (we
curated our own slices), and (2) **matching strictness** differs — see caveats.

> There are **two** Martian modes. The **offline** mode (golden comments, 5 repos)
> is what we mirror. The **online** mode scores 200k real PRs by "did a developer
> act on the comment." The flashy "F1 ~51%" headlines (CodeRabbit, CodeAnt) are
> the *online* number and are **not** comparable to our offline number.

---

## 2. The numbers (offline golden-comment mode)

Competitor figures from the [Tenki 2026 benchmark](https://tenki.cloud/benchmarks/code-reviewer)
(122 bugs across the same 5 repos, 3-LLM majority-vote matching). Our row is our
own confirmed run (`gpt-5.3-codex`, single-pass, semantic judge).

| Tool | Recall | Precision | F1 |
| --- | ---: | ---: | ---: |
| Tenki | 68.9% | 29.9% | 41.7 |
| **CodeReviewer (ours)** | **33.1%** | **53.0%** | **40.7** |
| Devin | 36.1% | 47.3% | 40.9 |
| Cursor BugBot | 32.0% | 51.3% | 39.4 |
| CodeRabbit | 28.7% | 25.0% | 26.7 |
| Greptile | 36.1% | 15.9% | 22.1 |
| GitHub Copilot | 24.6% | 18.9% | 21.4 |
| Graphite Diamond | 3.3% | 50.0% | 6.2 |

> Use our **overall recall (33.1%)**, not the in-house "productRecall" (39.4%) —
> productRecall is a tier-subset metric nobody else reports.

**Reading it honestly:**

- **F1 (40.7)** sits in the **top cluster** (Tenki 41.7, Devin 40.9, Cursor 39.4).
- **Precision (53.0%)** is the **highest in the table** — the precision-first
  design working as intended.
- **Recall (33.1%)** is **mid-pack** — comparable to Cursor, above
  CodeRabbit/Copilot, below Devin/Greptile, far below Tenki.
- The one high-recall outlier (Tenki, 68.9%) pays for it with 29.9% precision —
  i.e. it floods reviewers with noise. **No tool wins both axes.**

---

## 3. Caveats (the part that could deflate our number)

1. **Not the identical test set.** Same repos and method, different exact golden
   comments → we can claim "same league," **not** a leaderboard rank.
2. **Our matching is probably more lenient.** Tenki/Martian require a *line-level*
   comment that pinpoints the faulty code **and** explains impact, validated by a
   **3-LLM majority vote**. Our judge matches a finding's title/description
   against an expected summary — looser. Looser matching **inflates recall**, so
   under their strict rule our 33% would likely be somewhat lower. This is the
   single biggest reason to treat our recall as optimistic.
3. **Self-reported.** We ran our own tool, on our own pack, with our own judge.
   For scale: Greptile self-claims **82%** recall; independent re-eval found
   **~45%**. Every "independent" benchmark cited here is itself **vendor-run**
   (Tenki ranks Tenki #1; CodeAnt ranks CodeAnt #3; CodeRabbit and cubic each
   blog that they are #1). Apply equal skepticism to our row.
4. **Single model, n≈1.** One model (`gpt-5.3-codex`), ±2–3 pt per-case variance.

**To make a defensible external claim:** run our engine against Martian's *actual*
50-PR set using *their* strict line-level + 3-judge matching, and place the result
on their public leaderboard — rather than reporting a same-family estimate.

---

## 4. The blunt reality of the field

State-of-the-art AI code review is **mediocre in absolute terms.** On the hard
offline benchmark the best tools catch roughly **30–40% of real bugs**, and the
only high-recall outlier trades it for ~30% precision (noise). Nobody is close to
"solved." **Catching ~1/3 of real bugs at ~50% precision *is* the current
frontier** — and that is the band we are in.

---

## 5. Do they use different methods than we do?

Yes — meaningfully. Here is how the leading tools are built versus us.

| Capability | CodeReviewer (ours) | CodeRabbit | Greptile | Cursor BugBot |
| --- | --- | --- | --- | --- |
| **Context scope** | Diff + changed files + limited cross-file defs (R4) | Per-review code graph + agentic repo exploration | **Whole-repo** semantic graph + embeddings, pre-indexed | Surrounding-codebase context, cross-function data-flow |
| **Agentic exploration** | **No** (single-shot; tools off) | Yes — agent runs `cat`/`grep`/`ast-grep` in a sandbox | Parallel agents over the indexed graph | Yes — rebuilt agentic in 2025 |
| **Static analysis** | AST (ast-grep + TS compiler) for clustering/context/evidence | **40+ linters/analyzers** run and fed in | Graph-based | Focused on logic/security, not linters |
| **Multi-pass** | **Single pass** (2-pass tested, hurt precision, reverted) | Parallel specialized agents | Parallel agents | **8 parallel passes**, randomized diff order |
| **Self-verification** | **Yes — dedicated refutation pass** | **Yes — dedicated Verification Agent** | Embedding-based filtering | Implicit in agent reasoning |
| **Learning from feedback** | No (stateless, local) | Accumulates team review prefs | **Yes** — up/downvote embeddings, team-partitioned vector DB | Limited |
| **Deployment** | Local/CLI, provider-optional, no indexing, local artifacts | Cloud sandbox (microVM), clones repo | Cloud, pre-indexes repo | Cloud / IDE-integrated |

### What we do the **same** as the frontier

- **A separate verification step.** Our refutation pass (try to *disprove* each
  candidate, drop the unprovable) is the same idea as **CodeRabbit's Verification
  Agent**. This is a recognized SOTA pattern, and it is why our precision is high.
- **Deterministic structure first.** We use AST (ast-grep + TS compiler) to
  cluster and gather evidence cheaply before spending model tokens — CodeRabbit
  similarly leans on `ast-grep` and cheap models for context compression.

### What we do **differently** (by design)

- **Single-shot, tools off.** We feed the model a prepared whole-file packet and
  do not let it explore. CodeRabbit and BugBot are **agentic** — the model writes
  shell commands / pulls cross-function context on demand.
- **No codebase index / no embeddings.** Greptile pre-indexes the whole repo into
  a semantic graph; we look mostly at the diff + changed files.
- **No feedback learning, stateless, local-only.** A deliberate
  privacy/simplicity choice — but Greptile reports up/downvote learning lifted
  acted-on comments from 19% → 55%.

### The gap this implies

Our biggest architectural difference from the higher-recall tools is **context
breadth**: Greptile/CodeRabbit/BugBot reason over the **whole codebase**
(cross-file dependency breaks, architectural drift, data-flow across functions)
that a diff-plus-changed-file view is structurally blind to. That is the most
likely source of our recall ceiling — bugs that require whole-repo understanding
are ones we cannot currently see.

Notably, **multi-pass is not inherently wrong** — BugBot's 8 parallel passes are a
big part of its quality. Ours failed only because our verification could not hold
precision against the extra candidate volume. The lesson is consistent with our
own data: **the lever is verification/refutation strength, not raw discovery
volume.**

---

## 6. Honest bottom line

- We are **genuinely competitive with state-of-the-art** on the benchmark our
  pack mirrors: top-tier F1, best-in-class precision, mid-pack recall. For a small
  local engine versus funded commercial products, that is a real result.
- **Three asterisks stand:** not the identical test set, looser matching likely
  flatters our recall, and it is self-measured. The true gap to strict-matched
  tools is probably a little wider than the table suggests.
- **The real frontier gap is recall**, and both our experiments and the
  architecture comparison point the same way:
  1. **Stronger refutation/verification** — it currently discards ~⅓ of
     candidates as it filters noise; tightening *which* it keeps is the
     highest-ROI lever (and matches what we measured directly).
  2. **Broader context** — whole-repo/cross-file understanding is the structural
     capability the higher-recall tools have and we don't.

---

## Sources

- [Martian Code Review Benchmark — methodology & repos](https://github.com/withmartian/code-review-benchmark)
- [Martian live leaderboard](https://codereview.withmartian.com/)
- [Tenki AI Code Review Benchmark 2026 — offline per-tool numbers](https://tenki.cloud/benchmarks/code-reviewer)
- [CodeAnt benchmark — 200k PRs](https://www.codeant.ai/blogs/ai-code-review-benchmark-results-from-200-000-real-pull-requests)
- [How CodeRabbit works — architecture](https://docs.coderabbit.ai/overview/architecture) · [agentic validation](https://www.coderabbit.ai/blog/how-coderabbits-agentic-code-validation-helps-with-code-reviews) · [agentic vs RAG](https://www.coderabbit.ai/blog/agentic-code-review-vs-rag-multi-repo-analysis)
- [Greptile — graph-based codebase context](https://www.greptile.com/docs/how-greptile-works/graph-based-codebase-context) · [embedding feedback learning](https://www.zenml.io/llmops-database/improving-ai-code-review-bot-comment-quality-through-vector-embeddings)
- [Cursor BugBot](https://cursor.com/bugbot)
- [Greptile self-claimed benchmarks (82% recall)](https://www.greptile.com/benchmarks) — vs independent ~45%
- [CodeRabbit "tops Martian benchmark"](https://www.coderabbit.ai/blog/coderabbit-tops-martian-code-review-benchmark) · [cubic "#1"](https://www.cubic.dev/blog/cubic-is-the-best-ai-code-reviewer-on-martian-s-benchmark) — vendor self-ranking
