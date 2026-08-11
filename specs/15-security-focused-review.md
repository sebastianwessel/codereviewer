# 15: Security-Focused Review And Measurement

Status: Approved
Date: 2026-07-24
Amended: 2026-08-01 — the security pass is partitioned with the general pass
(spec 27); its own A/B result is transcribed here
Amended: 2026-08-06 — Mechanism 2 is redefined as analyzer-artifact ingestion and
implemented, off by default and unmeasured, with a pre-registered decision rule
Amended: 2026-08-06 — the three evaluation-side gaps recorded under *Known
Divergences* are closed (per-mechanism precision, the `prompt-injection`
denominator, the vacuous split), and the precondition for measuring Mechanism 2 is
measured and reported under *Why Mechanism 2 Is Still Unmeasured*
Amended: 2026-08-07 — the analyzer firing base rate is measured on 132 confirmed
vulnerabilities and bounds Mechanism 2's reach below its own promotion threshold;
recorded under *The Analyzer Firing Base Rate*. The pre-registered rule is applied,
not edited.

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

### Attributing An Admitted Finding To A Mechanism

Added 2026-08-06. Per-mechanism recall needs only the ground truth's label.
Per-mechanism **adjusted precision** needs the other half of the denominator — the
genuine false positives belonging to each mechanism — and an admitted finding
carries no mechanism, which is why that half did not exist.

An admitted finding is attributed from the only two sources that can justify a
label, and from nothing else:

- the **matched expectation**, when the finding matched a mechanism-labelled
  security expectation. This is the same pair `securityRecallByMechanism` counts,
  so precision and recall can never disagree about what matched;
- the finding's own **CWE** tags, resolved through a public CWE→mechanism table
  whose every entry is a CWE whose definition *is* the mechanism. A list whose
  known ids disagree resolves to nothing rather than to the first or the most
  severe of them.

Anything else is **`unknown`**, and `unknown` is a reported bucket, not a discard.
Inferring a mechanism from a finding's title or prose would manufacture the very
denominator the measurement exists to establish.

The population is deliberately asymmetric: a matched finding enters the numerator
for its expectation's mechanism whatever category the engine gave it, while an
*unmatched* finding enters a denominator only when it is a genuine false positive
that the engine itself called security. Unlisted-real findings stay out, exactly
as they do in the run-level `adjustedPrecision`.

**A per-mechanism precision rate is published only when it is bounded.** One
genuine security false positive nobody could attribute could belong to any
mechanism, so it bounds all of them; while such a finding exists in a run, every
per-mechanism rate is `null` and the counts are what a reader uses. A vacuous
100% would be the silent-optimism shape this repository has a standing rule
against. The attribution counters — how many labels came from an expectation, how
many from a CWE, how many from nothing — are reported alongside, because a run
whose `unknown` share is large has not measured per-mechanism precision however
many rates it prints.

### A Corpus With One Split Must Say So

Added 2026-08-06. The chronological-split rule has exactly one silent failure
mode: with cases in only one split there is nothing to compare, so it passes
while checking nothing, and a dataset that never had a split reads exactly like
one whose split was verified.

A corpus manifest therefore **declares** what its split validation can prove, and
the declaration is cross-checked against its cases. A manifest claiming a
verified chronological split while carrying only one split is rejected; a
manifest carrying only one split must state, in the manifest itself, what every
figure produced from it must be read as. Declaring a stale single-split posture
after a genuine comparison set is added is rejected too.

The committed real-repository corpus is `single-split`, and its recorded note is
the honest reading of it: every case is labelled held-out and post-cutoff, so
this is not training contamination — it is **iteration contamination**. Every
baseline, A/B, and prompt change this project has measured was decided on these
same cases, which is precisely the role reserved for a dev set. Every figure from
that corpus, security figures included, is a dev-set figure. It does not satisfy
the held-out acceptance criterion, and it does not satisfy the *Pre-Registered
Decision Rule For Mechanism 2*, which requires a held-out set. The remedy is
capturing genuinely newer cases and re-labelling the current set as dev;
re-labelling cases without new material would manufacture a held-out set and is
forbidden.

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
- open redirect: a redirect target taken from attacker-controlled input;
- XSS and output encoding;
- insecure deserialization;
- secret and sensitive-data flow;
- cryptography (weak primitive, misuse, predictable randomness);
- filesystem / path traversal;
- unsafe configuration;
- concurrency and resource exhaustion.

**The reviewer's own prompt-injection resistance is a security mechanism of this
capability, but it is not one of the labels above, and that separation is
deliberate** (2026-08-06). Every label above names a defect class in reviewed
code, and its measurement is recall: did the reviewer report the defect. Reviewer
resistance is the opposite shape — did the reviewer *refuse* an instruction
embedded in repository content — which no expected finding can express. Carried in
the same enum it had no expectation anywhere, so every report published
`prompt-injection: 0%` over an empty denominator, which reads as a measured
failure to anyone who does not also read the count.

**That second argument no longer holds, and the separation stands anyway.** As of
2026-08-11 every security recall rate is NULL over an empty denominator rather than
0, so an untested label no longer reads as a failed one — the defect this sentence
described was cured at the root, in `SecurityMechanismRateSchema`, and removing an
enum member was only ever a way around it. It had also spread far past this label:
23 archived reports publish `securityObviousRecall: 0` on corpora carrying no
security expectation at all.

The separation survives on the FIRST argument alone, which was always the load-
bearing one: reviewer resistance is a *refusal* behaviour that no expected finding
can express, and that is a different measurement shape from recall. This label is
therefore not restored to the enum. It is measured behaviourally instead: by the injection-guard clauses required of the general
reviewer, the refuter, the security pass, the semantic merge, and the cross-file
tool results under *Observability, Safety, Privacy*, and by their colocated
tests. A mechanism nothing expects is now absent from the reported table rather
than reported as zero, and this rule is general — it is not a carve-out for one
value.

**Open redirect is its own label rather than a sub-case of SSRF or injection**
(added 2026-08-07, and the justification is the public catalog, not any fixture).
CWE-601, *URL Redirection to Untrusted Site ('Open Redirect')*, is the weakness in
which attacker-controlled input reaches a redirect target, so a site the victim
already trusts forwards that victim onward to an attacker's site. OWASP has
carried the class since *Unvalidated Redirects and Forwards* (A10:2013) and maps
CWE-601 into A01:2021 Broken Access Control. It is not SSRF, because CWE-918 is
the **server** issuing an attacker-chosen request to a host typically only it can
reach, whereas an open redirect makes the server fetch nothing at all — it emits a
`Location` and the victim's **browser** follows it. It is not injection, because
CWE-74 requires untrusted input to change the STRUCTURE a downstream interpreter
parses, and a redirect target is a value arriving where a value is expected.
Different actor, different trust boundary, different fix: an allowlist of targets
a user may be sent to, not of hosts the server may reach. CWE-601 was mapped to
`ssrf` in the CWE→mechanism table until this change and now maps to
`open-redirect`; no other id qualifies, because CWE-610 is the parent that spans
SSRF as well and CWE-1022 is reverse tabnabbing.

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
  reaches the finding contract, and **no analyzer metadata is joined onto a
  finding**: `CandidateFinding`/`AdmittedFinding` carry the same six field names,
  filled only by the candidate's own proposer (spec 03), because attaching an alert
  to a model-authored finding by shared location would give one defect's CWE and
  taint path to another defect that happens to sit on the same line. The alert's
  metadata stays on its evidence record, under the analyzer's name.
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
`investigate_claim` tool seam (mediated read/list/grep, budgeted) — MAY execute
one demand-driven evidence request. (An earlier draft routed this through a
`contextRequests` field on the discovery output. That field was parsed, validated
and capped for its whole life and read by nothing, so a model that filled it was
answered with silence; it was removed on 2026-08-10. A follow-up here must be a
TOOL the reviewer calls, which is what spec 16's cross-file retrieval already is,
not a field it fills and hopes someone reads.) This is
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

## Why Mechanism 2 Is Still Unmeasured

Recorded 2026-08-06. **The pre-registered rule above has not been run and is not
edited by this section.** What was run is its precondition, and the precondition
failed, which is why the rule cannot be.

The rule needs SARIF per corpus case. Producing it is easy: Semgrep OSS 1.172.0
(LGPL-2.1) installed offline in one step and scanned all 37 hydrated
real-repository checkouts — twelve languages — in **275 seconds of wall clock at
no provider cost**, with the public `p/security-audit` ruleset chosen
independently of the corpus. It produced **924 results**, and the engine's own
normalizer accepted every one of them (0 unusable).

Then changed-side attribution ran over them, and the result is the whole finding:

| | |
| --- | --- |
| normalized alerts | 924 |
| unusable | 0 |
| **attributed to the change** | **0** |
| held back as pre-existing | 924 |
| alerts even landing in a changed **file** | 1 (outside every changed hunk) |

A control rules out ruleset breadth as the explanation. Re-running with
`p/default` + `p/security-audit` + `p/secrets` + `p/owasp-top-ten` restricted to
only the changed files of each case — the most generous configuration available —
produced **6 alerts across the whole corpus, of which 0 fell on a changed line**.

Two things follow, and they point in opposite directions:

- **The load-bearing property of Mechanism 2 holds on real analyzer output**, the
  first time it has seen any. Not one alert of 924 leaked through the gate; the
  pre-existing-debt flood the gate exists to prevent did not occur. That is the
  strongest available evidence for the design, and it is deterministic evidence:
  attribution runs before any model call, so it cost nothing to obtain.
- **The evidence channel is empty on this corpus**, so the paired A/B cannot
  measure anything. Both arms would build byte-identical packets — the `on` arm
  injects zero `analyzer-signal` documents — and running ≥3 seeds per arm over 37
  cases with a real provider would spend real money to confirm a guaranteed zero.
  The rule anticipated exactly this and names it: a null result caused by
  attribution holding everything back is a **different finding** from a null
  result caused by the model ignoring the evidence. This is the first kind, and
  it is reportable without the A/B.

The mechanism therefore **keeps shipping disabled**, which is the rule's stated
outcome when the measurement has not been run. It is not removed: removal is
reserved for a gate that fails, and this gate did not fail — it was never
supplied with anything to pass.

**What would change this** is a corpus whose changed lines an analyzer actually
flags. The current corpus is 37 subtle authorization, concurrency, and
protocol-parsing defects in mature repositories, which is the class a pattern
analyzer is worst at and the class this engine was built for; the two are close
to disjoint by construction. Measuring Mechanism 2 needs cases selected *because*
a public analyzer flags their changed lines — captured under the same
anti-contamination policy, and never mined from this engine's own output. Until
such a set exists, no artifact-generation step is committed: infrastructure for a
measurement that cannot run is infrastructure that rots.

## The Analyzer Firing Base Rate

Recorded 2026-08-07. **The pre-registered rule is applied here, not edited.**

The section above named the missing ingredient: cases an analyzer flags. Before
building that set it was worth asking how large it could be. The answer is the
finding, and it is reported in full in
`reports/2026-08-07-analyzer-firing-base-rate.md`.

132 vulnerabilities were assembled from GitHub Security Advisories published after
the training cutoff on permissively licensed repositories, each with a single fix
commit that deletes or modifies the vulnerable line — the only shape that can
produce an attributable alert, since the reviewed diff is the fix read backwards
and the analyzer scans the parent tree. Semgrep OSS 1.172.0 then scanned every
parent-side changed file under twelve public rulesets.

| | |
| --- | --- |
| candidates | 132 |
| **any alert on a line the fix removed or modified** | **4 (3.0%, 95% CI 0.8–7.6%)** |
| …alerts that actually name the advisory's weakness | **2 (1.5%)** |

Two of the four are on point (a `filepath.Clean` misuse on the exact traversal line;
an `html_safe` bypass on the exact line the fix replaced with `safe_join`). The
other two are wide-span alerts that *contain* a changed line while describing a
different weakness entirely. Attribution admits them correctly by its own contract;
their information content about the change is nil.

**A first pass of this measurement used `p/security-audit` alone and produced 0/132.
That number was wrong and is recorded here so it is not re-derived.** On a control
file of ten blatant sinks that ruleset fired on four, missing path traversal, SSRF,
reflected XSS and weak-hash. The union of twelve rulesets fires on all ten. Any
future re-measurement must validate its analyzer configuration against a control
before reporting a null.

### What follows for the pre-registered rule

Mechanism 2 is an ingestion layer: it can only change a review where attribution
admits an alert. At a 3.0% admission rate, **the ceiling on its recall lift is 3.0
percentage points even if every admitted alert converted a miss into a find**, and
1.5 points counting only informative alerts. The rule's promotion bar is ≥3 points
of *mean* lift across seeds. The bar sits at or above the ceiling.

The rule's outcome is therefore unchanged and its basis is not:

- **Keeps shipping disabled** — previously because the measurement had not been run,
  now because a strict upper bound on the effect has been measured and does not
  reach the bar.
- **Not removed.** Removal is reserved for a gate that fails. The gate did not fail;
  for the second time it was never supplied with anything to pass.
- **No A/B is run, and none should be.** Three seeds per arm to resolve an effect
  bounded at four cases would spend real money to decorate a conclusion the bound
  already fixes. The bound is the measurement.

### The bound is a property of the analyzer, not of the mechanism

This is the reason the lane stays available. The 3.0% is Semgrep OSS with public
rulesets. CodeQL's data-flow analysis and commercial rule sets have materially
different recall, and an operator already running one may sit far above this rate —
for that operator the mechanism's ceiling is correspondingly higher. Nothing here
licenses describing Mechanism 2 as improving security recall, for any analyzer:
conditional efficacy — whether the reviewer *uses* an alert once it is admitted —
remains unmeasured, and the sample that could measure it is four cases.

The 132 vulnerabilities are not discarded with this result. They are the source of
the security corpus described under *The Security Corpus*, which measures the
reviewer against defect classes the previous corpus barely contained.

## The Security Corpus

Added 2026-08-07, grown twice the same day. `eval/corpora/security-advisory-2026/`,
72 cases, hydrated by spec 17's machinery unchanged — same manifest schema, same orientation, same
hydration gates. Nothing new was built for it, which is the point: a corpus that
needs its own runner is a corpus whose numbers cannot be compared to anything.

Every case is a security defect **because a reviewed GitHub Security Advisory
published after the training cutoff says so**, never because a curator or an
analyzer thought the code looked wrong. Selection is on ground truth alone —
weakness class, language, fix size, severity. Whether any analyzer flags a case
played no part, so recall measured here is a statement about the reviewer and not
about a scanner.

| | round one | grown |
| --- | --- | --- |
| cases | 25 | **51** (15 dev, 36 held-out) |
| expected findings | 26 | **52** |
| distinct repositories | 24 | **34** |
| cross-file expectations | 8 | **14** |
| languages | all seven | all seven |
| mechanisms | all ten | all ten |

The second round exists because the first round's own baseline said so: at sd
7.69pp over three seeds, 26 expectations could not resolve an intervention worth
making. Doubling the cases is the only lever that moves that; more seeds on the
same expectations does not. `cross-file` doubled deliberately — it is the row the
first baseline identified as the deficit, and it was the thinnest evidence in the
corpus at 8 expectations.

**This corpus has a real chronological split, and it is the project's first.** Every
fix is post-cutoff, dev is every fix before 2026-06-01, held-out is every fix on or
after, and the boundary is the one `parseRealRepoCorpusManifest` actually verifies.
The existing cross-file corpus is `single-split` and says so; its figures are
dev-set figures. These are not, until an A/B is decided on them — at which point
the dev half absorbs the iteration and the held-out half is what an acceptance
claim may cite.

The per-mechanism denominators are small — one to four expected findings each. A
per-mechanism rate from this corpus is a direction, not a number, and must be
published with its counts.

### Measured Baseline

Provider `openai/gpt-5.3-codex`, engine pinned `49f0c669`, three seeds, 2026-08-07,
on the 50-case corpus. Report: `reports/2026-08-07-security-corpus-baseline.md`.

| | mean | sd |
| --- | --- | --- |
| recall | **60.8%** | **3.92pp** |
| precision, raw (lower bound) | 71.0% | 2.18pp |
| precision, adjusted (upper bound) | 100% | 0 |

**Zero genuine false positives across three seeds and 51 expectations.** Every
unmatched finding was judged a real defect the advisory did not name, which is what
an advisory-derived key predicts and why precision here is a bracket.

**The variance claim once made here — that doubling the corpus halved sd from
7.69pp to 3.92pp — does not hold.** Four independent three-seed estimates of
no-intervention recall span 2.22–8.38pp; pooled over 8 degrees of freedom the sd is
**5.71pp** and three seeds resolve about **11 percentage points**. Both earlier
figures were single estimates of a quantity whose estimator varies by 3.8x between
samples. That was the
purpose of the second curation round, and it is the only lever that works — more
seeds on the same expectations add denominator without adding information.

The earlier 57.7% on 25 cases is superseded and the two figures are **not a change**:
they measure different corpora.

**By mechanism** (pooled, 3 seeds × expectations): path-traversal 22/24,
cryptography 12/15, concurrency-resource 12/18, deserialization 2/3, secret-flow
9/15, ssrf 9/15, injection 10/21, xss 10/21, **authorization 7/18**, unsafe-config
0/3.

**`authorization` at 39% is the result that got worse with better data**, and it
matters more than any other row here: this spec's opening evidence is that
authorization and access-control logic carry ~59% of real security findings. On the
25-case corpus the row was 2/6 and dismissible as noise. On 18 observations it is
the worst substantial mechanism.

**By context depth**: local 18/21, caller 5/6, callee 12/18, cross-function 15/24,
implementation 22/36, **cross-file 20/42 (48%)**, analyzer-path-dependent 1/6.

Cross-file remains the worst row with a real denominator and the largest bucket in
the corpus, measured with cross-file retrieval already enabled by default. It reads
48% here against 38% on the small corpus — a better measurement of the same thing,
not an improvement.

**Two rows the small corpus got wrong, kept as worked examples.** `cross-function`
read 9/9 (100%) on nine observations and is 15/24 (62%) on twenty-four;
`local` read 72% and is 86%. A perfect row on a small denominator is an artifact,
which is what the "directions, not numbers" rule exists to prevent.

### Reviewing a fix backwards contaminates a third of the candidates

This is the methodological result, and it constrains every future corpus of this
shape.

The orientation that makes the defect appear as *added* code has a consequence
nobody wrote down before it was measured: **every explanatory comment the fix ADDED
becomes a removed line the reviewer reads.** Fix authors comment security fixes
heavily and precisely, because they are explaining a subtle repair to the next
maintainer. That prose is the answer key.

Of 38 curated cases, the hydration disclosure gate flagged 15 and **13 were
dropped** — a 34% loss. One javadoc enumerated exactly which address ranges must be
refused. Another named the weakness class and the interpolation it enables. One
diff contained the advisory identifier itself. Two survived: one by narrowing the
reviewed paths to the file without the disclosure, one because its comments
described ordering and a sibling code path without ever naming what made the input
dangerous, recorded case-by-case under `removedCommentDisclosureReview`.

Three things follow:

- **The gate is load-bearing, not ceremonial.** Before this it had never rejected
  anything at scale. Curating without it would have produced a corpus a third of
  whose cases the reviewer could pass by reading a comment, and the resulting
  security recall would have looked good and meant nothing.
- **Budget for the loss.** Roughly three candidates must be curated for every two
  cases that survive. A curator who plans for 1:1 will quietly relax the gate to
  hit a target, which is the failure this whole section exists to prevent.
- **`reviewIntent` being clean is not sufficient.** The manifest's answer-key check
  reads the curator's prose, and the curator writes it carefully. It cannot read
  the diff. The two checks are independent and both are required.

### The disclosure gate reads comments, and prose also travels in string literals

Found 2026-08-07 during the second curation round, by a curator rather than by the
gate.

`removedProseCommentsIn` finds **comments**. A fix that explains itself in a string
literal instead passes it. Two real examples from candidates that had to be dropped
by hand:

- a `ValidationError` message naming the check the fix adds;
- a config option's `Help` text reading *"can plant a setuid binary, which is
  dangerous … when restoring from an untrusted source while running as root"*.

Neither is a comment. Neither contains an advisory id or the words
vulnerability/exploit, so `answerKeyLeakIn` over the generated diff does not catch
them either. Both hand the answer to a reviewer that reads the diff.

**This is not fixed by broadening the detector**, and that is a deliberate decision
rather than a deferral: every added string literal is prose by construction, so a
literal-scanning gate would flag most security fixes and be switched off within a
week. A gate that cries wolf is worse than a documented limit.

The mitigation is therefore procedural and is stated as a rule for curators: **read
every piece of English the fix ADDS — comment or string literal — before accepting a
case.** The automated gates remain a floor. Three of the seven cases kept in that
round survived only because a curator narrowed `reviewedPaths` around a disclosing
literal.

Two smaller rules the same round established, recorded so they are not re-derived:

- **When the advisory's primary file is also the disclosing one**, keep the case on
  an independently exploitable secondary site if one exists and say so in `notes`;
  otherwise drop it. Do not reword upstream code.
- **An advisory with no honest `securityMechanism`** is a drop, not a stretch. One
  candidate was upstream-tagged `xss` and was in fact output-transcoding fidelity
  with no attacker. Labelling it would have corrupted a per-mechanism denominator,
  which is the one thing the mechanism vocabulary exists to protect.

### Three more things the second round established

Recorded 2026-08-07, from five curators working the same brief independently.

**Inline unit tests disclose even when `reviewedPaths` excludes every test file.**
Rust and Go keep tests in the source file, so a fix-added test *name* —
`test_file_resolution_rejects_traversal_outside_agent_dir` — is in a reviewed path
by construction. Two curators hit this in different languages. There is no path to
exclude; the case is a drop.

**A guard-addition fix is not automatically disclosing, and the boundary is
this:** prose that only restates an identifier already visible in the removed code
is not a statement of the defect; prose explaining *why the check must sit at that
exact point* is. Reversed, every guard-addition shows a guard being deleted, so a
rule of "names the missing check" would reject the entire class and with it most
real security fixes. Two curators converged on this line independently before it
was written down.

**The mechanism vocabulary has no member for open redirect (CWE-601), and that
gap cost a good case.** Two curators, working the same devise advisory without
knowledge of each other, reached for two *different* wrong buckets — one
`injection`, one `ssrf`. That they disagreed is the evidence: the class is absent,
not merely awkward. The case was dropped under the rule that an advisory with no
honest mechanism is a drop rather than a stretch, because either label would have
polluted a per-mechanism denominator that exists precisely to be trustworthy.

**Adding `open-redirect` to `SecurityMechanismSchema` was the right fix and was
deliberately not made in that change.** It changes the shape of a published metrics
contract — a new per-mechanism row — and doing that in the same change as a corpus
that doubled would have confounded the re-baseline. It is a taxonomy improvement,
not a corpus accommodation: CWE-601 is a standard class and this spec claims
OWASP/CWE alignment.

It landed on its own on 2026-08-07, once the re-baseline was committed, under
metrics version `2026-08-07.open-redirect-mechanism`. The justification is in
*Mechanisms* above. What the version entry declares is worth restating, because
the honest answer is narrower than "a metrics contract changed": the only value
that moves for identical engine output is a per-mechanism PRECISION structure, and
it moves because CWE-601 stopped resolving to `ssrf`, not because a row was added.
`securityRecallByMechanism` and `securityMechanismCounts` gain a key holding 0 and
`{expected: 0, matched: 0}` — no committed expectation carries the label, and a new
empty row changes no existing row's value, so they remain comparable across the
boundary. The dropped case is left dropped: reviving it is separate work, and doing
it here would confound the baseline exactly as the original deferral avoided.

### A third channel, checked once and clean

Neither gate reads the rest of the working tree, and the reviewer can reach all of
it through its read/list/grep tools. A repository whose `CHANGELOG` names the very
advisory a case is built from would hand over the answer through a path no gate
watches.

Checked on 2026-08-07 across all 25 checkouts, for each case's own GHSA and CVE
identifiers: **0 hits**. 29 of the checkouts do mention *some* advisory identifier
— changelogs of large projects invariably do — but never their own, because the
tree is pinned at the commit *before* the fix and the advisory did not exist yet.

That is a property of the orientation rather than of the curation, so it holds for
any future case captured the same way. It is worth re-checking anyway whenever a
case is captured from a repository that publishes advisories ahead of fixes.

Two operational facts from the same exercise, recorded because they are invisible
until an artifact is real:

- **Semgrep emits its entire rule catalog in `tool.driver.rules`**, so a SARIF
  file carrying 2 results was 2.2 MB. The `maxArtifactBytes` default of 4 MB is
  therefore a ceiling a routine broad scan can approach on rule metadata alone,
  not on findings.
- **CWE extraction silently produced nothing for every Semgrep alert** until it
  was fixed here. Semgrep tags a rule id-first with the weakness name after it
  (`CWE-1004: Sensitive Cookie Without 'HttpOnly' Flag`); the reader required the
  digits to end the token, matched CodeQL's `external/cwe/cwe-89` convention only,
  and normalized meticulously CWE-tagged rules to an empty list — indistinguishable
  from an analyzer that tags nothing.

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
| *Acceptance*: the evaluation reports security recall **and adjusted precision** per mechanism and context-depth | **Retired 2026-08-06.** Admitted findings are attributed by *Attributing An Admitted Finding To A Mechanism*, so the denominator exists and `securityAdjustedPrecisionByMechanism` is reported with both its halves and its attribution counters. A rate is published only when bounded; on runs where findings carry no CWE, every genuine security false positive lands in `unknown` and every rate is `null` — measured and disclosed, rather than absent or vacuously perfect. The remaining lever is findings carrying CWE, which is what shrinks `unknown`. |
| *Mechanisms*: `prompt-injection` as a measured security mechanism | **Retired 2026-08-06.** Reviewer prompt-injection resistance is not a code-defect label and cannot carry an expected finding; it is separated in *Mechanisms* and measured behaviourally. The empty-denominator row is gone rather than reported as 0%. |
| *Measurement First*: a contaminated `dev` set and a separate `held-out` set | **Narrowed 2026-08-06.** The vacuous pass is fixed: a manifest now declares what its split validation proves, the declaration is cross-checked, and a single-split corpus must state what its figures mean (see *A Corpus With One Split Must Say So*). The corpus still HAS one split, so the held-out acceptance criterion — and the pre-registered decision rule that depends on it — remains unsatisfied; what changed is that this is now declared and validated instead of silently passing. Owned by the evaluation corpus. |
| *Observability, Safety, Privacy*: the security pass is no-content, reporting "mechanism, rule id, CWE, counts" | Mechanism 2 now records rule id, CWE, analyzer identity and per-artifact counts, so the fields exist. The **security pass** still records only counts and durations: its candidates carry no mechanism label at RUN time. The eval can now attribute a finding after the fact, but that is a scoring-time join against ground truth and a CWE table, not something the pass itself emits. |
| *Mechanism 2*: measured before any promotion | Shipped and **unmeasured**, off by default. Its recall contribution has no figure anywhere. Its *precondition* was measured on 2026-08-06 (*Why Mechanism 2 Is Still Unmeasured*): changed-side attribution held perfectly on 924 real analyzer alerts and attributed zero of them, so the A/B has nothing to compare and was not run. Nothing here is evidence that the mechanism improves recall; the attribution result is evidence about the gate only. |
| *Testing*: Mechanism 2 unit tests against committed SARIF fixtures | **Closed 2026-08-07.** `fixtures/semgrep-real-run.sarif.json` is unedited Semgrep OSS 1.172.0 output — the artifact that carries the id-first CWE tag whose shape the hand-written fixtures could never have contained, since a hand-written fixture only exercises the shape its author already believed in. Two tests use it: one asserting the alert normalizes with `CWE-22` and attributes to the changed line, one asserting the same alert is held back when the change lands elsewhere in the file. The synthetic fixtures stay — they cover loss paths a single real artifact does not reach. |
