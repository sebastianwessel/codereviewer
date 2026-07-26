# 2 · Deterministic Support Signals

← [Configuration and intake](01-configuration-and-intake.md) · next → [Task clustering and context assembly](03-task-clustering-and-context-assembly.md)

A static, no-execution pass over the changed files that produces a structural
description of the change. The name is deliberate: these are **support** signals.
They exist to make the model stages better informed, not to detect defects.

## What it receives

The changed source files (path + full current content) from intake.

## What it does

Files are routed to exactly one language extractor, and each extractor owns its
own paths — a fact or evidence record that does not belong to the file it was
extracted from is a hard error, not a warning.

| Language | Engine |
| --- | --- |
| TypeScript, JavaScript | TypeScript compiler |
| Python, Go, Rust, Java, Ruby | `ast-grep` |

Anything else is simply not analysed; it is still reviewed by the model.

The extraction produces three things:

**Facts** — the structural map of the change. Each fact carries an id, language,
kind, path, name, line, a short summary, and a content hash.

| Fact kind | Meaning |
| --- | --- |
| `import` | An import edge, with its `moduleSpecifier` |
| `export` | An exported binding |
| `declaration` | A declared symbol |
| `public-symbol` | A symbol on the module's public surface |
| `module` | A module-level fact |

**Evidence records** — redacted, location-anchored records (rule hits and
diagnostics, where a language extractor produces them). Evidence is the currency
admission speaks: a candidate with no evidence cannot be admitted.

**Test mappings** — `direct` or `same-directory` relations between a source file
and its test file, used as context.

## Why it exists

1. **Clustering edges.** `import` facts are what let the planner discover that
   two changed files belong to the same change unit, so they are reviewed
   together. This is free — no model call is involved.
2. **Structural context.** Facts and test mappings are serialized into the task
   packet when `aiReview.deterministicSignalMode` is `support`, giving the
   reviewer a map of the change alongside the source.
3. **Referenced definitions.** The same extractor is re-run over
   imported-but-unchanged dependency files to build bounded digests of their
   declarations (see [stage 3](03-task-clustering-and-context-assembly.md)).
4. **Corroboration at refutation time.** A support-signal candidate that overlaps
   a model candidate's location, or shares its evidence, is shown to the refuter
   as corroboration.

## What it emits

| Output | Consumed by |
| --- | --- |
| `facts` | Clustering, task packets, referenced-definition digests |
| `evidence` | Task packets, admission, the report's evidence list |
| `testMappings` | Task packets |

## What it does *not* do

Deterministic signals cannot, on their own, produce an actionable finding today.
The mechanism exists — an evidence record whose `ruleId` matches a *trusted rule
template* is promoted into a candidate that is exempt from refutation and from the
model severity floor — but **the trusted-rule template table is currently empty**.
The earlier entries were removed because they keyed benchmark-specific rule ids,
which is eval-gaming rather than review quality. So in practice the pipeline's
detection surface is the model, and this stage is pure support.

This is intentional: the engine assumes your pipeline already runs linters, type
checks, tests, and SAST, and it does not try to duplicate them.

## What can go wrong

| Situation | Behaviour |
| --- | --- |
| File in an unsupported language | No facts extracted; the file is still fully reviewed by the model |
| Parse failure in a dependency digest | Falls back to a head-of-file window (see stage 3) |
| An extractor emits a fact for a path it does not own | Hard failure — this invariant is asserted, not tolerated |
| `deterministicSignalMode: 'disabled'` | Facts are still extracted and still drive clustering, but neither the serialized fact summary nor referenced definitions enter the model packet |

## Configuration keys

| Key | Default | Effect |
| --- | --- | --- |
| `aiReview.deterministicSignalMode` | `support` | `support` injects facts, test mappings, and referenced definitions into task packets; `disabled` keeps clustering but sends none of it to the model |
| `security.signals.enabled` | `false` | Reserved for a future deterministic security-signal layer; carries no behaviour today |

See also: [Trust model](../trust-model.md).
