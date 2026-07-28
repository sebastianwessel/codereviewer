# Implementation plan — specs 22 (change-impact) and 23 (intent-fulfilment)

Date: 2026-07-27
Status: plan. No code written.

---

## 0. The tension, stated once

"Reuse existing code" and "keep the logic cleanly separated" pull apart at exactly
one seam: **shared mechanism vs shared judgement**.

Every safety and IO primitive should be shared — path containment, eligibility,
redaction, evidence records, ledger entries, provider resolution, git intake,
artifact writing. Reusing those is free and reduces risk.

Every module that **decides something and gets scored on it** must not be shared —
admission rules, prompts, agents, report schemas, metrics, gates. This project
just spent significant effort discovering that 42.5% of its answer key was
silently asking a different question. **The code-level version of that mistake is
one `admitCandidate`, one report schema, or one agent serving three
capabilities.** Once that happens the three cannot be measured or evolved apart.

---

## 1. Reuse map

### Use as-is
`path-service` (`resolvePathInsideRoot`, `resolveExistingPathInsideRoot`),
`repository-path`, `config-loader`, `provider-resolution`, `costs`,
`observability`, `redaction`, `hash`, `error-normalizer` (gives both commands the
documented exit-code mapping free), `glob-matcher`, `truncateForContract`,
`cli/args` parsers, `cli/run-artifacts` (`writeRunArtifact` already serves
`fix-report.json` and `verification-report.json`), `reporting-utils`,
`run-index`, `context-ledger`, `deterministic-signals`, `context-retrieval`,
and the corpus hydration git plumbing.

### Must stay untouched
`review-workflow/**` (neither new command may import it, and it must not import
them), `agent-instructions.ts`, `admitCandidate`, `evaluateQualityGate`,
`ReviewReportSchema`, `investigate-claim-agent.ts`, `metrics.recall`.

### Small additive generalisations (all default-off)

- **G1 — intake exposes deleted paths and full-diff text.** `collectRepositoryIntake`
  drops deleted files into `skippedFiles` and restricts `git diff` to changed
  paths, so **a deleted exported symbol is invisible to every consumer** — the
  maximal contract change, and spec 22's strongest case. Opt-in
  `includeDeletedPaths`; default false.
- **G2 — `context-retrieval` identifier-aware, per-query-bounded lookup.**
  `grepRepository` matches with `line.includes(query)` (seeding from `get` or `id`
  matches `forget`, `widget`), returns only `path:line` with no matched text
  (forcing a second read per hit), and pools its budget globally
  (`maxMatches: 20` across everything). Add `matchMode: 'literal' | 'identifier'`,
  `maxMatchesPerQuery`, and matched-line text. All optional and defaulted.
- **G3 — `context-ingestion` exposes redacted fragments.** `runContextIngestion`
  returns only a summarised brief. **Citing into a paraphrase does not satisfy
  spec 23's source-citation requirement.** Fragments already carry `origin`
  (`inbox:jira/PROJ-123`) — expose them.
- **G4 — move `selectSummarizer` into `context-ingestion`.** It currently lives in
  `review-workflow/run/context/`, encodes real degradation policy spec 23 needs,
  and is provider-resolution logic in a context-assembly module — which spec 01's
  ownership table already says `review-workflow` should not own.
- **G5 — prompt genericity guard becomes a shared test helper**, callable by all
  three domains.
- **G6 — hydration orientation parameter.** Hydration hardcodes reversed
  (`baseSha: fixCommit`). Spec 22 needs forward. Default `'reversed'`.

### The reuse nobody had noticed

`deterministic-signals` already emits, for **seven languages**, a
`SupportSignalFact` with `{ kind: 'export' | 'public-symbol' | 'declaration' |
'import' | 'module', path, name, line, moduleSpecifier }`.

**Intersect `fact.line` with `DiffMap.hunks` and you have the set of symbols named
in the diff — language-neutrally, deterministically, zero model calls, zero new
dependencies.** That is spec 22's discovery seed, already built and tested.

The split that follows is the design:

| step | who |
|---|---|
| *which* symbols changed | code (facts ∩ hunks) |
| *what* about their contract changed | model |
| *where* those symbols are referenced | code (identifier lookup) |
| *whether* each reference relies on the changed part | model |

Two model calls, both narrow, both anchored on a code-produced input set.

---

## 2. Domain placement, and spec 01

Two new top-level domains: `change-impact/` and `intent-fulfilment/`, plus
`context-retrieval/symbol-reference-lookup.ts`.

Not folded into `review-workflow` (already the longest ownership row; would couple
independently-runnable commands to the runner they must be independent of), not
into `verification` (neither is a claim/verdict flow; would create a second
catch-all), and **not merged into one `advisory-reviews/` domain** — spec 22 is
diff→code analysis, spec 23 is prose→code mapping; they share no data, no agent,
no metric, no decision rule. "Advisory" is a property, not a domain.

**Spec 01 must change**: domain tree, two ownership rows, and one dependency
bullet —

> `change-impact` and `intent-fulfilment` must not import from `review-workflow`,
> and `review-workflow` must not import from either. Each is reachable only from
> `src/cli/`.

That bullet is the structural guarantee behind spec 22's recoverability
requirement, enforced by an import-boundary test.

**This plan improves spec 01's recorded unmet goal** (consolidating repository
reads behind `context-retrieval`): neither new domain gets a filesystem read, the
first genuinely new retrieval capability in years lands *inside*
`context-retrieval`, and G4 removes provider logic from one of the three
divergent modules. Two capabilities, zero new read sites.

---

## 3. CLI surface

```
codereviewer impact check [options]
codereviewer intent check [options]
```

Distinct at three characters. `review --impact` is explicitly rejected — both
specs forbid a flag on `review`, for the recorded measurement reason.

**`impact check` exit codes:** `0` whether or not impact is found; `1` **only**
when `changeImpact.blocking` is explicitly enabled and a finding was admitted;
`2/3/4/5` inherited unchanged.

**`intent check` has no blocking flag and no reachable `1`.** Enforcement is
structural: no code path returns `exitCode: 1`; the domain does not import
`admission`; `FulfilmentReport` has no `passed`, `blocking`, `severity`, or
`failing*` field. Tested by a table over every report shape plus a source
assertion.

---

## 4. Is `context-retrieval` the right foundation? Argued

**Yes for the mechanism, no for the shape — and the net-negative result does not
transfer, but a different part of it does.**

Spec 16 measured recall 66.7%→44.4% and 68.8%→56.3% at +71–150% cost, with
adjusted precision holding at 100%. **The loss was recall, not noise.** Its two
recorded hypotheses were that tool-use diverts attention from the diff, and that a
truncated excerpt of an unfamiliar file misleads more than it informs.

Both are about **the model deciding what to read and then reasoning with what came
back.** Spec 22 inverts the control flow:

| | spec 16 (net-negative) | spec 22 |
|---|---|---|
| what to look for | model | code (facts ∩ hunks) |
| when to look | model | code (once per changed symbol) |
| where to look | model, free-form | code (identifier lookup) |
| question asked | "is there a defect?" — open-ended | "does this site rely on this changed element?" — closed, per-site |
| model sees | a file it chose, possibly truncated | a delta plus a bounded excerpt around a known line |

**Hypothesis 1 does not transfer** — there is no diff-reading task to divert
*from*. **Hypothesis 2 transfers completely** and is the real risk. Mitigations,
all cheap:

- Excerpts **centred on the known reference line**, not a file prefix truncated
  from byte 0 — that truncation is the mechanism spec 16 blamed.
- The adjudication agent must be able to answer **"cannot determine from this
  excerpt"** as a first-class outcome, reported as a named dependent with no
  reliance claim. Spec 22 wants exactly this: naming six callers and claiming
  against only two.
- The **deterministic baseline arm** is the falsifier (§7.3).

**Verdict:** reuse `createContextRetriever` as the sole filesystem seam — it is
the only place combining path containment with symlink-realpath re-checking,
eligibility, redaction, ledger entries and evidence records; rebuilding any of it
would be a security regression. Do **not** reuse `grepRepository`'s current shape.
Do **not** build a sibling component outside the domain. Do **not** reuse
`createBoundedRetrievalTools` — it caps a *model-driven* loop, and spec 22's call
count is a pure function of the changed-symbol count. Using it would cargo-cult
the mechanism that measured net-negative while discarding the reason spec 22
might work.

---

## 5. What must NOT be shared

**`admitCandidate`.** It gates on `isReviewedLocation(...reviewedPaths)`, but a
change-impact finding is outside the diff *by construction*. Admitting it requires
either redefining `reviewedPaths` — silently loosening the diff reviewer's scope
guard — or a mode flag, which is the same thing named. Spec 22 also adds a rule
with no diff-review analogue (named dependent required). Instead:
`impact-admission.ts` composes the shared **primitives** with zero copy-paste of
policy.

**Report schemas.** Three artifacts, following the `VerificationReportSchema`
precedent. One schema across three capabilities means a spec 23 field change bumps
the diff reviewer's contract.

**The quality gate.** Spec 23 must be *structurally* unable to reach it — not
configured off. A config flag would be a latent path to the exact 73–88% failure
the spec argues against.

**Metrics.** Spec 22 reports recall **per reachability class**; spec 23 reports
**three separate** metrics including false-satisfied rate. Never blended. This is
the most direct application of this project's own recent lesson.

**Agents.** Four distinct agents, own instructions, own schemas. Reuse the
*pattern* of `createHarnessClaimInvestigator`, not the code — one more caller does
not establish a stable contract.

**Within spec 23 the separation is stronger than "two calls":** the mapping
agent's output schema must contain **no free-text field at all** —
`{ obligationId, status, evidence[] }`. Two calls where call one still returns a
`rationale` string satisfies the letter and violates the measured mechanism. Note
this deliberately diverges from `investigate_claim`, whose instructions say the
opposite; the divergence needs a comment or someone will "unify" them later.

**Corpus schemas.** `real-repo-corpus.schema.ts` throws when an expectation's path
is outside `reviewedPaths` — the exact negation of spec 22's `Q ⊄ P`. Do **not**
add a mode flag; a schema whose central invariant is conditional enforces nothing.
Write a sibling schema reusing the orientation-independent parts, and make
`evidenceOfBreakage` a **required discriminated union** with no free-text-only
variant — that is how "a curator's inference is not admissible" becomes
enforceable.

---

## 6. Sequencing

**W0 — boundary scaffold (blocks everything).** Spec 01 edits **first**; two empty
domains; config namespaces (`changeImpact`, `intentFulfilment`, siblings of
`verification`, both `enabled: false`); **import-boundary test**; G5.

**W1 — parallel, no provider needed.**
- *W1a (highest confidence)*: G1, `changed-symbols.ts`, G2 + byte-identical
  regression test, `symbol-reference-lookup.ts`, `dependent-discovery.ts`.
- *W1b*: G3, G4, spec 23 contracts, absent-intent path end-to-end.
- *W1c*: G6, both corpus schemas — `reachability` and `evidenceOfBreakage`
  required for impact; `synthetic: boolean` required for fulfilment.

**W2 — agents and composition.** Per capability, in parallel.

**W3 — CLI wiring**, then docs (last, stating "disabled by default" plainly).

**W4 — evaluation harness. Blocked on fixtures.** Includes **the deterministic
baseline arm**, without which spec 22's remove-criterion is unexecutable.

**W5 — measurement.** Blocked on W4 and explicit spend approval.

**The critical path is fixtures, not code.** W0–W3 is ordinary, well-precedented
work; `verification` is a working template for most of it. Spec 23's corpus is
stated to be harder than spec 22's. If either slips, it slips there.

**No new runtime dependencies.** `@ast-grep/napi`, the language packs and
`typescript` are already present and already cover all seven languages.

---

## 7. Flagged: spec text not executable as written

**7.1 — spec 22 matrix row "integration test asserting no duplicated
implementation".** You cannot assert *absence* of duplication with an integration
test. Substitute: the import-boundary test — assert the domain imports the shared
entrypoints **and** contains no `node:fs`, `node:fs/promises`, or
`node:child_process`. Checkable, and a stronger guarantee.

**7.2 — spec 23's three-call separation** is trivially passable unless the
judgement schema is structurally free of free text. The matrix row must include
that assertion.

**7.3 — spec 22's remove-criterion** ("cannot beat naming the symbols and letting
the human grep") is unexecutable unless the deterministic baseline is **built as a
measurable arm**. Scheduled W4. Fortunately the W1a deterministic core *is* that
baseline, so it costs almost nothing extra.

**7.4 — deleted symbols** are invisible to intake today. Without G1, spec 22 ships
silently blind to its strongest case and nothing in the spec text would say so.

**7.5 — corpus reuse is narrower than it looks.** Git plumbing and integrity
checks reuse; schema and orientation do not.

**7.6 — citing into a summarised brief** cannot satisfy spec 23's source-citation
requirement. The obvious implementation ("reuse spec 11, use the brief") quietly
fails it while appearing to satisfy the reuse mandate. Handled by G3.

**7.7 — minor**: G5 places a test-only helper in `src/shared/`, described in
runtime terms by AGENTS.md. Convention question for a maintainer.
