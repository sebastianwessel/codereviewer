# Invariant-Conformance Review (Removed)

`conformance check` was a **separate command that reported where a changed
declaration did not hold a pattern a majority of its siblings hold** — *"thirteen
of fifteen call `requireAuth`; this one does not"* — with the peers cited by path
and line, as a divergence rather than a defect. It was **removed** on 2026-08-02:
code, command, configuration key, and its stage in the GitHub integration.

There is nothing to configure here. `invariantConformance` was deleted from the
configuration schema, which is strict: a config file that still sets it — even to
`{ "enabled": false }` — now fails validation with exit code `2`. Remove the
block.

This page is the record of what it was and why it went.

## It failed the kill criterion it wrote for itself

The spec fixed the rule before any run: *more than roughly one report per two
benign pull requests and the capability is unviable at any cost, and is removed
rather than tuned.* That step-1 measurement had never actually been run. It was
run on 2026-08-02.

| measurement | result | rule |
| --- | ---: | --- |
| firing rate, PR-sized ranges | **7.0 reports / range** | ≈0.5 — missed by **14x** |
| true positives, n≈300 hand-judged divergences, five codebases | **0** | — |

Zero true positives across roughly 300 hand-judged divergences from five
codebases — three independent censuses, a 64,201-declaration population
diagnostic, and a stratified adjudication sample of 165. Not a weak signal: no
signal.

## The adjudicator passed its gate and that made it worse

Model adjudication existed to reject resemblance that is not convention, and it
had a pre-registered rule of its own: reject at least 95% of divergences. It
rejected **97.5%**, so it passed.

Every one of the four divergences it **accepted** was a false positive, two of
them schema-constructor idioms accepted with a confident role-level rationale.
*It accepted exactly the noise it existed to reject.* The rule it passed was
measuring its silence, not its judgement.

## "It fires rarely" was never a defence

Reader precision here is **0%**, not 100% of a small number. A capability that
fires rarely and is wrong every time costs a reviewer strictly more than one that
does not exist: every report is a real interruption spent on nothing, and the
rarity only means the reader never builds the habit of dismissing it.

Two root fixes landed the same day and cut the divergence population 1,099 → 647
and the firing rate substantially. They improved it; they did not make it correct.
The reports that remained were still all false, and the spec forbids tuning past
its own kill criterion — with no true positive anywhere in the measurement, there
was nothing for tuning to preserve.

## What this does not establish

**This is not evidence that a codebase's own conventions cannot be a
specification.** What is established is narrower: this peer-set construction, on
these five codebases, found no case where a shared shape among siblings was also
an obligation on the odd one out.

Recorded as a hypothesis and explicitly not as a result: the failure looks
structural rather than parametric. A peer set's shared shape is a fact about
*similarity*, and nothing measured here turned similarity into a fact about
*obligation*. Nothing shows a different derivation would do better; nothing shows
it would not.

Earlier versions of this page reported a firing rate of **0.000 divergences per
commit** over 20 commits of this repository, with the open question named as
recall rather than noise. That reading is withdrawn: measured properly, over
PR-sized ranges on other people's code, the rate is 7.0 and the question was
never recall.

## Related

- [Context scout (removed)](context-scout.md) — the removal *without* a failed
  measurement behind it, and why a void measurement is not a failed one
- [Extra discovery passes (removed)](extra-discovery-passes.md) — three further
  removals, each on a rule fixed in advance
- [Optional capabilities](README.md) — what actually ships as a switch
