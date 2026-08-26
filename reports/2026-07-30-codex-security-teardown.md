# openai/codex-security: what it does, and what we should take

Date: 2026-07-30
Source: `github.com/openai/codex-security` @ main, open-sourced 2026-07-29. Apache-2.0.
Method: cloned and read the shipped prompt set under
`sdk/typescript/_bundled_plugin/` (skills + references, ~4700 lines of markdown),
plus `src/scan-comparison.ts`. Read only — nothing installed or executed.

Status: analysis. Proposes changes; decides nothing on its own.

---

## What it actually is

A thin CLI/SDK client. The scanning intelligence ships as **markdown skill files**
— the prompts are the product, and they are now public. That is the value here.

Five phases, run strictly in order, never collapsed:

1. `threat-model` — **repository-scoped**, cached, and *deliberately blind to the diff*
2. `finding-discovery` — diff-scoped candidates, no severity
3. `validation` — reproduce or falsify; **execution preferred over reading**
4. `attack-path-analysis` — facts, counterevidence, then severity by matrix
5. report assembly + `propose-security-hardening`

## Confirms what we already do — no change needed

| their rule | our equivalent |
|---|---|
| deterministic file selection; *"diff scans do not rank or drop changed files before deep review"* | our deterministic scoping |
| every input labelled untrusted data, in every phase, including `userContext` and `SECURITY.md` | our untrusted-input guard |
| *"trust the actual code path more than the narrative"* about commit messages | our change-intent withholding in refutation |
| phases separate, *"do not amortize effort across phases"* | our stage independence (your requirement) |
| candidate discovery is plausibility, **not** severity | our discovery/admission split |

Independent convergence on five decisions we made under measurement. That is worth
something on its own.

---

## Worth taking — ranked by (value ÷ cost)

### 1. Hard suppressions before severity — take it

Their severity pipeline has two halves. The second half — an `impact × likelihood`
matrix — **we already have**, in `agent-instructions.ts`: impact
(`control defeated` / `silently wrong` / `signalled or bounded` / `none`) ×
reachability (`routine` / `conditional` / `remote`), 4×3, fully spelled out. Ours
is language- *and* domain-neutral where theirs is security-specific. No change
needed there, and this correction retracts the claim that our severity is an
unstructured model judgement.

Two real deltas remain.

**(a) They apply the matrix in code; we apply it in the prompt.** The model should
emit the two band enums and let TypeScript do the lookup — *"mechanically rather
than re-arguing severity from scratch"*. Same rubric, but the arithmetic stops
being a model output. Directly testable, removes a variance source, no prompt
rewrite.

**(b) Hard suppressions run first, and we have no equivalent:**

- self-only impact → suppress
- unachievable preconditions → suppress
- privileged-only / operator-only / localhost-only → suppress,
  *unless the privilege-escalation delta is itself the issue*

That last clause is the load-bearing one — it is what stops the rule from
swallowing real privilege bugs. This is a precision lever we do not have in any
form.

### 2. Numeric confidence ladder — reject, and the reason is ours already

> *"Calibrate confidence from the validation method and evidence, not from how
> dangerous the bug class sounds."*
> `1.0` crashing PoC · `0.9+` ASan · `0.8+` debugger · `0.3+` code understanding

Tempting, and wrong for us, on two independent grounds:

1. **Spec 12 already decided against numeric confidence** — *"an LLM-authored
   score is not reproducible and is treated as noise"* — enforced in
   `verification.schema.ts` and repeated as `Never emit a numeric confidence` in
   the agent prompts. Adopting the ladder would reverse a human-approved decision.
2. **Every rung above 0.3 requires execution.** Static-only, all our findings sit
   at 0.3 forever. A constant carries no information.

And we already do the underlying idea in the form that fits: `corroborated` in
`corroboration.ts` is a *categorical, method-derived* confidence — earned by a
second independent agent reading the code, not self-reported.

What survives is one honest fact, not a feature: **OpenAI, with execution
available, caps pure code reading at 0.3.** That corroborates our Naptime finding
(0.16 → 0.32 from the sanitizer oracle; only 0.32 → 0.36 from the whole agent) and
belongs in the docs as a stated ceiling.

### 3. Counterevidence as a required field — take it

Not our refuter's yes/no. For each interpretive field they force:
*what repository evidence suggests the opposite, and why is it or is not
dispositive?* Recorded **even when the finding survives**.

And the inverse rule, which is the sharper half:

> *"suppressions must close the specific row they suppress. A missing downstream
> caller, deployment fact, or import path is a reason to mark the row `deferred`,
> not proof that the candidate is safe."*

A named `deferred` state — "not disproven, proof missing" — is something our
binary admit/refute has no room for.

### 4. Instance preservation — take the idea, we have the opposite bug

Their discovery skill is *obsessed* with not collapsing siblings:

> *"the common failure mode where one representative route or sink hides
> additional vulnerable siblings introduced by the same patch."*

Mechanism: an instance key `<family>:<file>:<line>`, and family-level buckets
must be **expanded into child candidates before validation**, each with its own
source, control, sink and disposition.

Our measured, unfixed weakness is one finding per file. Same failure mode. Their
countermeasure is structural rather than a prompt plea.

### 5. Guard-reshaping as diff context — a cheaper rival to spec 24

They handle protection-removal without any conformance detector:

> *"when the diff adds, removes, or reshapes a guard around an existing parser,
> deserializer, expression evaluator, filesystem/path helper, archive utility, or
> auth/authz helper, use the adjacent pre-existing sink/control as supporting
> context for the changed behavior; keep the candidate anchored to the changed
> guard or newly exposed path"*

That is *"pull in the unchanged sink the changed guard protects"* — context
expansion, one hop, no peer sets, no majority vote, no firing-rate problem. It
covers the removal shape and the loosened-in-place shape, both of which our
declaration-level conformance check misses.

**This deserves a measured A/B against spec 24**, which currently has zero real-code
positives and a blown firing rate.

### 6. Root-cause matching by LLM — you called this correctly

`src/scan-comparison.ts` is your "smart deduplication" idea, shipped. Six lines:

> *"Match findings with the same underlying root cause and remediation, regardless
> of titles, CWE labels, fingerprints, locations, or wording. Different routes
> reaching the same vulnerable helper share one root cause… Keep distinct
> independently vulnerable controls or instances separate."*

Design detail worth copying: the schema hard-codes `confidence: z.literal("high")`
and routes everything else to a separate `uncertain` bucket. It is never forced to
guess.

### 7. `SECURITY.md` as resolvable policy — relevant to your other project

A hierarchical convention: every `SECURITY.md` from repo root down to the target
directory is concatenated root-to-leaf; **closest to the target wins**; the whole
thing is treated as *untrusted policy data* that can define what counts as a
finding but cannot change the workflow.

That is a human-editable, in-repo, reviewable policy artifact with defined
override semantics — see the note on your parallel project below.

---

## Deliberately not taking

**The discovery checklist.** ~60 bullets naming `pickle.load`/`yaml.load_all`,
`FEATURE_SECURE_PROCESSING`, SAML/LDAP/Kerberos realms, `execute`/`executemany`.
Two reasons, both ours and both evidenced:

1. It violates the spec 15 non-negotiable — prompts stay language- and
   framework-neutral.
2. We **measured** this. The in-prompt security checklist lens was not a net win:
   authz recall fell 41% → 27% while ssrf/xss rose. Their checklist is a much
   bigger version of the thing we removed.

**The ledger/receipt machinery** (`candidate_ledger.jsonl`, `work_ledger.jsonl`,
per-phase receipts, goal closure criteria). Built for durable multi-hour scans
that resume across context windows. We are single-pass. Pure overhead.

**Dynamic validation** (build a debug variant, ASan, valgrind, gdb `-batch`,
crashing PoCs). This is where their real precision comes from and we cannot build
it. Worth stating plainly rather than pretending the gap is closable by prompting.

---

## The honest comparison

Their advantage is **execution**. Strip it out and their static fallback is
recognisably our pipeline — and they cap its confidence at 0.3.

Our advantages are real and they do not have them: we are language-neutral by
construction, we measure with paired significance testing, and we delete
interventions that fail to beat baseline (eight so far). Their own docs report
*no ablations*, and they are a research preview.

**We are not behind on method. We are behind on one capability we already decided
we cannot build.**

---

## Proposed order

| # | change | cost | why now |
|---|---|---|---|
| 1 | **Guard-reshaping context expansion**, A/B'd against spec 24 | 1 spec + 1 A/B | could retire an unjustified capability *and* close the blind spot |
| 2 | **Hard suppressions** before the severity matrix | small, testable | the only genuinely new precision lever here |
| 3 | **`deferred` disposition** + counterevidence on survivors | schema + prompt | removes forced binary guesses |
| 4 | Move the matrix lookup from prompt into code | small | determinism, no rubric change |
| 5 | Instance keys `<family>:<file>:<line>` | medium | only if one-finding-per-file resumes |

Rejected: the numeric confidence ladder (§2), the discovery checklist, the ledger
machinery, dynamic validation.

Note that 2 and 3 both *reduce* what we report. Neither can be justified on a
corpus of 100% positives — both need the benign-PR firing-rate measurement that
spec 24 already established. That measurement is the shared prerequisite.

## Attribution

Apache-2.0. If any wording is adopted rather than re-expressed, add a NOTICE
entry. Recommendation is to adopt the *designs* and write our own text, since
theirs is language-specific in exactly the way ours must not be.
