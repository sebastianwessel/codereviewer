// Tolerance for a NON-DETERMINISTIC PRODUCER, extracted from `agent-contracts.ts`
// so the Zod contracts for the four agent interactions are not read through ~300
// lines of alias tables.
//
// Everything here exists because the same model, asked the same question twice,
// spells a field `candidate_id` one run and `id` the next, sends a line number as
// `"42"` instead of `42`, nests the location under `primaryLocation` or `location`
// or neither, and files a race condition under `concurrency`, `race`, or
// `Race Condition!!`. That is not artefact back-compat and none of it is
// removable on the theory that one spelling is canonical: there is no canonical
// spelling, only what the provider happened to emit. Every alias accepted here
// must keep being accepted.
//
// The `.catch(undefined)` degradations that pair with these helpers live on the
// schemas in `agent-contracts.ts`, and carry the same intent: one malformed
// optional field must not discard a whole real finding.

import { CandidateFindingSchema } from '../../admission/index.js'

// Normalize a model-authored category/severity string to a comparison key:
// lowercase, non-alphanumerics collapsed to single dashes, no leading/trailing
// dash. Used across the model-enum normalizers so casing/punctuation differences
// between providers resolve to the same key.
const slugifyModelKey = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '')

export const normalizeModelEnumValue = <T extends string>(
  value: unknown,
  allowedValues: readonly T[],
  aliases: Readonly<Record<string, T>>
): unknown => {
  if (typeof value !== 'string') {
    return value
  }

  const key = slugifyModelKey(value)

  if ((allowedValues as readonly string[]).includes(key)) {
    return key
  }

  return aliases[key] ?? value
}

type ModelCategory = (typeof modelCategoryValues)[number]

// The single source of truth for mapping a model-authored category word or
// phrase onto FindingCategorySchema's closed enum. Every key is already a
// `slugifyModelKey` output (lowercase, dash-separated), so it doubles as both an
// exact-phrase alias (the whole raw `category`/`type` field slugifies to this
// key) and, via `categoryTokenPatterns` below, a bounded keyword a free-text
// scan can find inside a longer title or description. Before this table
// existed, the same word reached the engine through three independent code
// paths that disagreed with each other (e.g. "race condition" filed under
// `security` while a description merely mentioning "race" or "lock" filed under
// `performance`); resolving both a structured field and free text through this
// one table is what makes that impossible again.
//
// Exported (read-only) so its tests can assert every entry resolves correctly
// by iterating this table directly, rather than hand-copying ~60 aliases into
// the test file where the two could silently drift apart.
export const modelCategoryAliases: Readonly<Record<string, ModelCategory>> = {
  // Correctness, logic, and reliability defects, including concurrency ones. A
  // race condition, deadlock, or other concurrency defect is a correctness bug
  // first: it MAY have security impact (e.g. a bypassed TOCTOU check), but
  // filing it under `security` on the strength of the word "race" alone hides
  // it from reviewers of ordinary correctness bugs, and spec 15 explicitly
  // scopes concurrency OUT of the dedicated security pass. It is not
  // `performance` either - a race is about producing a wrong result, not about
  // being slow.
  bugs: 'bug',
  defect: 'bug',
  regression: 'bug',
  correctness: 'bug',
  logic: 'bug',
  'logic-error': 'bug',
  functional: 'bug',
  'functional-correctness': 'bug',
  reliability: 'bug',
  issue: 'bug',
  problem: 'bug',
  risk: 'bug',
  flaw: 'bug',
  crash: 'bug',
  panic: 'bug',
  exception: 'bug',
  stale: 'bug',
  'data-loss': 'bug',
  wrong: 'bug',
  incorrect: 'bug',
  missing: 'bug',
  omitted: 'bug',
  omits: 'bug',
  concurrency: 'bug',
  concurrent: 'bug',
  race: 'bug',
  'race-condition': 'bug',
  deadlock: 'bug',
  lock: 'bug',
  // Domain-specific correctness defects (pricing/billing/discount math) are
  // still plain correctness bugs, not a category of their own - the engine's
  // enum has no "financial" category.
  pricing: 'bug',
  'pricing-bug': 'bug',
  'pricing-correctness': 'bug',
  'pricing-logic': 'bug',
  billing: 'bug',
  'billing-bug': 'bug',
  'billing-correctness': 'bug',
  'billing-logic': 'bug',
  business: 'bug',
  'business-correctness': 'bug',
  'business-logic': 'bug',
  businesslogic: 'bug',
  'business-rule': 'bug',
  discount: 'bug',
  'discount-bug': 'bug',
  'discount-correctness': 'bug',
  'discount-logic': 'bug',
  calculation: 'bug',
  'calculation-logic': 'bug',
  financial: 'bug',
  finance: 'bug',
  overcharged: 'bug',
  undercharged: 'bug',
  prorated: 'bug',
  // Vulnerabilities and access-control failures. Deliberately narrow: words
  // that merely CO-OCCUR with security concerns elsewhere (like "race" above)
  // stay out of this list so they cannot re-create the original defect.
  vulnerability: 'security',
  vulnerabilities: 'security',
  authz: 'security',
  authorization: 'security',
  unauthorized: 'security',
  bypass: 'security',
  token: 'security',
  secret: 'security',
  leak: 'security',
  // Speed and resource-usage defects, not correctness defects.
  perf: 'performance',
  latency: 'performance',
  memory: 'performance',
  expensive: 'performance',
  slow: 'performance',
  cache: 'performance',
  // Readability/consistency/naming concerns.
  maintenance: 'maintainability',
  naming: 'maintainability',
  consistency: 'maintainability',
  'naming-consistency': 'maintainability',
  readability: 'maintainability',
  // Cross-platform/cross-version portability.
  migration: 'compatibility',
  portable: 'compatibility',
  portability: 'compatibility',
  // Policy/compliance rule violations.
  compliance: 'policy',
  // Test-suite defects.
  tests: 'test',
  testing: 'test'
} as const

// Categories are checked in this fixed priority order when a slug contains
// more than one alias's keyword, so the result depends on this explicit
// ordering rather than on `modelCategoryAliases`' incidental key order. `bug`
// is the catch-all and stays last.
const categoryResolutionPriority: readonly ModelCategory[] = [
  'security',
  'compatibility',
  'policy',
  'test',
  'maintainability',
  'performance',
  'bug'
]

// One bounded-keyword regex per category, built once from `modelCategoryAliases`
// so the token scan can never drift from the alias table it is derived from.
const categoryTokenPatterns = new Map<ModelCategory, RegExp>(
  categoryResolutionPriority
    .map((category) => {
      const tokens = Object.entries(modelCategoryAliases)
        .filter(([, mappedCategory]) => mappedCategory === category)
        .map(([token]) => token)

      return tokens.length === 0
        ? undefined
        : ([
            category,
            new RegExp(`(?:^|-)(?:${tokens.join('|')})(?:-|$)`, 'u')
          ] as const)
    })
    .filter((entry): entry is readonly [ModelCategory, RegExp] => entry !== undefined)
)

// Resolves an already-slugified key against the enum itself, then the exact
// alias table, then the bounded keyword scan. Shared by both the structured
// `category`/`type` field and the free-text fallback below so the two paths
// can never disagree.
const resolveModelCategoryFromSlug = (key: string): ModelCategory | undefined => {
  if ((modelCategoryValues as readonly string[]).includes(key)) {
    return key as ModelCategory
  }

  const exactAlias = modelCategoryAliases[key]

  if (exactAlias !== undefined) {
    return exactAlias
  }

  for (const category of categoryResolutionPriority) {
    if (categoryTokenPatterns.get(category)?.test(key)) {
      return category
    }
  }

  return undefined
}

// Resolves a finding's category from whatever the model actually sent. The
// structured `category`/`type` field is authoritative when it resolves to
// anything at all (via the enum, an alias, or a keyword inside it); free text
// (title/summary/description/...) is consulted only when the structured value
// resolves to nothing, which covers a reviewer that stated the defect's nature
// in prose without filling in - or without correctly filling in - the
// structured field.
export const resolveModelCategory = (
  structuredValue: unknown,
  freeTextParts: readonly unknown[]
): ModelCategory | undefined => {
  if (typeof structuredValue === 'string') {
    const fromStructuredValue = resolveModelCategoryFromSlug(
      slugifyModelKey(structuredValue)
    )

    if (fromStructuredValue !== undefined) {
      return fromStructuredValue
    }
  }

  const key = slugifyModelKey(
    [structuredValue, ...freeTextParts]
      .filter((part): part is string => typeof part === 'string')
      .join('\n')
  )

  return key.length === 0 ? undefined : resolveModelCategoryFromSlug(key)
}

export const normalizeModelLineValue = (value: unknown): unknown => {
  if (typeof value !== 'string') {
    return value
  }

  const trimmed = value.trim()

  return /^\d+$/u.test(trimmed) ? Number(trimmed) : value
}

export const normalizeModelEvidenceIds = (value: unknown): unknown =>
  typeof value === 'string' ? [value] : value

export const truncateModelString = (value: unknown, maxLength: number): unknown =>
  typeof value === 'string' && value.length > maxLength
    ? value.slice(0, maxLength)
    : value

const modelCategoryValues = CandidateFindingSchema.shape.category.options
export const modelSeverityValues = CandidateFindingSchema.shape.severity.options

const modelNestedLocationValue = (
  record: Record<string, unknown>,
  objectKey: string,
  key: string
): unknown => {
  const location = record[objectKey]

  if (
    typeof location !== 'object' ||
    location === null ||
    Array.isArray(location)
  ) {
    return undefined
  }

  return (location as Record<string, unknown>)[key]
}

export const modelLocationValue = (
  record: Record<string, unknown>,
  key: string
): unknown =>
  modelNestedLocationValue(record, 'primaryLocation', key) ??
  modelNestedLocationValue(record, 'location', key)

// One source-line citation discovery may attach to a finding, ONLY read when
// `review.citations.enabled` (see holistic-task-review.ts's `candidateFromFinding`
// and discovery/citation-evidence.ts, which verifies it deterministically before it
// ever becomes evidence). `path` is optional: a citation overwhelmingly names a
// line in the finding's own file, so requiring the model to repeat a path it
// already stated elsewhere on the same object would only be one more place for it
// to disagree with itself. An absent `path` is resolved against the finding's own
// `path` at the point the citation is actually verified, not here.
export const normalizeModelCitationEntry = (value: unknown): unknown => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value
  }

  const record = value as Record<string, unknown>

  return {
    path: record.path ?? record.filePath ?? record.file,
    startLine: normalizeModelLineValue(
      record.startLine ?? record.start_line ?? record.line
    ),
    quote: record.quote ?? record.text ?? record.snippet
  }
}
