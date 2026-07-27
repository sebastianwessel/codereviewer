# 15: Security-Focused Review And Measurement

Status: Approved
Date: 2026-07-24

## Purpose

Improve security-defect recall reliably and generically, and measure it honestly
per mechanism. The engine already catches obvious self-contained sinks (SQL/command
injection, path traversal). The gap is elsewhere, and the design follows the
evidence, not intuition.

Two evidence sources shape this spec:

- **Our own data.** On the committed benchmark, security-labeled findings are
  dominated by **authorization / access-control / credential logic (~59%)**;
  classic injection/taint sinks are a small minority and the obvious ones are
  already found. So a sink scanner alone would target the wrong majority.
- **The literature.** The reproducible security lift (IRIS, RepoAudit) comes from a
  hybrid: a deterministic engine finds candidate source→sink paths; the model
  infers specs and **judges reachability / triages false positives** — the triage
  stage is the dominant precision lever. Separately, PR-review research shows more
  context *reduces* quality: the goal is high-value evidence per token, not volume.

This spec therefore defines a generic security capability with two cooperating
mechanisms and, first, the measurement that keeps any improvement honest.

## Non-Negotiable: Generic, Not Eval-Specific

Every rule, checklist item, and pattern in this capability derives from public,
established security knowledge (OWASP, CWE, CodeQL/Semgrep rule catalogs) and is
justified by a citation, never by a fixture it happens to catch. Tuning detection
to the identities of eval findings is forbidden and is treated as a defect. The
trusted-rule seeding map stays free of benchmark-specific rules (as it is today).
Any improvement must be shown to generalize on a held-out set, not the set it was
built against.

## Measurement First (built before any detector)

Security cannot be improved credibly without measuring it by mechanism. Before any
detector or security pass ships, the evaluation gains a **security dimension**:

- Each security expected finding carries a **mechanism** label (see Mechanisms) and
  a **context-depth** label (`local | cross-function | callee | caller |
  implementation | cross-file | analyzer-path-dependent`).
- The eval reports **recall and adjusted precision per mechanism and per
  context-depth**, not only one aggregate security tier. A mechanism with a small
  denominator is reported with its count so it is not over-read.
- An **obvious-vs-hard** split is tracked separately, so aced trivial sinks never
  mask the hard-class gap.

Labels are applied to the existing committed security cases (a contaminated **dev**
set — its repos are public and likely in model training data) and to a small
**held-out** set assembled under the anti-contamination policy below. Improvements
are decided on the held-out set; the dev set is for iteration only.

### Anti-Contamination Policy

Held-out security cases follow the practices the research converged on:

- **Temporal cutoff** — derive held-out cases only from fixes dated after the
  evaluated model's training cutoff; re-freshen each model generation.
- **Chronological split**, never random (near-duplicate fixes leak across a random
  split and inflate scores).
- **Dedup** exact, near-duplicate (token-normalized), and derivative (same CVE in a
  fork) cases, and against likely-public popular repos.
- **Exclude famous/high-profile CVEs** (memorized).
- **Hold the answer key out of the prompt** — present only the pre-fix diff and PR
  intent; never the CVE id, advisory text, or fix commit message.
- **Keep the held-out seed unpublished and rotate a fraction each cycle.**
- Record source, license, and capture date per imported case; permissive upstream
  only for any case that might be published.

Candidate public sources for held-out material (dataset shapes and licenses per
their pages; all require local verification): MoreFixes v4 and CVEfixes (CVE fix
commits, reverse the fix to get the vulnerable diff), the Martian review-bench
harness/methodology, with PrimeVul's chronological-split discipline and
SEVRA-BENCH's "review an adversarial PR without being told to look for security"
protocol as the evaluation framing.

## Mechanisms

Security expected findings and detectors are labeled by mechanism (OWASP/CWE
aligned):

- authorization and tenant/access-control isolation;
- injection: SQL, command, code/expression, template;
- SSRF and unsafe URL/host construction;
- XSS and output encoding;
- insecure deserialization;
- secret and sensitive-data flow;
- cryptography (weak primitive, misuse, predictable randomness);
- filesystem / path traversal;
- unsafe configuration;
- concurrency and resource exhaustion;
- prompt-injection resistance of the reviewer itself.

## Mechanism 1: The Dedicated Additive Security Pass

An optional, generic **security-only discovery pass** — the primary lever, because
it targets the authorization-dominated real distribution and gives the security
classes their own dedicated model attention.

**Why a dedicated pass, not an in-prompt checklist.** An earlier realization
appended the OWASP/CWE checklist to the *general* discovery prompt. Measurement
(full benchmark A/B, dated 2026-07-24) showed this is not a net win: it lifted the
ignored injection classes (SSRF 0→50%, XSS 0→33%) but *dropped* the dominant
authorization class (41→27%), because one prompt's attention is finite and the
checklist pulled focus away from the access-control reasoning the general prompt
already did well. The mechanism (make the model check under-weighted classes) works;
folding it into the shared prompt is the wrong integration. The dedicated pass fixes
this by giving security a **separate discovery call** so it cannot compete for the
general call's attention.

- When enabled, each review task issues a **second discovery call** whose reviewText
  is security-only: it applies the generic OWASP/CWE **checklist** across the
  mechanisms above to the same changed code, diff, and change-intent context, and
  instructs the model to report only concrete, evidenced security defects.
- The pass reuses the existing model-backed holistic discovery and refutation
  infrastructure — it is a second call of the same discovery agent with a
  security-focused reviewText, not a new agent, role, or pipeline.
- Its candidates are **additive**: they merge with the general pass's candidates and
  are never substituted for them, so the pass can only *add* security findings and
  can never reduce the general reviewer's recall (the attention tradeoff above is
  removed by construction). A security candidate at a location the general pass
  already flagged is dropped as a duplicate, so the merge adds no report noise.
- Its candidates pass the **same** untrusted refutation and deterministic admission
  as any other candidate. The pass never bypasses scope, location, baseline,
  severity, or the gate. It raises recall on the classes the general discovery pass
  under-weights (authorization, subtle injection, and the injection classes it
  ignores); precision is protected by refutation + admission, and measured.
- The checklist is generic and public-derived; it is never expanded to match a
  fixture.
- Off by default. The pass is non-deterministic and costs a second discovery call
  per task; it is quarantined like every other model lane and never changes the
  general review's guarantees. It ships enabled-by-default only if a held-out A/B
  demonstrates a net recall gain without an authorization regression.

### Measured Outcome Of The Injection Hardening

Every figure in this section predates the harness-wide suppression of conversation
history on 2026-07-27 (see *Conversation History* in `21-independent-sampling.md`).
None of them is comparable to a current run; they are retained as the record of why
the guard was adopted. Note also that this section measures the **injection guard**,
not Mechanism 1 — the dedicated security pass's own A/B result is not recorded in this
spec (see *Known Divergences From This Spec* below).

Extending the guard to the general reviewer and the refuter was made for consistency
rather than for recall, and it does improve recall — by less than a small corpus first
suggested.

On the sixteen-case real-repository corpus the change appeared to move recall from
62.5% to 81.3% and 87.5%. That corpus was later measured to have a standard deviation
of 4.4 percentage points across seeds of one identical configuration, so a figure
drawn from it that large was partly its own noise, and the best observed run should
never have been quoted as the result.

The trustworthy measurement is a single-variable A/B on the fifty-nine-case benchmark,
which carries 133 expected findings — eight times the evidence. There the guard moves
recall from 32.3% to 36.1%, matched findings from 43 to 48, product recall from 39.4%
to 43.3%, and plausibility-confirmed unlisted-real findings from 76 to 86, while
genuine false positives stay identical at four and adjusted precision edges from 91.5%
to 92.3%. So the honest effect is roughly **four percentage points of recall at no
precision cost**, not eighteen.

What makes a single seed credible here is that every metric moves the same way at once
— recall, product recall, matched count, unlisted-real findings, precision, and
severity accuracy — while the false-positive count does not move at all. Variance on
this benchmark has not itself been measured, so the figure is directional.

Two properties of the benchmark are worth recording alongside the result. Its answer
key is badly incomplete: 86 unlisted-real findings against 48 matched means the engine
finds roughly 2.8 times more genuine defects than the key lists, so its `recall`
understates heavily and must never be compared against real-repository-corpus recall.
And adjusted precision, at 92.3% with four genuine false positives across about 134
real findings, is the number on this benchmark that can be trusted.

## Mechanism 2: Deterministic Security-Signal Evidence

A generic, deterministic detector that produces **typed evidence**, following this
spec's own division of labour: analyzers find paths, the model judges context. It
is the same split the *Deterministic Support Signal Contract* in
`05-review-workflow-and-runtime.md` already makes for non-security signals — they
supply facts and never publish findings.

- Language-neutral source/sink/sanitizer detection grounded in public rule catalogs
  (Semgrep registry, CodeQL CWE suites, OWASP dangerous-function lists), run on the
  existing ast-grep AST (its pattern API supports the needed metavariable queries)
  and the TypeScript AST for TS/JS.
- Each detection emits a **support signal** and an `EvidenceRecord` populating the
  already-defined but unused contract fields: `ruleId`, `cwe`, `helpUri`,
  `relatedLocations`, ordered `dataFlow` (source → sink steps), and
  `securitySeverity`. No contract change is required to carry this.
- By default the signal is **evidence for the model** (the security pass judges
  reachability, intent, and sanitizers), not an auto-admitted finding — matching
  the research: the model's judgment is the precision lever. A high-precision rule
  MAY seed a candidate through the existing trusted-rule path, but only when a
  deterministic fixture proves its precision, and it still faces scope, location,
  baseline, and admission.
- Deterministic and reproducible; off by default until measured to help on the
  held-out set without materially reducing precision.

## Bounded Agentic Evidence (Later, Gated)

For hard classes that need reachability confirmation (interprocedural taint,
cross-file authorization), a bounded agentic follow-up — reusing the spec-12
`investigate_claim` tool seam (mediated read/list/grep, budgeted) — MAY execute a
finding's parsed `contextRequests` or one demand-driven evidence request. This is
deferred: it is the highest-plumbing, highest-cost, non-deterministic lever, and it
is only justified after the security pass and deterministic-evidence levers are
measured. It
must respect this project's own measured "more context reduces quality" result —
recorded under *Measured Outcome* in `16-agentic-cross-file-discovery.md` and
`18-context-scout.md` — so it is one bounded, ranked follow-up, never
full-repository injection.

## Configuration

A `security` block, disabled by default. Keys are defined in
`04-configuration-and-providers.md`: `dedicatedPass.enabled`, and any bounds.
Invalid configuration fails validation with exit code 2. With the block disabled,
no security pass runs and the general review is byte-for-byte unchanged (the same
task set, the same single discovery call per task).

Mechanism 2 (deterministic security-signal evidence) has no implementation yet, so
it has no config key today. A `security.signals.enabled` key is introduced in the
same change that implements Mechanism 2 — shipping the key ahead of the mechanism
would be a switch with no behavior behind it.

## Observability, Safety, Privacy

- Security signals and the security pass are no-content: mechanism, rule id, CWE,
  counts, and durations only. No source, secret value, or payload appears in logs,
  traces, or events. Detected secret values are never emitted — only their location
  and kind.
- Repository content and any analyzer artifact are untrusted (spec 07). The security
  pass and signals cannot grant authority, change admission, severity, gates, or
  baseline, and are presented under the untrusted/informational framing.
- Every lane that ingests repository content is hardened against prompt injection
  from it: the general reviewer, the refuter, the security pass, the context scout,
  and the cross-file tool results each state that the content they receive is
  untrusted data rather than instructions. The general reviewer additionally treats
  text in reviewed code that tells it to ignore a problem as itself reportable when
  it hides a real defect. The reviewer's own prompt-injection resistance is a
  measured security mechanism.

## Testing

- Unit: mechanism/context-depth labeling of eval cases; the per-mechanism metric
  math (recall/adjusted-precision by mechanism, obvious-vs-hard split); each
  deterministic sink/source rule against deterministic positive and
  guard/sanitizer negative fixtures; the security-pass reviewText contract; the
  additive merge (a security candidate at a general-pass location is dropped as a
  duplicate; a security candidate at a new location is kept; the general pass's
  candidates are never dropped by the merge).
- Integration (hermetic, deterministic provider): the security pass produces
  candidates that pass refutation/admission; a planted authorization bug the general
  pass misses is caught by the security pass; a sanitized/guarded negative is not
  flagged; a deterministic signal populates `cwe`/`dataFlow` evidence; an untrusted
  repository payload cannot alter admission or the gate.
- No real-provider eval runs in the test suite; security-dimension measurement runs
  are explicit, cost-gated, and separate.

## Acceptance

- The evaluation reports security recall and adjusted precision **per mechanism and
  context-depth**, with obvious-vs-hard tracked separately, before any detector
  ships.
- With `security` disabled, no security pass or signal runs and the general review
  and gate are byte-for-byte unchanged.
- Every rule and checklist item cites a public OWASP/CWE/Semgrep/CodeQL source; none
  is justified by a specific eval finding; the trusted-rule map carries no
  benchmark-specific rule.
- Security-signal detections populate the existing `cwe`/`dataFlow`/`ruleId`/
  `securitySeverity` evidence fields; by default they are model evidence, not
  auto-admitted findings.
- The security pass's candidates pass the same untrusted refutation and admission
  as general candidates and are additive (they never displace a general candidate);
  the pass never bypasses scope, severity, baseline, or the gate.
- Any security improvement is demonstrated on the held-out set under the
  anti-contamination policy, not on the set it was built against.

## Known Divergences From This Spec

Recorded on 2026-07-27 by an alignment audit. **These are unmet requirements, not
amendments.** Everything above stands as written; this section exists so the gap is
visible rather than silent.

| Requirement | State of the implementation |
| --- | --- |
| *Acceptance*: the evaluation reports security recall **and adjusted precision** per mechanism and context-depth | Recall only. An admitted finding carries no mechanism label, so per-mechanism precision has no denominator; the eval renderer says so explicitly. Reporting precision per mechanism needs a labelling mechanism that does not exist yet. |
| *Mechanism 2* in full | Not implemented. This is already stated under *Configuration*: no detector, no rule catalog, and the `cwe`/`dataFlow`/`ruleId`/`securitySeverity` evidence fields exist on the contract but are never populated. The `security.signals` config key is correctly absent. |
| *Mechanisms*: `prompt-injection` as a measured security mechanism | The enum value exists; no committed expected finding carries it, so the mechanism has an empty denominator. |
| *Measurement First*: a contaminated `dev` set and a separate `held-out` set | Every case in the real-repository corpus manifest is labelled `held-out`. The chronological-split validation therefore has nothing to compare and passes vacuously, and the final acceptance criterion above cannot currently be satisfied as written. |
| *Mechanism 1*'s own measured outcome | Not recorded in this spec. The A/B exists and is recorded in the user documentation for the dedicated pass; its headline is that overall recall rose while **labelled security recall fell**, at materially higher cost, so the security-specific lift the mechanism was built for is unproven at n=1. That result belongs in this spec and should be transcribed here by its owner, alongside the standing caveat that it too predates the 2026-07-27 conversation-history suppression. |
| *Configuration*: "and any bounds" | The pass is capped in code at a fixed number of additional candidates per task. The bound is real and enforced; this spec names no bound at all. |
