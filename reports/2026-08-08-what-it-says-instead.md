# What the reviewer says instead

Derived 2026-08-08 from the ten control runs of the sub-file A/B, already paid for.
**No provider call.** 259 missed expectation-observations, 70-case corpus,
`openai/gpt-5.3-codex`, engine `359161b`.

Every attention lever is closed, so this asks the question a ranking hypothesis has to
start from: when the reviewer misses the advisory's defect, what does it report
*instead*?

## The distribution

| | count | share |
| --- | --- | --- |
| spoke only in OTHER files | 73 | 28.2% |
| **real but NON-SECURITY defect, same file** | **49** | **18.9%** |
| duplicate / inconclusive, same file | 44 | 17.0% |
| discovery spoke, nothing survived the pipeline | 43 | 16.6% |
| discovery returned nothing at all | 40 | 15.4% |
| a genuine false positive, same file | 6 | 2.3% |
| **a competing real SECURITY defect, same file** | **4** | **1.5%** |

Of the 103 misses where the reviewer said something in the right file, **61 were
INSIDE the missed expectation's own line range.**

And what it said there:

| category of the nearest finding | count |
| --- | --- |
| **bug** | **78** |
| security | 15 |
| performance | 10 |

## The finding

**The reviewer reads the right lines, sees something real, and describes it as a
correctness bug rather than as a security defect.**

It is not looking elsewhere and not staying silent. On 61 observations it produced a
finding *inside the exact range* of the security defect it was scored as missing, and
five times out of six that finding was categorised `bug`, not `security`:

| the advisory's defect | what the reviewer said at the same lines |
| --- | --- |
| HMAC accepts an empty signing key (cryptography) | "OpenSSL error translation depends on exact message text" |
| CORS preflight header-split ReDoS (concurrency-resource) | "Requested headers parsing can emit empty header names" |
| IPv4 parse accepts leading-zero octets (ssrf) | "Global IPv4 regex causes stateful validation failures on repeated calls" |
| import extension injected into generated imports (injection) | "Invalid `x-python-import` values are silently ignored instead of rejected" |

In each, the reviewer has the vulnerable line under its eye and reports a *neighbouring
correctness property* of the same code. The security consequence — an attacker-supplied
empty key, a crafted header list, an octal-looking octet — is the part that goes
unsaid.

**Only 1.5% of misses are a competing security defect.** So this is not the reviewer
exercising security judgement and choosing differently. It is the reviewer not
applying security framing to code it is actively reading.

That is a different failure from every one measured so far:

- not **retrieval** — the file is open,
- not **attention** — the finding is on the defect's own lines,
- not **volume** — it produced a finding there,
- not **matcher strictness** — these are different defects, correctly not matched.

## A second thread, smaller and separate

**16.6% of misses are case-runs where discovery produced raw findings and nothing
reached any output bucket** (43 of 700 case-runs, 6.1%). That is a larger pipeline
loss than the 1.6% raw→candidate figure measured earlier, which counted a different
step. Worth a look on its own; it is not what this report is about.

## Prior art, before anyone proposes the obvious fix

The obvious intervention — tell the reviewer to ask "is this also a security defect?"
— is close to two things already measured, and by this project's own rule a new
proposal must say how it differs:

- **the in-prompt security checklist lens** — NOT a net win: it traded `authorization`
  41% → 27% for gains elsewhere, and was replaced;
- **the dedicated additive security pass** — overall recall up, but the security-specific
  lift is UNPROVEN at n=1 and it costs +61%. Off by default.

What this diagnosis adds that neither had: the failure is **localised to lines the
reviewer already reports on**. Both prior interventions asked for *more security
attention across the change*; neither asked for a *second interpretation of a finding
already being written*. Whether that distinction survives measurement is unknown, and
nothing here is evidence that it will.

## Three measurement traps hit while producing this, all corrected

Recorded because the same trap has now cost four separate figures in this project.

1. **Incomplete bucket sum.** The first pass omitted the `artifactOnly*` and
   `inconclusive*` buckets and reported silence at **68.7%**. Cross-checking against
   discovery's own `rawFindingCount` showed 43 of 700 case-runs disagreeing. True
   silence is **15.4%**.
2. **Overlapping buckets.** `unlistedRealFindingIds` is a **subset** of
   `falsePositiveFindingIds` — verified, 15 of 15 cases. Classifying by which array a
   finding appears in labelled real findings as false positives, and made "a non-real
   finding, same file" the largest category at 39.8%. It does not exist. Classify by
   **ID-set membership**, never by bucket.
3. **Duplicate pool entries.** The same finding appears in several buckets, so a
   "nearest finding" search double-counted it. The pool is now deduped by `findingId`.

The published numbers above are the third version. The first two were wrong in ways
that would have supported confident, false conclusions — "the reviewer is mostly
silent" and "the reviewer mostly emits noise" are both refuted by the corrected data.
