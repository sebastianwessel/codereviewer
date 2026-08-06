# 15: Security-Focused Review And Measurement

Status: Approved
Date: 2026-07-24
Amended: 2026-08-01 — the security pass is partitioned with the general pass
(spec 27); its own A/B result is transcribed here
Amended: 2026-08-06 — Mechanism 2 is redefined as analyzer-artifact ingestion and
implemented, off by default and unmeasured, with a pre-registered decision rule

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

- When enabled, each review task issues a **second, security-only discovery call**
  whose reviewText applies the generic OWASP/CWE **checklist** across the mechanisms
  above to the same changed code, diff, and change-intent context, and instructs the
  model to report only concrete, evidenced security defects. Its method is
  source→sink: identify the trust boundary, trace each untrusted value to every
  sensitive sink it reaches, and report only where a concrete input or path reaches a
  sink unsafely or a required authorization check is missing, bypassable, or
  asymmetric.
- **The security pass MUST be partitioned exactly as the general pass is** (spec 27).
  A task whose files are spread across several discovery calls issues one security
  call per partition, over that partition's files. Spec 27's partitioning requirement
  is unqualified, and a security call that reviewed the whole task while the general
  pass reviewed slices would be both the largest packet in the run and the one call
  denied the attention benefit the whole mechanism rests on. Enabling the pass
  therefore doubles the discovery calls a task issues, whatever its partition count.
- The pass reuses the existing model-backed holistic discovery and refutation
  infrastructure — it is a second call of the same discovery agent with a
  security-focused reviewText, not a new agent, role, or pipeline.
- Its candidates are **additive**: they merge with the general pass's candidates and
  are never substituted for them, so the pass can only *add* security findings and
  can never reduce the general reviewer's recall (the attention tradeoff above is
  removed by construction). A security candidate at a `path:startLine` any general
  call already flagged is dropped as a duplicate, so the merge adds no report noise.
  Suppressions are counted and reported by cause — duplicate location versus
  duplicate candidate identity versus unparseable — so whether the pass is
  contributing new findings or restating the general pass's is visible rather than
  inferred.
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

### Measured Outcome Of The Dedicated Security Pass

Paired A/B, 2026-07-24, full `crb-*` benchmark, **one seed per arm**. Transcribed
here from the user documentation for the pass, where it was recorded first.

| | pass off | pass on |
|---|---|---|
| overall recall | 24.8% | **29.3%** |
| product recall | 29.8% | **34.6%** |
| unlisted-real findings | 45 | **67** |
| adjusted precision | 97.1% | 95.1% |
| genuine false positives | 1 | 2 |
| **labeled security total** | **14/41** | **12/41** |
| **authorization** | **8/22** | **6/22** |
| cost | $22.48 | $36.18 (**+61%**) |

**Overall recall rose while labeled security recall fell.** The overall gain has the
large denominator and is the trustworthy signal. The security drop is not the pass
hurting — the pass is additive by construction, so within one run it can only add
security findings; the 8→6 authorization movement is between two *different
general-pass runs*, and that pass's own run-to-run variance on a denominator of 22
(matched counts swing 6–9 on noise) swamps the additive contribution.

**That does not rescue the claim either: an uninterpretable number is not a positive
one.** The security-specific lift this mechanism was built for is **unproven at
n = 1**, at +61% cost. Proving it needs a multi-seed A/B (≥3 seeds per arm) to average
out the authorization noise, and that has not been run. This is why the pass stays off
by default; the ship condition stated above — a held-out net recall gain without an
authorization regression — is not met.

Like every figure on this page, it predates the harness-wide suppression of
conversation history on 2026-07-27 and is not comparable to a current run. It also
predates spec 27 partitioning, so it measured one security call per task rather than
one per partition.

### Measured Outcome Of The Injection Hardening

Every figure in this section predates the harness-wide suppression of conversation
history on 2026-07-27 (see *Conversation History* in `05-review-workflow-and-runtime.md`).
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

Amended 2026-08-06. **Mechanism 2 is an ingestion layer, not a detector.** The
division of labour is unchanged — analyzers find paths, the model judges context,
and the same split the *Deterministic Support Signal Contract* in
`05-review-workflow-and-runtime.md` makes for non-security signals applies here: the
layer supplies facts and never publishes findings. What changed is who produces the
facts.

**Why ingestion rather than a detector.** The earlier design was a source/sink/
sanitizer detector of our own, written against the ast-grep AST. Building one is
building a static analyzer, and the adjacent evidence
(`reports/2026-08-05-recall-lever-research.md`) is that in the one neighbouring
sub-problem where precision was actually solved, the winning artifact was a mature
deterministic semantic model, not a fresh one and not a model — a purpose-built
engine reaching F1 0.99 against general-purpose competitors at 0.86 and 0.91. A
hand-rolled rule set here would be the weakest member of that comparison, would
carry a rule catalog to maintain per CWE class, and would compete with analyzers
projects already run. Ingesting the artifacts those analyzers already produce buys
the deterministic evidence without the engine, and leaves the choice of analyzer
where it belongs — with the project being reviewed.

- **Interchange format: SARIF 2.1.0**, schema-validated at the boundary. An analyzer
  artifact is untrusted input (spec 07): it is produced by a tool this engine does
  not run, in a pipeline it does not control. It is parsed through Zod, bounded by a
  configured byte ceiling checked before the file is read, and bounded by a
  code-side ceiling on result count.
- **This engine never runs an analyzer** and adds no analyzer package to any
  dependency set (`INV-PROV-001`). A format reader is the only tool-aware code, and
  a second format would change that reader and nothing else.
- **Normalization** produces a tool-neutral alert model — analyzer identity and
  version, rule id, level, CWE list, security severity, help URI, primary location,
  related locations, and ordered data-flow steps (source → barrier → sink) where the
  producer supplies them. Each alert becomes an `EvidenceRecord` populating the
  previously unproduced contract fields `ruleId`, `cwe`, `helpUri`,
  `relatedLocations`, `dataFlow`, and `securitySeverity`. No tool-specific field
  reaches the finding contract.
- **Nothing is invented and nothing is dropped silently.** A field the producer did
  not supply stays absent; a severity outside 0–10 is dropped rather than clamped. A
  result that cannot be normalized, one whose path does not resolve, one held back by
  attribution, and one cut by the cap are each counted and disclosed.

### Changed-Side Attribution (mandatory)

An analyzer artifact describes a repository; a review describes a change. An alert
is reported **only** when the change is demonstrably implicated in it, by one of two
positive tests over the run's changed new-side line ranges:

- **`changed-line`** — the alert's own primary location falls on a changed line.
- **`changed-flow`** — a step of its data flow, or one of its related locations,
  falls on a changed line: the change declares, feeds, or removes a barrier on the
  path the alert traces, even where the reported sink is untouched older code.

There is no third test, and in particular no "the file was touched somewhere". A
pre-existing alert in a file whose unrelated lines moved is repository debt, and
reporting it would blame a change for the state it inherited. With no changed
ranges at all (an explicit-file run), nothing is attributed and the run says so.

**What attribution cannot catch**, recorded so the limit is visible rather than
assumed: a change that exposes an existing vulnerable path without appearing
anywhere on that path — an authorization wrapper removed in an unrelated module, a
widened route pattern, a relaxed build or deployment setting, a dependency upgrade.
Every location the analyzer names sits in unchanged code, so no positive test fires.
The alternative — attributing transitively — is the pre-existing-debt flood this
gate exists to prevent, so those alerts are held back and their count is reported.

### Admission Path: Evidence, Not Seed

**First delivery is evidence-only. An ingested alert seeds no candidate.** Spec 15
permits a high-precision rule to seed one through the trusted-rule path, and this
delivery declines that permission, for three reasons:

- The permission is conditional on "a deterministic fixture proves its precision",
  and no such fixture exists for a third-party rule catalog this engine neither
  wrote nor controls. The precision of an ingested rule is a property of somebody
  else's tool and of the repository it ran on.
- Every seeded candidate costs one downstream refutation call, and the workflow's
  child-agent reservation is derived from code-side candidate constants (see
  *Configuration*). A candidate count set by an external artifact would let an
  artifact under-reserve refutation.
- Nothing is measured. The conservative option is the one that cannot damage the
  precision story while it is unmeasured.

So an alert reaches the review as one context-only `analyzer-signal` document on the
task that owns the reported file, framed as an untrusted third-party claim to judge
against the code — never as a finding, never as an instruction, and explicitly not
as evidence of safety when absent. Anything reported afterwards is a reviewer
candidate that passed the same discovery, refutation, scope, severity, baseline, and
admission path as any other. There is no model-free and no gate-free route from an
artifact to an actionable finding.

Redaction runs during normalization, before any analyzer text can reach a model or
an artifact: analyzer messages quote the code they matched, and a secrets rule
quotes the secret.

### Failure Is Loud

A configured artifact that is missing, unreadable, oversized, not JSON, or not SARIF
2.1.0 fails the run with exit 2. An artifact that parses but carries no result, and
every category of result held back, is reported as a run warning. Absence is never a
plausible default here: a review that quietly produced no security signals reads
exactly like a repository that has none.

## Bounded Agentic Evidence (Later, Gated)

For hard classes that need reachability confirmation (interprocedural taint,
cross-file authorization), a bounded agentic follow-up — reusing the spec-12
`investigate_claim` tool seam (mediated read/list/grep, budgeted) — MAY execute a
finding's parsed `contextRequests` or one demand-driven evidence request. This is
deferred: it is the highest-plumbing, highest-cost, non-deterministic lever, and it
is only justified after the security pass and deterministic-evidence levers are
measured. It
must respect this project's own measured "more context reduces quality" result —
recorded under *Withdrawal Of The Context Scout* in
`05-review-workflow-and-runtime.md` — so it is one bounded, ranked follow-up, never
full-repository injection. It must also answer
the finding that withdrew the context scout (`05-review-workflow-and-runtime.md`):
the reviewer largely does not read the context it already has, so more context is
an unlikely remedy on its own.

## Configuration

A `security` block, disabled by default: `dedicatedPass.enabled` (Mechanism 1) and
`signals.*` (Mechanism 2). Invalid configuration fails validation with exit code 2.
With the block disabled, no security pass runs, no artifact is read, and the general
review is byte-for-byte unchanged — the same task set, the same general discovery
calls, no second call, and not one extra byte in a packet.

Mechanism 2's keys:

| Key | Default | Meaning |
| --- | --- | --- |
| `security.signals.enabled` | `false` | Master switch for analyzer-artifact ingestion. |
| `security.signals.artifacts` | `[]` | Artifacts to read: `{ path, format: "sarif" }`, path repository-relative. |
| `security.signals.maxArtifactBytes` | `4000000` | Per-artifact size ceiling, checked before the file is read. |
| `security.signals.maxAlerts` | `40` | Cap on attributed alerts shown to the review; when it binds the held-back count is reported. |

`enabled: true` with an empty `artifacts` list is **rejected**. A switch that is on
and reads nothing would report no security signals and look exactly like a clean
scan — the silent-optimism shape this repository has a standing rule against.

The ceiling on results normalized from one artifact is **not** configurable and is
set in code (10 000). An artifact above it is a whole-repository scan rather than a
change-scoped one, and normalizing it would spend the run producing alerts
changed-side attribution is about to discard.

`format` is explicit rather than inferred from a file extension: a file's name is
not evidence of its contents, and an unreadable artifact must fail by name.

The pass's candidate bound is **not** configurable and is set in code: a security
call may add at most **8** candidates, against the general call's **12**, because it
targets a narrow class set at locations the general pass did not already flag. Both
caps are per discovery CALL, so a partitioned task's ceiling scales with its partition
count. The bound is deliberately code-side: every candidate costs one downstream
refutation call, and the workflow's child-agent reservation is derived from these
constants — a configurable value would let a user under-reserve refutation and leak
unfiltered findings.

The `security.signals` keys shipped in the same change as the behaviour behind them
(2026-08-06), which is the rule this section previously stated in the negative.

## Pre-Registered Decision Rule For Mechanism 2

**Written before any measurement of this mechanism, and not to be edited after one
is taken.** It exists because the honest reading of a result is fixed in advance or
it is fixed to suit the result.

Mechanism 2 is **unmeasured**. Nothing anywhere — spec, documentation, or the tool's
own output — may describe it as improving security recall until the measurement
below exists.

The measurement is a paired A/B on the held-out security set under the
anti-contamination policy above, **≥3 seeds per arm** (a single seed cannot separate
this mechanism's contribution from the run-to-run variance recorded throughout this
spec), one arm with `security.signals` off and one with it on over artifacts produced
by an analyzer configured independently of the corpus. It reports recall per
mechanism, adjusted precision, and genuine false positives, and it reports the
attribution counters — attributed, pre-existing, unusable — alongside them, because
a null result caused by attribution holding everything back is a different finding
from a null result caused by the model ignoring the evidence.

- **Promotes to enabled-by-default** only if all four hold: mean security recall rises
  by ≥3 percentage points across seeds; adjusted precision does not fall by more than
  1 percentage point; genuine false positives do not rise; and no seed shows an
  authorization-class regression (the failure Mechanism 1 has already recorded once).
- **Keeps shipping disabled** if the mechanism is neutral, if the result is within
  the measured seed variance, or if the measurement has not been run. Disabled is the
  default outcome, not the punishment outcome: an unproven lane that costs nothing
  when off is worth keeping available to operators who already run analyzers.
- **Is removed** if any of these hold: attributed alerts prove to be dominated by
  pre-existing debt the attribution gate failed to hold back (a precision failure of
  the gate itself, visible as genuine false positives traceable to analyzer evidence);
  adjusted precision falls by more than 3 percentage points; or two independent
  measurement cycles produce no recall movement outside variance. Removal means the
  code and the config key go together, in one change.

Cost is recorded but is not a promotion criterion: ingestion adds no model call, and
the packet growth it causes is bounded by `maxAlerts`.

## Observability, Safety, Privacy

- Security signals and the security pass are no-content: mechanism, rule id, CWE,
  counts, and durations only. No source, secret value, or payload appears in logs,
  traces, or events. Detected secret values are never emitted — only their location
  and kind.
- Repository content and any analyzer artifact are untrusted (spec 07). The security
  pass and signals cannot grant authority, change admission, severity, gates, or
  baseline, and are presented under the untrusted/informational framing.
- Every lane that ingests repository content is hardened against prompt injection
  from it: the general reviewer, the refuter, the security pass, the semantic
  finding merge, and the cross-file tool results each state that the content they
  receive is untrusted data rather than instructions. The general reviewer
  additionally treats
  text in reviewed code that tells it to ignore a problem as itself reportable when
  it hides a real defect. The reviewer's own prompt-injection resistance is a
  measured security mechanism.

## Testing

- Unit: mechanism/context-depth labeling of eval cases; the per-mechanism metric
  math (recall/adjusted-precision by mechanism, obvious-vs-hard split); the
  security-pass reviewText contract; the additive merge (a security candidate at a
  general-pass location is dropped as a duplicate; a security candidate at a new
  location is kept; the general pass's candidates are never dropped by the merge).
- Unit, Mechanism 2, against committed SARIF fixtures: normalization (CWE from
  taxonomy tags and plain properties, severity read and out-of-range dropped, level
  precedence, flow steps keeping source and sink, unusable results counted);
  changed-side attribution (a pre-existing alert is NOT reported; an alert on a
  changed line is; an alert in a changed FILE but outside every changed line is not;
  an alert whose flow or related location crosses the change is; nothing is
  attributed with no changed ranges); artifact validation (missing, oversized,
  non-JSON, wrong SARIF version, a path outside the repository, a symlink to a
  target outside it — each fails loudly); path resolution (traversal, absolute path,
  URI scheme, and ineligible path all rejected); redaction of analyzer message text;
  and the packet section's framing against the prompt-genericity guard.
- Integration (hermetic, deterministic provider): the security pass produces
  candidates that pass refutation/admission; a planted authorization bug the general
  pass misses is caught by the security pass; a sanitized/guarded negative is not
  flagged; an ingested alert populates `cwe`/`dataFlow`/`ruleId`/`securitySeverity`
  evidence, reaches the discovery prompt, and produces no candidate of its own; a
  run with `security.signals` disabled renders a discovery packet byte-for-byte
  identical to one built before the mechanism existed; an untrusted repository
  payload cannot alter admission or the gate.
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
- Security-signal evidence populates the existing `cwe`/`dataFlow`/`ruleId`/
  `securitySeverity` evidence fields; it is model evidence, never an auto-admitted
  finding and never a seeded candidate.
- An ingested analyzer result is reported only with a changed-side cause: its own
  location on a changed line, or a step of its traced path on one. Results without
  one are held back and counted.
- Ingestion adds no analyzer package to any dependency set and runs no analyzer.
- The security pass's candidates pass the same untrusted refutation and admission
  as general candidates and are additive (they never displace a general candidate);
  the pass never bypasses scope, severity, baseline, or the gate.
- Any security improvement is demonstrated on the held-out set under the
  anti-contamination policy, not on the set it was built against.

## Known Divergences From This Spec

Recorded on 2026-07-27 by an alignment audit, re-checked on 2026-08-01 when
Mechanism 1's own A/B result was transcribed into this spec and its candidate bound
named under *Configuration* (retiring two rows), and re-checked on 2026-08-06 when
Mechanism 2 shipped as the ingestion layer described above (retiring one row and
narrowing another). **These are unmet requirements, not amendments.** Everything
above stands as written; this section exists so the gap is visible rather than
silent.

| Requirement | State of the implementation |
| --- | --- |
| *Acceptance*: the evaluation reports security recall **and adjusted precision** per mechanism and context-depth | Recall only. An admitted finding carries no mechanism label, so per-mechanism precision has no denominator; the eval renderer says so explicitly. Reporting precision per mechanism needs a labelling mechanism that does not exist yet. Owned by the evaluation domain. |
| *Mechanisms*: `prompt-injection` as a measured security mechanism | The enum value exists; no committed expected finding carries it, so the mechanism has an empty denominator. Owned by the evaluation corpus. |
| *Measurement First*: a contaminated `dev` set and a separate `held-out` set | Every case in the real-repository corpus manifest is labelled `held-out`. The chronological-split validation therefore has nothing to compare and passes vacuously, so the held-out acceptance criterion — and the pre-registered decision rule that depends on it — cannot be satisfied until a genuine split exists. Owned by the evaluation corpus. |
| *Observability, Safety, Privacy*: the security pass is no-content, reporting "mechanism, rule id, CWE, counts" | Mechanism 2 now records rule id, CWE, analyzer identity and per-artifact counts, so the fields exist. The **security pass** still records only counts and durations: its candidates carry no mechanism label, and labelling a model-authored candidate by mechanism is the same missing capability as the first row. |
| *Mechanism 2*: measured before any promotion | Shipped and **unmeasured**. Off by default. No figure exists for it anywhere, and the *Pre-Registered Decision Rule* above fixes in advance what a future measurement would have to show. Not a divergence from a requirement — the requirement is that it ship disabled until measured, which it does — but recorded here so nobody reads its existence as evidence that it works. |
