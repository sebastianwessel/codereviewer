# Pre-registration: the impact-framing clause

**Written before the clause exists and before any run of it.**

## Prior art, searched first

Per the standing rule, the nearest measured attempts, and why this is not either of
them:

| prior intervention | result | what it asked for |
| --- | --- | --- |
| in-prompt security checklist lens | NOT a net win; traded `authorization` 41% → 27%. Replaced. | *look for these weakness classes across the change* |
| dedicated additive security pass | security-specific lift UNPROVEN at n=1, +61% cost. Off by default. | *review the change again, with security eyes* |
| authorization-scope clause | 7 gained / 8 lost, p = 1.0000 | *this weakness class exists, look for it* |
| intent-framing clause | 7 / 7, p = 1.0000 | *frame the review around the change's intent* |

All four asked for **more or better-aimed security attention across the change**. The
diagnosis this clause comes from says attention is not the failure.

## The diagnosis it acts on

From `reports/2026-08-08-what-it-says-instead.md`, 259 missed
expectation-observations, $0:

- **61 of the 103 same-file misses put a finding INSIDE the missed expectation's own
  line range.**
- The nearest finding was categorised `bug` **78** times against `security` **15**.
- Only **1.5%** of misses were a competing real *security* defect.

The reviewer has the vulnerable line under its eye and reports a neighbouring
correctness property of the same code. **The security consequence is what goes
unsaid**, on a finding it is already writing.

## The intervention

One clause in the general discovery instructions, attached to the act of **writing a
finding** rather than to the act of searching:

> Before finalizing each finding, decide whether input that an untrusted party
> controls can reach the code it describes. When it can, the finding's description
> must state what that party gains — the value they supply, the check that does not
> stop it, and what they can then read, write, execute, or exhaust. A defect that is
> reachable by an attacker and described only as a correctness problem is
> under-reported, not reported.

It names no language, no framework, no fixture, and no weakness class — it is a rule
about how a finding is described, derived from what a security reviewer's output is
for. It must pass the prompt-genericity guard, and if it cannot be phrased to pass, it
is not shipped.

**Cost: no additional calls.** Same packets, same call count; only the instruction
text differs. This is the cheapest intervention measured in this project.

## Predictions, fixed in advance

- **Recall up.** Direction predicted, so the test is **one-sided**. The mechanism is
  specific: findings already produced at the right lines get descriptions that name
  the attacker path, and the semantic matcher can then credit them.
- **Magnitude: small.** 61 observations out of 259 misses is the addressable
  population, and only a fraction will convert. A realistic ceiling is ~8pp; I expect
  less. The corpus resolves ~11.6pp, so **this may well be a real effect the
  instrument cannot see**, and that is stated before the run rather than after.
- **Adjusted precision: flat.** If it falls, the clause is producing security-flavoured
  prose over ordinary bugs, which is the failure mode this intervention most plausibly
  has.
- **Genuine false positives: must not rise.** Stated as a change from THIS study's own
  control arm, not as an absolute threshold — the absolute form disqualified both arms
  of an earlier study today.

## The risk I am registering explicitly

The clause could raise measured recall **without improving the reviewer**, by making
descriptions adopt security vocabulary that superficially matches the answer key. That
would be tuning to the eval by accident.

Two things bound it, and neither is sufficient alone, so both are required:

1. The matcher is **semantic** — a description must name the actual defect, not merely
   sound like a security finding, to be credited.
2. **Adjusted precision and genuine false positives** are pre-registered as blocking
   criteria, because the failure mode's signature is more findings framed as security
   without more real defects found.

If recall rises while genuine false positives also rise, the result is reported as
**inconclusive-and-suspect**, not as a win.

## Design

- Arms: control `53389f7` vs treatment (clause added, nothing else).
- **Ten seeds per arm**, `ab-run.sh`, alternating order, 5/5 position balance.
- Corpus: `security-advisory-2026`, 71 cases / 73 expectations.
- Primary endpoint: paired per-expectation exact sign test, **one-sided**.
- Mandatory secondary: recall **per context depth** and **per mechanism**, plus
  genuine false-positive count and adjusted precision.

## Decision rule

**Ship** only if all three hold:
1. paired one-sided **p < 0.05** in favour of the treatment;
2. adjusted precision does not fall by more than the control arm's own spread;
3. genuine false positives do not rise above the control arm's count.

**Reject and revert** otherwise. There is no "keep as an off-by-default knob" option
here: a prompt clause is either how the engine asks for findings or it is not.

## Committed in advance

Ten seeds per arm, analysed once, no further seeds whatever the result. The honest
prior is poor — six pre-registered interventions this session, none positive — and
being derived from a measurement rather than from a hunch does not exempt this one.
