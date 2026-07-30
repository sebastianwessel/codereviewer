# Signal coverage across 37 real repositories, and spec 24's divergence yield

Date: 2026-07-30
Method: offline, deterministic, **zero provider spend**. The 37 hydrated slices under
`.codereviewer/eval/corpus-slices/real-repo-cross-file` were walked directly
(≤200 non-test source files each, ≤200KB per file) and fed through
`derivePeerSets` + `collectDivergences` with every line marked changed, so every
declaration became a candidate subject.

---

## Finding 1 — The JavaScript extractor sees ESM exports and nothing else

`fastify`'s `lib/route.js`, **701 lines of real JavaScript**, produces **zero
deterministic signal facts**.

Isolated, with the minimal cases:

| source | facts |
|---|---|
| `export const a = () => 1` | **1** |
| `export function b() {}` | **1** |
| `function c() {}` + `module.exports = { c }` | **0** |
| `const d = () => 1` + `module.exports = d` | **0** |
| `module.exports = function e() {}` | **0** |
| `exports.f = function () {}` | **0** |
| `class G { h() {} }` | **0** |

**An entire module system is invisible.** Not the function declarations, not
`module.exports`, not `exports.x`, and not classes — which are unseen regardless
of module system.

### Why this is not a niche gap

Deterministic facts feed **three** consumers, so a CommonJS codebase silently
gets a degraded version of all of them:

- **Stage 1** — `aiReview.deterministicSignalMode: 'support'` injects these facts
  into the review packet. On a CommonJS repository it injects nothing, and the
  project has measured that mode as *"materially better recall"* when it works.
- **`impact check`** — changed symbols come from these facts. No facts, no symbols,
  an empty report that looks like "nothing to say" rather than "cannot see".
- **`conformance check`** — no declarations at all, hence the measured zeros below.

Measured across the corpus: 4 JavaScript repositories (fastify ×2, ws, undici),
**1,046 `.js` files between them, 6 declarations total.**

### The documentation is wrong about this

`docs/01-overview/status-and-limitations.md` says *"Deep support signals exist for
TypeScript/JavaScript (TypeScript compiler)"*. True only for ESM exports.

A plausible route to the error: `specs/00-scope-and-glossary.md` INV-ESM-001
requires **our own first-party source** to be ESM-only. That is an invariant about
what we *write*, not about what we can *review*, and the two appear to have been
conflated.

### Also confirmed, and correct

C#, PHP, Elixir, C and Kotlin produced zero declarations — those are **not
supported languages** (`typescript, javascript, python, go, rust, java, ruby`), so
zero is the right answer and not a defect. Java produced 4 declarations across one
repository, which is consistent with the already-recorded hole that Java methods
emit no facts.

---

## Finding 2 — Spec 24 does fire on varied real code

The question left open this morning was whether the conformance detector, after
the span fix, reports anything at all or is simply gated into silence.

| | total |
|---|---:|
| repositories | 37 |
| source files | 4,974 |
| declarations | 21,498 |
| peer sets built | 21,339 |
| **divergences** | **849** |
| repositories yielding ≥1 | **18 / 37** |

**It is not gated into silence.** 3.9% of declarations diverge from a majority
pattern of their peers.

### Yield is strongly language-dependent, which is a concern

| language | repos | declarations | divergences | rate |
|---|---:|---:|---:|---:|
| rust | 2 | 2,265 | 386 | **17.0%** |
| typescript | 3 | 831 | 118 | **14.2%** |
| python | 6 | 7,301 | 233 | 3.2% |
| ruby | 5 | 1,807 | 51 | 2.8% |
| go | 8 | 9,154 | 61 | **0.7%** |
| javascript | 4 | 6 | 0 | see Finding 1 |
| csharp / php / elixir / c / kotlin | 10 | 54 | 0 | unsupported |

A capability that is supposed to be language-neutral yields **24× more per
declaration in Rust than in Go**. That may be a real property of the codebases —
Go's convention is famously uniform, Rust's trait impls repeat structure — or it
may be an artefact of how indentation and lexical traits behave per language.
**This measurement cannot tell those apart**, and the difference is large enough
that it should be settled before the capability is recommended.

### What this is NOT

**It is not a firing rate.** Every declaration was marked changed, so this is the
*total divergence population* of each codebase, not what a pull request would
surface. A real change touches a handful of declarations; scaling naively
(3.9% × ~4 changed declarations per commit) suggests roughly **0.16 per commit**,
inside the ≈0.5 kill criterion — but that is an *estimate from a population rate*,
not a measurement, and it assumes changed declarations diverge at the same rate as
all declarations, which is exactly what a real firing-rate run would test.

**No divergence here has been judged.** These are deterministic-core outputs with
no adjudication pass, and the adjudication layer only ever makes a report shorter.
Nothing here says any of the 849 is worth showing a human.

---

## Why the honest firing-rate test could not be run

The intended test — run `conformance check` over each slice's real upstream
pull-request diff — **is not possible with the corpus as hydrated**, and this is
worth recording as missing infrastructure rather than as a result:

- every slice repository contains **exactly one commit**, so `HEAD~1` does not exist;
- `slice.json` carries `baseSha` and `headSha`, but the base commit's objects are
  **absent from the shallow object store** (`git cat-file -e <baseSha>` fails on all 37);
- the empty tree is not a commit, and a synthesised empty commit shares no merge
  base with `HEAD`, so `git merge-base` fails.

A hydration that kept the base commit reachable would make a genuine multi-repo,
multi-language firing-rate measurement a one-command job. That is the single
highest-value change to the corpus tooling.

---

## Update — Finding 1 is fixed (same day)

CommonJS exports now produce the same `export` fact an ESM export does:
`module.exports = { a, b }`, `module.exports = name`, `exports.x`, and a named
function or class expression. An anonymous `module.exports = function () {}` is
deliberately still not recorded — it names nothing a peer set or a reference
lookup could match, and inventing a placeholder would be worse than silence.

Re-measured on the same four repositories:

| | before | after |
|---|---:|---:|
| `fastify` `lib/route.js` (701 lines) | 0 facts | **3** |
| four JS repos, exported symbols | **6** | **891 across 415 files** |

Scope was kept deliberately like-for-like: a CommonJS export becomes an `export`
fact, no new fact kind. **A top-level declaration that is never exported is still
invisible**, for CommonJS and ESM alike — that is a separate, already-recorded
hole, and widening it here would change what every downstream consumer receives
without a spec to justify it.

### It fixes two consumers of three, and the third is worth naming

Re-running the conformance probe over the same four repositories after the fix:

| repo | files | declarations | peer sets | divergences |
|---|---:|---:|---:|---:|
| fastify (×2) | 46 / 45 | 11 / 11 | 11 / 11 | **0** |
| undici | 201 | 38 | 34 | **0** |
| ws | 23 | 4 | 3 | **0** |

891 exported symbols became **64 conformance declarations and still zero
divergences**. Two structural reasons, both specific to CommonJS and neither
addressed by this fix:

1. **A multi-export object puts every name on one line.**
   `module.exports = { a, b, c }` emits three facts at the same line, and
   `peer-sets.ts` deliberately excludes any line carrying more than one fact —
   the rule that stops an ESM re-export barrel forming bogus peer sets. The whole
   statement is therefore skipped.
2. **A CommonJS export names a symbol at the assignment, not at its body.** The
   span reconstructed from that line covers the assignment, so the declaration
   carries few or no traits and `peer-sets.ts` drops trait-less declarations.

So: **`review`'s support signals and `impact check` genuinely improve for
CommonJS; `conformance check` does not.** Making it do so needs the export
assignment resolved back to the declaration it names, which is a different piece
of work and is not claimed here.

## What to do with this

1. ~~Fix the JavaScript extractor.~~ **Done** — see the update above. What remains
   open is whether unexported top-level declarations should be visible at all,
   which is a spec question rather than a bug.
2. **Settle the Rust-versus-Go spread** before recommending spec 24 anywhere.
3. **Hydrate the corpus with reachable base commits**, then run the real
   firing-rate test that this report had to substitute for.
