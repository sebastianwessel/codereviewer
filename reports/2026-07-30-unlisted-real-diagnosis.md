# Unlisted-Real Findings: Diagnosis

Date: 2026-07-30
Corpus: `.codereviewer/eval/corpus-slices/real-repo-cross-file` (37 cases, 87 expectations)
Runs analysed (all offline, no provider spend):

| Arm | Run directory | Recall | Unlisted real | Genuine FP | Duplicates |
| --- | --- | ---: | ---: | ---: | ---: |
| arm0 | `runs/20260730T084730-70cd071d-...` | 46.0% (40/87) | 4 | 2 | 7 |
| armA | `runs/20260730T085252-0c80df10-...` | 48.3% (42/87) | 11 | 3 | 15 |
| armB | `runs/20260730T085917-10dc9ff1-...` | 44.8% (39/87) | 14 | 4 | 8 |

**Headline result: zero of the 16 distinct unlisted-real findings is a genuine
defect the answer key fails to describe. 46.0% is not a floor of unknown
tightness with respect to this evidence — the "unlisted real" counter is
measuring matcher granularity, not key incompleteness.**

## 1. Method and its limits

Extraction: `caseResults[].unlistedRealFindings` from the three
`eval-report.json` artifacts, deduplicated on (case, path, line, claim). 29 raw
rows collapse to **16 distinct findings**.

Classification: read the slice source at
`.codereviewer/eval/corpus-slices/real-repo-cross-file/<case>/repo/`, the case's
`slice.json` (expectations + the reviewed diff), and the corpus manifest
`eval/corpora/real-repo-cross-file/manifest.json`. Finding text was not trusted;
the judge verdict was not trusted.

Two limits, stated up front:

- **Only finding titles are persisted.** `eval-report.json` stores
  `{findingId, severity, category, path, line, title}` — no body, no evidence,
  no judge rationale. I classified against title + path + line + the code at
  that line. Where a title is ambiguous I say so below.
- **I am one classifier.** No second reader. Confidence is stated per item.

## 2. Corpus construction (decides section 4 before we start)

Every case in this corpus has `"source": "upstream-fix-commit"`. The manifest
records `fixCommit` and `parentCommit`; the hydrated repo is the **parent**
(pre-fix, defective) tree, and `slice.json.diff` is **the upstream fix commit
read backwards**. `eval/corpora/real-repo-cross-file/manifest.json`, dataset
description:

> Real upstream repositories hydrated as FULL working trees at the commit before
> an upstream fix landed

Consequence: the upstream fix's entire content is already inside the slice. The
question "did the upstream fix address something our extraction missed?" is
answerable exactly, offline, by comparing each diff hunk against the case's
expectations. No network, no guessing.

## 3. Inventory and classification

| # | Case | Path:line | Claim | Sev | Arms | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | aspnetcore-tempdata | `TempData.cs:178` | Enumerator bypasses lazy load | high | 0 | restatement |
| 2 | aspnetcore-url-normalizer | `UrlNormalizer.cs:12` | Null input now throws | med | B | judge-error |
| 3 | fastify-router-options | `lib/route.js:617` | Falsy `routerOptions` misread as absent | med | A,B | restatement |
| 4 | gin-context-copy | `context.go:122` | `Copy` drops `Errors`/`Accepted` | med | A,B | restatement |
| 5 | ktor-rate-limit-phase | `RateLimitInterceptors.kt:18` | New phase per install ⇒ duplicate execution | high | B | judge-error |
| 6 | laravel-eloquent-dictionary | `MorphTo.php:117` | Null FKs enter dictionary | high/med | 0,A,B | out-of-scope (deliberate) |
| 7 | pydantic-dataclass-field-flags | `_signature.py:70` | Factory fields misclassified required | high | B | restatement |
| 8 | slim-html-error-page | `HtmlErrorRenderer.php:57` (`:59` in arm0) | Title not escaped | high | 0,A,B | restatement |
| 9 | traefik-endpointslice | `crd/kubernetes_http.go:593` | Nil deref on `*p.Port` | high | A,B | restatement |
| 10 | traefik-endpointslice | `crd/kubernetes_tcp.go:270` | Nil deref on `*p.Port` | high | A,B | restatement |
| 11 | traefik-endpointslice | `crd/kubernetes_udp.go:184` | Nil deref on `*p.Port` | high | A,B | restatement |
| 12 | traefik-endpointslice | `gateway/kubernetes.go:960` | Nil deref on `*p.Port` | high | A,B | restatement |
| 13 | traefik-endpointslice | `ingress-nginx/kubernetes.go:636` | Nil deref on `*p.Port` | high | B | restatement |
| 14 | traefik-endpointslice | `ingress/kubernetes.go:683` | Nil deref on `*p.Port` | high | A,B | restatement |
| 15 | vite-null-byte-escape | `shared/utils.ts:22` | `unwrapId` restores only first | high | A,B | restatement |
| 16 | ws-close-frame | `lib/sender.js:204` | `close()` no longer type-checks payload | med | 0,A | restatement |

**Counts: genuine-unlisted-defect 0 · restatement 13 · judge-error 2 ·
out-of-scope 1 · unclassifiable 0.**

### 3.1 Restatements (13)

**#9–14 traefik — the "second pointer" of a two-pointer expectation.**
`repo/pkg/provider/kubernetes/crd/kubernetes_http.go:592-593`:

```go
592	if svcPort.Name == *p.Name {
593		port = *p.Port
```

Expectation 0 has `lineRange [591,596]` and names both fields: *"Both fields of
discoveryv1.EndpointPort are optional pointers: Name is nil for an unnamed port
and Port is nil when the slice targets all ports."* The engine emitted two
findings per file — one at 592 (`*p.Name`), one at 593 (`*p.Port`). One-to-one
matching consumed the expectation with the `:592` finding and ejected the `:593`
finding, which the plausibility judge then credited. Identical structure in all
six files. **Decisive corroboration:** arm0 classified all six `:593` findings as
`duplicateFindings`, not as false positives — so the same text is a duplicate in
one arm and an "unlisted real finding" in another. That is a matcher artifact,
not a key gap.

**#8 slim.** Expectation 0 says *"The title reaches both the document title and
the heading, and the description reaches the paragraph rendered when error
details are disabled."* Both sinks in one expectation. The diff removes
`htmlspecialchars` twice — at the description
(`HtmlErrorRenderer.php:32`, `$html = "<p>{$this->getErrorDescription($exception)}</p>"`)
and at the title (`HtmlErrorRenderer.php:57`, `renderHtmlBody`, where the
`$title = htmlspecialchars(...)` line was deleted). All three arms matched the
`:32` description finding to expectation 0 and ejected the `:57`/`:59` title
finding. Same split. *Hygiene note:* expectation 0's `lineRange` is `[25,36]`,
which does not reach line 57 even though its own summary claims the title sink.
Harmless for `path-semantic` matching, misleading for anyone reading the key.

**#15 vite.** Expectation 0's `lineRange` is `[11,24]`, and
`repo/packages/vite/src/shared/utils.ts` puts `wrapId` at 11-15 and `unwrapId` at
20-24 — the unwrapId finding at line 22 is *inside the expectation's own line
range*, and the summary names it: *"and unwrapId restores only the first
placeholder"*. Matched the `:14` wrapId half, ejected the `:22` unwrapId half.
arm0 classified the leftover as a duplicate; armA/armB called it unlisted-real.

**#3 fastify, #4 gin, #7 pydantic — proven restatements by cross-arm collision.**
These three are the cleanest evidence available, because the *same path and line*
was matched to an expectation in one arm and counted unlisted-real in another:

- `lib/route.js:617` (`const routerOptions = options.routerOptions || Object.create(null)`)
  matched expectation 0 in arm0; unlisted-real in armA and armB. armA's own title
  ("...and mutate wrong object") restates the expectation verbatim. The added
  "falsy values" claim describes no behaviour change: the base expression
  `Object.assign(Object.create(null), 0 | '' | false)` also yields an empty
  null-prototype object.
- `context.go:122` matched expectation 0 in arm0; unlisted-real in armA/armB.
  armA's title — *"Context.Copy no longer copies Errors and Accepted"* — is
  expectation 0 word for word.
- `_signature.py:70` matched expectation 1 in armA; unlisted-real in armB at the
  identical line. *Caveat, and my one real reservation about the judge:* armB's
  title states the mechanism backwards. `pydantic/fields.py:249` is
  `self.default_factory = kwargs.pop('default_factory', None)`, so unset is
  `None`, never `PydanticUndefined`; the branch at `_signature.py:71`
  (`default = Signature.empty`) is dead and *every* field gets
  `_HAS_DEFAULT_FACTORY`. armB claims factory fields are misclassified as
  *required* — the opposite direction. Right site, inverted causality, credited
  as real. Classified restatement (same defect, same line, matched elsewhere),
  but this one is arguably also a judge-error.

**#1 aspnetcore-tempdata.** Line 178 is
`_innerEnumerator = tempData._data.GetEnumerator();`. Expectation 2's summary
ends: *"The enumerator constructor reads the same backing field, so enumerating
the store before any load likewise yields no entries."* The manifest note makes
the fold explicit:

> (b) Keep and the enumerator read the private backing field instead of the
> loading property - a different fault, folded into one expectation.

All three arms matched expectation 2 via the `Keep()` finding at line 63; the
enumerator half was ejected. Deliberate one-expectation-two-sites design.

**#16 ws.** The diff deletes the `isUint8Array(data)` guard *and* its
`TypeError`, leaving `lib/sender.js:203-205` as a bare `else { buf.set(data, 2) }`.
That deleted guard is the whole mechanism of expectation 0 — under the base code
a `Uint16Array` was rejected, so it could never reach the size/copy mismatch that
leaks uninitialised bytes. `lib/websocket.js:296` → `:316` forwards caller data
into `Sender#close` unchecked, confirming reachability. The finding names the
correct removed guard but stops at the error-type consequence instead of the
leak, which is why the semantic matcher rejected it. **Confidence: medium.** One
can read the removal of input validation as a thin defect in its own right; I do
not, because there is no second defect here — only a weaker description of the
one the key already lists.

### 3.2 Judge errors (2)

**#2 aspnetcore-url-normalizer, `UrlNormalizer.cs:12` — "null input now throws".**
The diff replaced `if (string.IsNullOrEmpty(url)) return url;` with
`if (url.Length < 2 || ...)`. The empty-string path is unchanged
(`"".Length < 2` → returns unmodified). The null path would throw, but is
unreachable: `CollapseLeadingSlashes` is `internal static` with exactly three
call sites, all null-safe —
`UrlActions/RedirectAction.cs:46` (guarded by an
`if (string.IsNullOrEmpty(pattern)) { ...; return; }` at :40-44),
`UrlActions/RewriteAction.cs:65` (preceded by `pattern = "/"` on empty at
:50-53), and `RedirectRule.cs:46` (`initMatchResults.Result(...)`, which never
returns null). No reachable defect. **Confidence: high** for the call-site
analysis; the residual risk is a test assembly reaching it via
`InternalsVisibleTo`, which would not be a product defect.
Note arm0 classified this same finding as *artifact-only* rather than
unlisted-real — another cross-arm inconsistency.

**#5 ktor, `RateLimitInterceptors.kt:18` — "new phase per install ⇒ duplicate
interceptor execution".** `BeforeCall.install` does construct a fresh
`PipelinePhase("BeforeCall")` per call, and `PipelinePhase`
(`ktor-utils/common/src/io/ktor/util/pipeline/PipelinePhase.kt:15`) has no
`equals` override, so two would be distinct. But no pipeline receives two
installs: `Routing.kt:24-33` calls `createChild(...)` and installs
`RateLimitInterceptors` once on that *new* child route's pipeline, and
`RateLimit.kt:49` installs `RateLimitApplicationInterceptors` once on the
application. The premise is not realisable in-tree. **Confidence: medium** — I
did not exhaustively trace Ktor's plugin-install re-entrancy machinery.
Worth noting: this finding sits inside expectation 0's own line range `[16,22]`
but asserts a different, non-existent mechanism — a near-miss on a case all
three arms missed.

### 3.3 Out of scope by explicit corpus design (1)

**#6 laravel, `MorphTo.php:117`.** The defect is real. The diff deletes
`if ($morphTypeKey === null || $foreignKeyKey === null) { continue; }` from
`buildDictionary`, so `$this->dictionary[$morphTypeKey][null][...]` coerces to the
`''` offset, and `matchToMorphParents` (`MorphTo.php:227`, now
`isset($this->dictionary[$type][$ownerKey])` with the null guard stripped) will
attach an unrelated model to every parent with a null foreign key. This is the
same shape as expectation 1 (BelongsTo), in a different relation class.

It is nonetheless **not a key gap**. The manifest note for the case:

> The same coercion recurs in BelongsToMany, HasOneOrMany and MorphTo
> buildDictionary; those are deliberately left unlisted because they are
> consequences of the trait defect that is listed.

The author excluded these on purpose, as downstream consequences of expectation 0
(`InteractsWithDictionary::getDictionaryKey`). Only a human can reverse that
decision; see section 5.

## 4. Quantified distortion

**Genuine-unlisted count: 0. The true recall denominator is 87 — unchanged.
46.0% understates by 0.0 percentage points on this evidence.**

The distortion is real but runs the other way, and lands on precision, not
recall. Of the 6/14/18 findings the matcher declared false positives in
arm0/armA/armB, 4/11/14 were credited as real — and 13 of the 16 distinct ones
are the engine restating a defect the key already lists. `adjustedPrecision`
(95.2% / 93.3% / 90.7%) is therefore doing the right thing for the wrong reason:
it is correcting for a *matcher* failure to absorb near-duplicate findings, not
for key incompleteness. The metric name "unlisted real findings" asserts a claim
about the key that the data does not support.

The arm ranking is contaminated by the same artifact. armB "found more unlisted
real defects" (14 vs 4) while scoring *lower* recall (44.8% vs 46.0%) — it did
not discover more; it split defects into more findings and absorbed fewer of them
as duplicates. Duplicate-vs-false-positive assignment is itself unstable across
arms on byte-identical defects (traefik `:593` ×6: duplicates in arm0, unlisted
in armA/armB).

Uncertainty, honestly stated:

- Single classifier, no adjudication.
- Titles only, no finding bodies — #16 (ws) and #7 (pydantic) are the two whose
  verdicts could plausibly move with the full text.
- #5 (ktor) rests on my reading of Ktor's install paths, not on a test.
- If a second reader promoted **both** #16 and #6 to genuine-unlisted, the
  denominator would rise to 89 and arm0 recall would fall to 40/89 = 44.9%.
  Still not an understatement.

## 5. The legitimate remedy, and its limits

Because every slice diff *is* the upstream fix commit inverted, upstream coverage
is checkable exactly. Diff hunk vs. expectation, for all 11 affected cases:

| Case | Fix-commit hunks | Covered by expectations | Uncovered |
| --- | ---: | ---: | ---: |
| aspnetcore-tempdata | 4 (Get, Keep, Remove, enumerator) | 4 (enumerator folded into #2 per manifest) | 0 |
| aspnetcore-url-normalizer | 1 (method rewrite) | 1 | 0 |
| fastify-router-options | 1 | 1 | 0 |
| gin-context-copy | 1 | 1 | 0 |
| ktor-rate-limit-phase | 1 (+ copyright line) | 1 | 0 |
| laravel-eloquent-dictionary | 6 files | 3 | **3 (deliberate)** |
| pydantic-dataclass-field-flags | 2 | 2 | 0 |
| slim-html-error-page | 2 (description, title) | both, in one expectation | 0 |
| traefik-endpointslice | 6 files | 6 | 0 |
| vite-null-byte-escape | 3 | 3, in two expectations | 0 |
| ws-close-frame | 1 | 1 | 0 |

**Upstream-evidenced and addable: 3 expectations, all in one case
(laravel-eloquent-dictionary). Visible only through our own output: 0.**

Proposed additions — **not made; for human approval**, because the exclusion was
a documented editorial choice, not an oversight:

1. `src/Illuminate/Database/Eloquent/Relations/MorphTo.php`, `buildDictionary`
   (~lines 112-121). Upstream evidence: the fix commit re-adds
   `if ($morphTypeKey === null || $foreignKeyKey === null) { continue; }`.
2. `src/Illuminate/Database/Eloquent/Relations/HasOneOrMany.php`,
   `buildDictionary` (~lines 204-210). Upstream evidence: the fix commit re-adds
   `if ($pairKey === null) { continue; }`.
3. `src/Illuminate/Database/Eloquent/Relations/BelongsToMany.php`,
   `buildDictionary` and `match` (~lines 285-315). Upstream evidence: the fix
   commit re-adds `if ($value === null) { continue; }` and restores the
   `$key !== null &&` conjunct.

Manifest evidence for all three: `eval/corpora/real-repo-cross-file/manifest.json`,
case `laravel-eloquent-dictionary-key-not-normalized`, `notes`.

**Adding them lowers recall.** The engine found only #1 (MorphTo), in all three
arms; #2 and #3 were found by nobody:

| Arm | Now | With +3 |
| --- | ---: | ---: |
| arm0 | 40/87 = 46.0% | 41/90 = 45.6% |
| armA | 42/87 = 48.3% | 43/90 = 47.8% |
| armB | 39/87 = 44.8% | 40/90 = 44.4% |

That is the correct sign for a key that had been slightly *generous*, and it is
the opposite of the "recall is a floor" hypothesis. My recommendation is to leave
the exclusion in place — the note's reasoning (downstream consequences of the
listed trait defect) is sound, and one engine finding one of the three sites is
not a reason to change it.

## 6. Can the key be fixed at all?

**Yes — and it barely needs fixing. The premise of the question does not hold for
this corpus.**

The worry was that most genuine-unlisted defects would be visible only through
our own output, making the key unpatchable without self-grading. The measurement
says the opposite: there are no genuine-unlisted defects at all. Every expectable
defect in these 11 cases is already listed, and the corpus's construction —
hydrate the pre-fix parent, embed the fix commit inverted — means the independent
source is *permanently attached to every case*. Upstream coverage is auditable
offline, forever, with no engine output involved. This corpus is structurally
resistant to the self-fulfilling-recall failure mode. That is a design strength
worth keeping in any successor corpus.

A differently-sourced corpus is **not** the honest fix here, because the key is
not the thing that is broken.

What is broken is the **metric**, in three specific ways, none of which touch any
fixture:

1. **One-to-one matching ejects the second half of a split defect.** When the
   engine reports one defect as two findings (`*p.Name` / `*p.Port`, wrapId /
   unwrapId, title / description), the expectation is consumed by the first and
   the second becomes a false positive. This produced 13 of 16.
2. **Duplicate detection is unstable.** Byte-equivalent leftovers land in
   `duplicateFindings` in one arm and `falsePositiveFindings` in another —
   traefik `:593` ×6 and vite `:22` are the clean examples. Duplicate collapse
   should run against *matched* findings, not only among unmatched ones.
3. **The metric is misnamed and mis-ranks arms.** "Unlisted real findings"
   asserts key incompleteness; it measures finding fragmentation. Because
   fragmentation raises it, it rewards arms that split defects — armB leads on it
   while trailing on recall.

Concrete next step, in priority order: (a) make the plausibility judge compare an
ejected finding against the case's *already-matched* findings before crediting it
as unlisted, which would have absorbed all 13 restatements; (b) rename the metric
to something like "unmatched-but-plausible findings" until (a) lands;
(c) fix `slim` expectation 0's `lineRange` to reach the title sink at line 57.

## Artifact limitation worth fixing separately

`eval-report.json` persists only `{findingId, severity, category, path, line,
title}` per finding. Any future diagnosis of *why* a finding was or was not
matched has to re-derive the claim from a one-line title. Persisting the finding
body and the plausibility judge's rationale would have made this analysis
mechanical instead of interpretive — and would have settled #7 and #16 outright.

## Compliance

No corpus fixture, expectation file, manifest, or `src/` file was modified. No
expectation was proposed on the basis of engine output alone: the three proposals
in section 5 rest on the upstream fix commit
(`a03cd3c385d67314fbd663005590ea9eb2381302`) re-adding the exact guards, and two
of the three were found by no arm. No provider calls were made.
