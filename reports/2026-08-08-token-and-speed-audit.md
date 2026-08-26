# Token and speed audit: no cheap win is available

Derived 2026-08-08 from the ten control runs of the impact-framing A/B, already paid
for. **No provider call.** 71 cases, `openai/gpt-5.3-codex`, engine `0dcfeb8`.

**Result: caching and packet structure are already near their ceiling. Two plausible
defects were hypothesised and both were disproved by the data.** Recorded so the
investigation is not repeated.

## Measured structure of a warm run

| | |
| --- | --- |
| spend | **$1.47** per run, 71 cases |
| case wall-clock | 11.6 min summed (concurrency hides much of it) |
| input : output | **~70 : 1** |
| cache rate | median **81%**, min 34%, max 98% |
| uncached tokens per case | median **3,142**, mean 5,305 |

Input dominates output by roughly seventy to one, so output-side savings are
irrelevant and every lever worth having is on the input side.

## Where the money is, and why it is not recoverable

**23% of cases carry 50% of spend; 39% carry 50% of wall-clock.** The top case,
`datamodel-code-generator-local-ref-arbitrary-file-read`, costs $0.229 per run — about
16% of the whole run — with 199k input tokens at only **41% cache**, while a sibling
case with a *larger* packet (213k) cached **96%** and cost $0.063.

That looked like a defect. It is not.

### Hypothesis 1: refutation packets poison the cache — DISPROVED

Refutation packets vary with candidate text, so cases with more refutation calls
should cache worse. Measured correlation between refutation-call count and cache rate:
**−0.272**. Between raw-finding count and cache rate: **−0.206**. Both too weak to
carry the effect; the low-cache group averages 1.31 refutation calls against 1.12 for
the high-cache group. **Not the explanation.**

### Hypothesis 2: it is arithmetic, plus shared-file ordering — CONFIRMED

Two things together account for all of it.

**Packet size.** Correlation between log input size and cache rate is **+0.518**. A
small packet has a smaller cacheable body relative to its fixed head, so its cache
*percentage* is lower while its absolute waste is trivial — the median case leaves only
3,142 tokens uncached.

**Shared files.** Five paths in the corpus are reviewed by more than one case, and
`src/datamodel_code_generator/parser/jsonschema.py` is reviewed by **four**. Cache
rates in run order:

| case (alphabetical = run order) | cache |
| --- | --- |
| `datamodel-code-generator-local-ref-arbitrary-file-read` | **41.3%** |
| `schema-default-factory-emitted-into-generated-code` | 94.0% |
| `schema-import-extension-injected-into-generated-imports` | 95.8% |
| `x-python-type-extension-emitted-into-generated-annotations` | 92.7% |

The same pattern holds for every other shared path. **The first case over a shared file
absorbs the cold-cache cost that its siblings then ride for free.** The apparent
outlier is per-case attribution of a cost the corpus pays once.

So there is no anomaly and nothing to fix. The cache is doing its job, including across
cases, which is more than was previously known.

## What this closes

- **Cache tuning is not a lever.** 81% median with the misses explained by arithmetic
  and shared-prefix ordering. Nothing here is recoverable by reordering packet fields
  or by shrinking context.
- **Per-case cost attribution is misleading** whenever cases share a reviewed file, and
  five paths in this corpus do. Any future "this case is expensive" claim must check
  whether the case is simply first in a shared-file group.

## The one real token finding of the day, from elsewhere

Recorded in `reports/2026-08-07-subfile-partitioning-result.md` and worth repeating
because it is the only actionable one: under **any** partitioned discovery mode, each
partition carries the full shared context — diff, change intent, support signals,
referenced definitions. Per call the sub-file arm sent 36% less input, yet total input
still **rose**, because there were 77% more calls each re-sending the shared context.

**In partitioned mode the token cost is dominated by shared-context duplication, not by
the reviewed file body.** That remains true and unexploited — but sub-file partitioning
was rejected on recall, and the shipped default (2 files per call) partitions rarely
enough that the duplication is small. It becomes a live target only if a future
partitioning mode is ever promoted.
