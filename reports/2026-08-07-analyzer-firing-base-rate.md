# How often does a public analyzer flag the line a real vulnerability lives on?

Measured 2026-08-07. Deterministic; no provider calls; no cost.

This answers the question spec 15 left open when it recorded *Why Mechanism 2 Is
Still Unmeasured*. That section ended with a condition:

> **What would change this** is a corpus whose changed lines an analyzer actually
> flags. […] Measuring Mechanism 2 needs cases selected *because* a public analyzer
> flags their changed lines.

Before building such a corpus it is worth knowing how large it could be. It turns
out that is the whole finding: on 132 real, publicly confirmed vulnerabilities, the
most generous freely available analyzer configuration flags the vulnerable line
**4 times**, and only **2** of those 4 alerts describe the weakness the advisory is
about.

## Headline

| | |
| --- | --- |
| advisories published after the cutoff, with a fix commit in their own repository | 401 |
| …on permissively licensed repositories | 251 |
| …structurally reviewable as a single change (see *Screening*) | **132** |
| candidates with **any** analyzer alert on a line the fix removed or modified | **4 (3.0%)** |
| …where the alert actually names the advisory's weakness | **2 (1.5%)** |

Binomial 95% confidence interval on 4/132: **0.8% – 7.6%**.

## What this does to the pre-registered decision rule

Spec 15's rule promotes Mechanism 2 to enabled-by-default only if *mean security
recall rises by ≥3 percentage points across seeds*, among other conditions.

Mechanism 2 is an ingestion layer. It can only change a review where changed-side
attribution admits an alert. On this evidence that happens for 3.0% of real
vulnerabilities. **Even if every admitted alert converted a miss into a find — which
nothing about this engine supports — the ceiling on the recall lift is 3.0
percentage points, and 1.5 for alerts that are actually informative.** The
promotion bar sits at or above the ceiling.

So the rule's outcome is unchanged, but its basis is not:

- **Keeps shipping disabled.** Previously because the measurement had not been run.
  Now because a strict upper bound on the effect has been measured and it does not
  reach the bar.
- **Not removed.** The removal criteria are about the *gate* failing. It did not
  fail; it was again never supplied with anything to pass. And the bound above is a
  property of *Semgrep OSS with public rulesets*, not of the mechanism — see
  *What this does not say*.

**No A/B was run, and none should be.** Spending three seeds per arm to resolve an
effect bounded at 4 cases would be theatre. The bound is the answer.

## Method

### Sourcing — evidence only, no inference

GitHub Security Advisory database via the public REST API, `published > 2026-01-01`
(the evaluated model's training cutoff), `type=reviewed`, across the six ecosystems
that map onto the seven languages this engine extracts signals for: npm, PyPI, Go,
Maven, RubyGems, crates.io.

A candidate had to carry at least one reference to a commit **in its own
`source_code_location` repository**. Repository license was read from the GitHub API
and had to be one of the seven permissive licenses spec 17 allows.

Nothing here is a curator's judgement about what looks vulnerable. Every case is a
vulnerability because a reviewed advisory says so.

One thing the date filter does not buy, and it is worth stating because it is easy
to assume otherwise: **an advisory published after the cutoff can describe a fix
committed long before it.** 3 of the 132 have a fix commit predating the cutoff.
They are left in this measurement — analyzer firing has nothing to do with model
training — but they are excluded from the corpus built from the same candidates,
where the temporal guarantee is about the fix and not the advisory.

### Screening — structural reviewability

The corpus orientation is spec 17's: the fix is reviewed **backwards**, so the
reviewed diff *adds* the vulnerable code and the analyzer scans the parent tree.
Changed-side attribution matches an alert against a new-side changed line. A fix
therefore only produces an attributable alert if it **deleted or modified** the
vulnerable line.

| rejected | n |
| --- | --- |
| more than one fix commit referenced (the change is not one reviewable unit) | 52 |
| fix only ADDS lines — no parent-side line changes, so no alert can ever attribute | 33 |
| fix touches 9–34 source files — too broad to review as one change | 12 |
| no supported source file outside tests/docs/vendor | 9 |
| merge or root commit | 6 |
| reference is an abbreviated object name | 1 |

The 33 add-only fixes matter beyond bookkeeping: they are real vulnerabilities on
which analyzer ingestion **cannot** help by construction, whatever the analyzer
finds. Excluding them makes the 3.0% an over-estimate of the mechanism's reach, not
an under-estimate.

### The analyzer — configured against the mechanism, not for it

Semgrep OSS **1.172.0** (LGPL-2.1), the same version spec 15 records, with twelve
public rulesets chosen independently of the corpus:

    p/default  p/security-audit  p/owasp-top-ten  p/secrets
    p/python  p/javascript  p/typescript  p/golang  p/java  p/ruby  p/rust
    p/trailofbits

**`p/security-audit` alone is not a fair test of the premise, and the first pass of
this measurement was wrong because it used only that.** On a control file of ten
blatant sinks written for the purpose, `p/security-audit` fired on four, missing
path traversal, SSRF, reflected XSS and weak-hash entirely, and produced **0/132**.
The union above fires on all ten of the control sinks and produces 4/132. The
reported number is the union's.

Each candidate's changed source files were fetched at the **parent** commit — the
vulnerable revision — and scanned. 145 results over 132 candidate trees.

### Selection did not touch the analyzer

The corpus selection that follows this measurement is made on ground truth only:
CWE class, language, fix size, severity. Whether Semgrep fires plays no part. Had
selection been steered by analyzer output, the corpus's security recall would have
become a statement about Semgrep rather than about the reviewer.

## The four hits, adjudicated

Whether an alert is *informative* is a judgement, so it is shown rather than
asserted.

| advisory | repo | alert | verdict |
| --- | --- | --- | --- |
| GHSA-45pq-889g-fcgh (CWE-22) | rclone/rclone | `filepath-clean-misuse` on `restic.go:248` — "`Clean` is not intended to sanitize against path traversal attacks" | **on point.** The advisory is incomplete path validation allowing backend root escape. The alert names the exact misuse on the exact line. |
| GHSA-97jw-64cj-jc58 (CWE-79) | ViewComponent/view_component | `avoid-html-safe` on `collection.rb:14-16` | **on point.** The parent's `.join(…).html_safe` on line 16 is precisely what the fix replaced with `safe_join`, and the alert's message describes the escaping bypass the advisory is about. |
| GHSA-jp94-3292-c3xv (CWE-601) | heartcombo/devise | `check-http-verb-confusion` spanning `failure_app.rb:139-142` | **coincidental.** The advisory is an open redirect via unvalidated `request.referrer`. The alert is about `HEAD` being routed as `GET`. Different weakness; it merely spans the changed line. |
| GHSA-r9hw-mj3w-phcq (CWE-281/459/732) | uutils/coreutils | `unsafe-usage` spanning `mknod.rs:67-117` | **coincidental and non-informative.** "Detected 'unsafe' usage, please audit" over a 50-line span that happens to contain line 97. It says nothing about SELinux labelling or the broken cleanup the advisory describes. |

Both coincidental alerts share a shape worth recording: they are **wide-span** alerts
that contain a changed line rather than sit on one. Changed-side attribution admits
them correctly by its own contract — a flow step or location on a changed line — but
their information content about the change is nil.

## What this does not say

- **It is not a statement about analyzers in general.** It measures Semgrep OSS with
  public rulesets. CodeQL's data-flow analysis, commercial Semgrep rules, and
  language-specific commercial scanners have materially different recall, and an
  operator who already runs one may see a firing rate far above 3%. That is exactly
  why the mechanism stays available rather than being removed.
- **It is not a claim that these vulnerabilities are undetectable.** Several are
  detectable by an analyzer *somewhere in the file or the flow*; the measurement is
  narrower and deliberately so — whether the alert lands where changed-side
  attribution can admit it.
- **It is not a measure of this engine's security recall.** That is measured
  separately, on the corpus built from these same 132 candidates.
- **The 3.0% is an upper bound on reach, not on usefulness.** Two informative alerts
  out of 132 is the number to carry forward; 4/132 is what the gate admits.

## Reproducing it

The measurement is deterministic given the same advisory snapshot and Semgrep
version. Its three stages — advisory harvest, commit screening, analyzer probe —
are scripts run once against public APIs, and every input is a public artefact
identified in this report by object name. Nothing about it depends on this engine's
output, which is the property that makes it usable as ground truth at all.
