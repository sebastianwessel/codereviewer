# Proposed spec change: un-anchored discovery pass

Date: 2026-07-27
Status: **PROPOSAL — awaiting human approval.** Nothing written to `specs/`.

Target: a new spec `specs/19-unanchored-discovery-pass.md`, with a pointer from
spec 05's Holistic Discovery section. Mirrors spec 15's dedicated security pass
in shape: additive, bounded, **off by default until measured**.

---

## 1. What the measurement says

From the capability test (`2026-07-27-enumeration-gap-and-improvement-plan.md`
§5.2), production model and prompt, mechanically derived windows:

- **Only 16 of 76 candidates (21%) from the diff-bearing arm pointed at a line
  inside the window they were shown.** All 31 casbin windows returned one finding
  at L820 — including the window covering L1201–1251, where L820 is not in the
  packet.
- The un-anchored arm put **50 of 50 candidates inside their own window**.
- `slim`, one 84-line file, same model, prompt and temperature: production finds
  idx0 7/9 and idx1 0/9; windowed **with** the diff, 2/2 and 0/2; windowed
  **without** it, 0/2 and 2/2.

**The engine answers the diff and does not read the rest of the file.** Shrinking
the file section changes nothing, because the file section was never the binding
constraint. What must be removed is the anchor.

The un-anchored arm also **lost 6 of 7 controls**. Without a diff it has no
reason to prioritise the changed line, and it is therefore not a reviewer. It is
a candidate generator, and it must feed the existing gate rather than replace
anything.

---

## 2. Proposed design

> ### Un-Anchored Discovery Pass
>
> The primary discovery call is anchored to the diff. That anchor is what makes
> it precise, and it is also why it reports at most one defect per changed
> region: measurements show its candidates overwhelmingly land on the changed
> line even when the file section it was given does not contain that line.
>
> An OPTIONAL additional pass therefore reviews a file as bounded units **with
> the diff withheld**, so the reviewer has no changed line to answer and must
> read what it is given. Its candidates are merged into the primary pass's
> candidates through the Semantic Finding Merge, and every candidate then passes
> through refutation and admission unchanged.
>
> Requirements:
>
> - The pass is **additive**. It MUST NOT displace, reorder, or suppress a
>   candidate from the diff-anchored pass.
> - Units MUST be derived **mechanically from the file alone** — a rule
>   expressible without reference to any expected finding, applied identically to
>   every file in every language. Unit size and overlap are configuration, not
>   per-language tuning.
> - The pass MUST be bounded: a maximum number of units per file and per run,
>   configured, with the bound recorded in the run so truncation is never silent.
> - The pass MUST use the same generic, language-neutral discovery instructions
>   as the primary pass. It differs in **what it is shown**, never in what it is
>   asked.
> - Failure of the pass is recoverable and non-fatal. A review without it is a
>   complete review.
> - It is **disabled by default** until a measurement on the real-repository
>   corpus shows it earns its cost.

Configuration mirrors `security.dedicatedPass`.

---

## 3. Why the shape is this and not something simpler

**Why not just widen the primary pass's window?** That was Arm A. It recovered
almost nothing at N× the cost, because the diff kept pulling every unit's answer
back to the same line. The variable is the anchor, not the unit size.

**Why not drop the diff from the primary pass?** The un-anchored arm lost 6 of 7
controls. The diff anchor is what makes the primary pass reliably find the defect
the change actually introduced — which is the reviewer's main job. Removing it
would trade our strongest behaviour for a speculative one.

**Why off by default?** Precedent and honesty. The dedicated security pass shipped
off by default because its measured lift was unproven at n=1, and the two
structural passes before it were removed after failing to beat baseline. This one
recovered 2 of 7 targeted misses in a single experiment. That is a real signal
and it is not yet a result.

---

## 4. Expected cost, stated before spending

The experiment cost ~$0.008 per unit. At 60-line units with 40-line stride, a
600-line file is ~15 units. **Unbounded, this is by far the most expensive thing
we have proposed** — plausibly several times the current ~$1.35–1.75 per run.

The bound is therefore load-bearing, not hygiene. Sensible starting policy: cap
units per file, and skip files the primary pass already covers densely.

---

## 5. The caveat that should temper expectations

Measured today across the 36-case corpus: **median 7 changed lines per case,
median 2 hunks, 17 of 36 single-hunk.** The corpus is built from upstream fix
commits, which are minimal by nature. Real pull requests are larger.

A tiny diff is where the anchor pulls hardest and therefore where an un-anchored
pass has the most to add. **This corpus is close to the best case for this
change.** It is a good screening instrument — if the pass does not help here it
will not help anywhere — but a poor estimator of real-world gain, and the number
it produces should not be quoted as the expected production improvement.

---

## 6. Measurement plan, fixed in advance

Arms: default config vs pass enabled, **3 seeds each**, real-repo corpus.
Estimated **$9–15** total depending on the unit bound.

Decision rule, committed before the run:

- **Ship enabled** only if recall rises with the paired finding-level test
  (`eval-significance.ts`) clearing significance, *and* `adjustedPrecision` and
  `genuineFalsePositiveCount` do not degrade, *and* cost per additional matched
  expectation is defensible.
- **Ship disabled but keep** if recall rises without significance at n=3.
- **Remove entirely** if recall does not rise. Two structural passes have already
  been built and removed on this rule; that is the rule working.

Also required, per §5.1 of the plan: **refutation's kill rate must rise.** It sits
at 1.4% today. A pass that adds speculative candidates and does not move that
number means the gate is not filtering them, and precision will fall instead.

---

## 7. Open question for the approver

Unit size and stride. The experiment used 60/40 chosen on budget grounds, not
because it is right. Sovrano et al. report the safe input size is
defect-class-dependent (~500 chars for some classes, ~6,500 for others), which
argues no single size is optimal — but a per-class size would require knowing the
class before looking, which we do not.

I propose 60/40 as the configured default purely because it is the only size we
have measured, and flagging that it is arbitrary rather than justified.
