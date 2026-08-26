import type { ZodType } from 'zod'
import { z } from 'zod'
import { CodeReviewerConfigSchema } from '../../shared/contracts/index.js'
import {
  definitionOf,
  unwrapSchemaOnce
} from '../../shared/zod/schema-internals.js'
import { minimumExemptionReasonLength } from './declared-exemption.js'
import { documentIssueSchema } from './document-issue.js'
import { collectTextFiles, type TextFile } from './markdown-sources.js'

// Checks the DEFAULT COLUMN of the configuration reference tables against the
// defaults `CodeReviewerConfigSchema` actually carries.
//
// `docs/06-reference/configuration/README.md` opens by saying "Every key, type,
// and default on these pages is read from
// `src/shared/contracts/config/config.schema.ts`, which is the single source of
// truth". That was a convention, not a mechanism: roughly ninety defaults were
// hand-transcribed into Markdown tables with nothing comparing them to anything.
// `config-example-checker.ts` validates the fenced JSON on the same pages and
// `artifact-example-checker.ts` does the same for artifact examples — neither has
// ever read a table cell.
//
// THIS IS DRIFT PREVENTION, NOT A LIVE DEFECT. At the time it was written every
// documented default agreed with the schema. What was missing was anything that
// would say so tomorrow, and the failure mode is silent in both directions: a
// default that moves in the schema leaves a page confidently stating the old
// value, and a new option ships with no row at all.
//
// BOTH DIRECTIONS ARE FINDINGS, and the second is the one that catches a new
// option shipping undocumented. A documented key the schema does not have is
// `documented-key-absent-from-schema`; a schema leaf no page documents is
// `undocumented-schema-key`.
//
// THE SCHEMA IS THE ONLY AUTHORITY. This module never restates a default. It
// reads them out of the schema and compares.

export const ConfigDefaultTableIssueKindSchema = z.enum([
  // The Default cell states a value the schema does not carry.
  'documented-default-mismatch',
  // The Key cell names a path that does not exist in the schema.
  'documented-key-absent-from-schema',
  // The schema carries a leaf no table documents. This is how a new option ships
  // with no row.
  'undocumented-schema-key',
  // The Default cell is in none of the documented spellings, so nothing can be
  // compared. Reported rather than skipped: a cell this module cannot read is a
  // row it is not checking, and silence there is indistinguishable from a pass.
  'unreadable-default',
  // A row claims the exemption tag without saying why.
  'unexplained-exemption',
  // A scanned root holds the reference pages and yielded no key table at all.
  'no-tables-found'
])

// `line` is the table row. An `undocumented-schema-key` issue has no row to point
// at and names line 1 of the reference root, which is the only line it can name.
export const ConfigDefaultTableIssueSchema = documentIssueSchema(
  ConfigDefaultTableIssueKindSchema
)

export const ConfigDefaultTableCheckResultSchema = z.strictObject({
  // Tables whose header is `Key | Type | Default | ...`, across every scanned
  // root.
  keyTableCount: z.int().min(0),
  // Data rows read out of those tables. The anti-vacuity floor in the test is
  // held against this.
  documentedRowCount: z.int().min(0),
  // Rows whose documented default was actually compared against the schema.
  comparedRowCount: z.int().min(0),
  // Rows carrying an argued exemption. Counted apart so the escape hatch cannot
  // grow quietly.
  exemptedRowCount: z.int().min(0),
  // Leaves the schema carries, whether documented or not.
  schemaLeafCount: z.int().min(0),
  issues: z.array(ConfigDefaultTableIssueSchema)
})

export type ConfigDefaultTableIssueKind = z.infer<
  typeof ConfigDefaultTableIssueKindSchema
>
export type ConfigDefaultTableIssue = z.infer<
  typeof ConfigDefaultTableIssueSchema
>
export type ConfigDefaultTableCheckResult = z.infer<
  typeof ConfigDefaultTableCheckResultSchema
>

// The reference pages, and nothing else.
//
// Narrower than `configScanRoots` on purpose. That checker classifies a block by
// its CONTENT, so it can be pointed at the whole repository and still only act on
// configuration. This one classifies a table by its HEADER, and `Key | Type |
// Default | ...` is a shape any page could reasonably use for something that is
// not configuration. The coverage direction settles it: `undocumented-schema-key`
// asks "is this key documented ANYWHERE in the scanned set", and that question is
// only answerable against a set that is meant to be complete. The configuration
// reference is that set — its own README asserts "All 21 top-level keys are
// covered".
export const configDefaultTableScanRoots = [
  'docs/06-reference/configuration'
] as const

// THE TABLE SHAPES THIS MODULE READS, and the one it knowingly does not.
//
// The reference pages use three header spellings. Two are read here: `Key | Type
// | Default | What it does` and `Key | Type | Default | Meaning`, which differ
// only in the last column's name and are matched by the first three cells rather
// than by the whole row, so a third synonym costs nothing.
//
// THE STATED GAP: `context-and-evaluation.md`'s context-provider union table,
// whose header is `` `type` | Key | Type | Default ``. Its Key cells are relative
// to a UNION MEMBER selected by the first column, with blank continuation cells
// carrying the member down the rows — `dir` under `"inbox"` is
// `contextSources.providers[].dir`, an array element, not a path into the
// configuration object. Resolving it means walking a discriminated union and
// inventing an addressing scheme for array elements that no other row uses, for
// six rows. It is left uncovered DELIBERATELY and named here so the gap is
// stated rather than discovered; `config-default-table-checker.test.ts` pins that
// exactly one such table exists, so the uncovered set cannot grow in silence.
const keyTableLeadingColumns = ['Key', 'Type', 'Default'] as const

// THE TWO EXEMPTIONS, DECLARED IN THE ROW.
//
// The mechanism is `artifact-example-checker.ts`'s, adapted to a table: a tag
// attached to the thing it exempts, carrying a reason, invisible in the rendered
// page and plain in the source. Its argument against a comment MARKER was that "a
// comment marker is a separate line that a later edit can insert a block under" —
// a comment INSIDE the cell is not a separate line and cannot come adrift from
// its row, and a registry keyed by key name would break the moment somebody
// renamed a key.
//
// `no-literal-default` exempts one row from the default comparison, for a default
// too large to sit in a table cell:
//
//   | `paths.exclude` | glob[] | see below <!-- no-literal-default the list runs
//   to eighteen globs and is printed in full below the table --> | ... |
//
// `covers-subtree` exempts a whole subtree from the COVERAGE direction, for a
// nested object documented as one row plus prose rather than one row per leaf:
//
//   | `evaluation.regressionGate.overrides` | object | `{}` <!-- covers-subtree
//   every override key is optional ... --> | ... |
//
// They are separate tags because they are separate claims, and a row may carry
// either. Both require a reason under the same rule.
const noLiteralDefaultTag = 'no-literal-default'
const coversSubtreeTag = 'covers-subtree'
const exemptionPattern = /<!--\s*(no-literal-default|covers-subtree)\b([^]*?)-->/u

// The two spellings that assert the schema carries NO default. They are distinct
// claims and are checked as such: `*required*` also asserts the key must be
// supplied, which `*unset*` denies.
const unsetDefaultCell = '*unset*'
const requiredDefaultCell = '*required*'

export type DocumentedDefaultRow = {
  readonly path: string
  // 1-based line of the row.
  readonly line: number
  // The configuration path, fully qualified. A Key cell without a dot is
  // qualified by the nearest enclosing backticked heading, which is how
  // `review.signalFacts`'s single `enabled` row addresses itself.
  readonly key: string
  // The Default cell, verbatim and untrimmed of its markup.
  readonly documentedDefault: string
}

export type SchemaLeaf = {
  readonly key: string
  readonly hasDefault: boolean
  readonly defaultValue: unknown
  // A leaf with neither a default nor an `optional` wrapper must be supplied.
  readonly required: boolean
}

export type SchemaInventory = {
  readonly leaves: readonly SchemaLeaf[]
  // Every nested-object path. A row may legitimately document one of these
  // instead of its leaves — see `covers-subtree` — and without this the checker
  // would report such a row as naming a key the schema does not have.
  readonly objectPaths: ReadonlySet<string>
}

/**
 * Every leaf path of the configuration schema, with the default it carries.
 *
 * A LEAF IS ANYTHING THAT IS NOT AN OBJECT once wrappers are peeled — a scalar,
 * an enum, an array, a record, a union. Descending into an array's element shape
 * would invent paths (`contextSources.providers.dir`) that address nothing a user
 * can set, and the pages document those arrays as one row each, which is the
 * honest granularity.
 *
 * THE DEFAULT IS READ TWICE, and the resolved reading wins.
 *
 * The wrapper's own `defaultValue` is what the schema DECLARES, and it is the
 * only reading available for a key under an optional parent — every `provider.*`
 * key, since a parsed empty config has no `provider` at all. But a declared
 * default can be skeletal: `contextSources.providers` declares
 * `[{ type: 'inbox' }, { type: 'changed-files' }]` and Zod then fills each
 * member's own defaults, so what a user actually gets is two fully populated
 * provider objects. Documenting the declared value there would be documenting
 * something no run ever holds.
 *
 * So `CodeReviewerConfigSchema.parse({})` is overlaid wherever it reaches the
 * key, and the declared value stands only where it does not. The test pins both
 * halves: every reachable leaf reports the resolved value, and at least one leaf
 * genuinely differs between the two readings, so an overlay that silently stopped
 * working could not pass as a no-op.
 */
export const configSchemaInventory = (): SchemaInventory => {
  const leaves: SchemaLeaf[] = []
  const objectPaths = new Set<string>()

  const visit = (schema: ZodType, prefix: string): void => {
    let node = schema
    let hasDefault = false
    let defaultValue: unknown
    // Undefined until a wrapper says. The OUTERMOST claim wins, as the default's
    // does; while every wrapper this loop read could only make a key optional,
    // "the first one seen" and "any one seen" were the same rule.
    let optional: boolean | undefined

    // Peel wrappers until an object or a leaf is reached, reading what each layer
    // claims on the way past. The OUTERMOST default wins, which is the one Zod
    // applies.
    //
    // The peel set is `shared/zod/schema-internals.ts`'s, which is WIDER than the
    // `default | prefault | optional | nullable` this loop used to stop at. No
    // configuration key reaches one of the additional wrappers today, so the
    // inventory is unchanged; the day one does — a `.readonly()`, a `.catch()`, a
    // pipe at an object position — the old loop would have stopped at the wrapper
    // and recorded a leaf with no default, firing `undocumented-schema-key` and
    // `documented-default-mismatch` on a page that was correct.
    for (;;) {
      const def = definitionOf(node)

      if (def.type === 'default' || def.type === 'prefault') {
        if (!hasDefault) {
          hasDefault = true
          defaultValue =
            typeof def.defaultValue === 'function'
              ? (def.defaultValue as () => unknown)()
              : def.defaultValue
        }

        optional ??= true
      } else if (def.type === 'optional' || def.type === 'nullable') {
        optional ??= true
      } else if (def.type === 'nonoptional') {
        // The one wrapper in the wider set that RETRACTS what an inner one says.
        // Walking past it unread would report
        // `z.string().optional().nonoptional()` as optional on the strength of
        // the wrapper it overrides; the loop used to stop at it and call the key
        // required, which is what Zod does.
        optional ??= false
      }

      const inner = unwrapSchemaOnce(node)

      if (inner === undefined) {
        break
      }

      node = inner
    }

    const def = definitionOf(node)

    if (def.type === 'object' && def.shape !== undefined) {
      if (prefix !== '') {
        objectPaths.add(prefix)
      }

      for (const [key, child] of Object.entries(def.shape)) {
        visit(child, prefix === '' ? key : `${prefix}.${key}`)
      }

      return
    }

    leaves.push({
      key: prefix,
      hasDefault,
      defaultValue,
      required: optional !== true
    })
  }

  visit(CodeReviewerConfigSchema, '')

  const resolved = CodeReviewerConfigSchema.parse({}) as unknown

  return {
    leaves: leaves.map((leaf) => {
      const effective = resolveKey(resolved, leaf.key)

      return effective === undefined
        ? leaf
        : { ...leaf, hasDefault: true, defaultValue: effective.value }
    }),
    objectPaths
  }
}

// Walks a dotted path into a parsed value. Returns `undefined` for a path the
// value does not reach, which is DIFFERENT from reaching a key whose value is
// `undefined` — hence the wrapper object rather than the bare value.
const resolveKey = (
  root: unknown,
  key: string
): { readonly value: unknown } | undefined => {
  let value = root

  for (const segment of key.split('.')) {
    if (typeof value !== 'object' || value === null || !(segment in value)) {
      return undefined
    }

    value = (value as Record<string, unknown>)[segment]
  }

  return { value }
}

// A Markdown table cell may contain an escaped pipe -- the Type column is full of
// them (`` `"openai"` \| `"openai-compatible"` ``). Splitting on a bare `|`
// mis-columns every one of those rows, and a mis-columned row reads its Type cell
// as its Default cell, which would report a mismatch on a correct page.
const splitRowCells = (row: string): readonly string[] => {
  const cells: string[] = []
  let current = ''

  for (let index = 0; index < row.length; index += 1) {
    const character = row[index] as string

    if (character === '\\' && row[index + 1] === '|') {
      current += '|'
      index += 1
      continue
    }

    if (character === '|') {
      cells.push(current)
      current = ''
      continue
    }

    current += character
  }

  cells.push(current)

  // A Markdown row opens and closes with a pipe, so the first and last cells are
  // the empty strings outside them.
  return cells.slice(1, -1).map((cell) => cell.trim())
}

const isKeyTableHeader = (cells: readonly string[]): boolean =>
  cells.length > keyTableLeadingColumns.length &&
  keyTableLeadingColumns.every((column, index) => cells[index] === column)

const headingPathPattern = /^#{1,6}\s+`([A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*)`/u
const tableRowPattern = /^\s*\|/u
const alignmentRowPattern = /^\s*\|[\s:|-]+\|\s*$/u

/**
 * Every documented key row on a page, with its key fully qualified.
 *
 * Exported and pure so the extractor can be exercised on known input. A checker
 * whose extractor silently stops matching reports a clean result for a page full
 * of stale defaults, which is this repository's documented recurring defect class
 * rather than a hypothetical one.
 */
export const extractDocumentedDefaultRows = (
  file: TextFile
): readonly DocumentedDefaultRow[] => {
  const lines = file.content.split('\n')
  const rows: DocumentedDefaultRow[] = []
  let sectionPath = ''
  let index = 0

  while (index < lines.length) {
    const line = lines[index] as string
    const heading = headingPathPattern.exec(line)

    if (heading !== null) {
      sectionPath = heading[1] as string
      index += 1
      continue
    }

    if (
      !tableRowPattern.test(line) ||
      !isKeyTableHeader(splitRowCells(line)) ||
      !alignmentRowPattern.test(lines[index + 1] ?? '')
    ) {
      index += 1
      continue
    }

    index += 2

    while (index < lines.length && tableRowPattern.test(lines[index] as string)) {
      const cells = splitRowCells(lines[index] as string)
      const key = (cells[0] ?? '').replace(/`/gu, '').trim()

      if (key !== '') {
        rows.push({
          path: file.path,
          line: index + 1,
          // A Key cell without a dot is relative to its section, which is how the
          // single-row `review.signalFacts` and `review.citations` tables are
          // written. The heading carries the qualification, so nothing is guessed.
          key: key.includes('.') || sectionPath === '' ? key : `${sectionPath}.${key}`,
          documentedDefault: cells[2] ?? ''
        })
      }

      index += 1
    }
  }

  return rows
}

// `"a"` and `` `"a"` `` are the same claim; `**`true`**` is that claim in bold.
// Bold is stripped rather than reported, because how a cell is emphasised is a
// presentation choice and refusing it would make the checker an opinion about
// typography.
const literalDefaultPattern = /^(?:\*\*)?`([^]*)`(?:\*\*)?$/u

type DefaultClaim =
  | { readonly kind: 'literal'; readonly value: unknown }
  | { readonly kind: 'unset' }
  | { readonly kind: 'required' }
  | {
      readonly kind: 'exempt'
      readonly tag: string
      readonly reason: string
    }
  | { readonly kind: 'unreadable' }

const readDefaultClaim = (cell: string): DefaultClaim => {
  const exemption = exemptionPattern.exec(cell)

  if (exemption !== null) {
    return {
      kind: 'exempt',
      tag: exemption[1] as string,
      reason: (exemption[2] ?? '').trim()
    }
  }

  const trimmed = cell.trim()

  if (trimmed === unsetDefaultCell) {
    return { kind: 'unset' }
  }

  if (trimmed === requiredDefaultCell) {
    return { kind: 'required' }
  }

  const literal = literalDefaultPattern.exec(trimmed)

  if (literal === null) {
    return { kind: 'unreadable' }
  }

  try {
    return { kind: 'literal', value: JSON.parse(literal[1] as string) as unknown }
  } catch {
    return { kind: 'unreadable' }
  }
}

// Deep structural equality over JSON values. `JSON.stringify` is not enough: it
// is key-order sensitive, so a default object written with its keys in a
// different order than the schema declares them would be reported as a mismatch.
const sameJsonValue = (left: unknown, right: unknown): boolean => {
  if (left === right) {
    return true
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((entry, index) => sameJsonValue(entry, right[index]))
    )
  }

  if (
    typeof left !== 'object' ||
    typeof right !== 'object' ||
    left === null ||
    right === null
  ) {
    return false
  }

  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()

  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index]) &&
    leftKeys.every((key) =>
      sameJsonValue(
        (left as Record<string, unknown>)[key],
        (right as Record<string, unknown>)[key]
      )
    )
  )
}

// A default as it reads inside a message: the whole value, serialised, because a
// documented default may be an object or a list and `String({})` says nothing.
// `undefined` has no JSON spelling, and a leaf carrying no default is exactly the
// case a mismatch message has to name.
//
// NOT the same function as `artifact-example-checker.ts`'s
// `describeValueQuotingStrings`, which quotes strings and stringifies the rest.
// Both were called `describeValue`, in one folder, with different semantics.
const describeValueAsJson = (value: unknown): string => JSON.stringify(value) ?? 'undefined'

/**
 * Compares one documented row against the schema.
 *
 * Exported for the mutation test, which changes a documented default and requires
 * the check to fail NAMING THE KEY — a check that fails without saying which row
 * moved sends a reader through ninety of them.
 */
export const checkDocumentedDefaultRow = (
  row: DocumentedDefaultRow,
  inventory: {
    readonly leavesByKey: ReadonlyMap<string, SchemaLeaf>
    readonly objectPaths: ReadonlySet<string>
  }
): {
  readonly compared: boolean
  readonly exempt: boolean
  // Set when the row declares `covers-subtree`: every schema leaf beneath this
  // key counts as documented.
  readonly coversSubtree: boolean
  readonly issues: readonly ConfigDefaultTableIssue[]
} => {
  const claim = readDefaultClaim(row.documentedDefault)
  const at = { path: row.path, line: row.line }
  const nothing = { compared: false, exempt: false, coversSubtree: false }

  if (claim.kind === 'exempt') {
    if (claim.reason.length < minimumExemptionReasonLength) {
      return {
        ...nothing,
        issues: [
          {
            ...at,
            kind: 'unexplained-exemption',
            message: `\`${row.key}\` is tagged \`${claim.tag}\` without saying why. State the reason in the tag, so the next reader can tell a deliberate exemption from an unchecked row.`
          }
        ]
      }
    }

    const coversSubtree = claim.tag === coversSubtreeTag

    // An exemption still has to name something real. A `covers-subtree` tag on a
    // key the schema does not have as an object would silently exempt an empty
    // subtree, which is the escape hatch turning into a skip list.
    if (
      coversSubtree
        ? !inventory.objectPaths.has(row.key)
        : !inventory.leavesByKey.has(row.key)
    ) {
      return {
        ...nothing,
        issues: [
          {
            ...at,
            kind: 'documented-key-absent-from-schema',
            message: `\`${row.key}\` is tagged \`${claim.tag}\` but CodeReviewerConfigSchema has no ${coversSubtree ? 'nested object' : 'leaf'} at that path. An exemption that names nothing exempts nothing.`
          }
        ]
      }
    }

    return { compared: false, exempt: true, coversSubtree, issues: [] }
  }

  const leaf = inventory.leavesByKey.get(row.key)

  if (leaf === undefined) {
    return {
      ...nothing,
      issues: [
        {
          ...at,
          kind: 'documented-key-absent-from-schema',
          message: inventory.objectPaths.has(row.key)
            ? `\`${row.key}\` is a nested object in CodeReviewerConfigSchema, not a settable leaf, and the row states a default for it as though it were one. Document its leaves, or tag the row \`${coversSubtreeTag} <reason>\` to say the subtree is covered here on purpose.`
            : `\`${row.key}\` is documented but CodeReviewerConfigSchema has no such key. Either the key was removed from the schema and the row outlived it, or the row names a path that never existed — a config setting it fails validation with exit 2.`
        }
      ]
    }
  }

  if (claim.kind === 'unreadable') {
    return {
      ...nothing,
      issues: [
        {
          ...at,
          kind: 'unreadable-default',
          message: `\`${row.key}\` documents its default as ${JSON.stringify(row.documentedDefault.trim())}, which is none of: a backticked JSON literal, ${unsetDefaultCell}, ${requiredDefaultCell}, or a \`${noLiteralDefaultTag}\` tag stating why no literal is possible. Nothing was compared for this row.`
        }
      ]
    }
  }

  if (claim.kind === 'unset' || claim.kind === 'required') {
    const documentedRequired = claim.kind === 'required'

    if (leaf.hasDefault) {
      return {
        compared: true,
        exempt: false,
        coversSubtree: false,
        issues: [
          {
            ...at,
            kind: 'documented-default-mismatch',
            message: `\`${row.key}\` is documented as ${claim.kind === 'unset' ? unsetDefaultCell : requiredDefaultCell} but the schema defaults it to ${describeValueAsJson(leaf.defaultValue)}.`
          }
        ]
      }
    }

    return leaf.required === documentedRequired
      ? { compared: true, exempt: false, coversSubtree: false, issues: [] }
      : {
          compared: true,
          exempt: false,
          coversSubtree: false,
          issues: [
            {
              ...at,
              kind: 'documented-default-mismatch',
              message: `\`${row.key}\` is documented as ${documentedRequired ? requiredDefaultCell : unsetDefaultCell} but the schema makes it ${leaf.required ? requiredDefaultCell : unsetDefaultCell}.`
            }
          ]
        }
  }

  if (!leaf.hasDefault) {
    return {
      compared: true,
      exempt: false,
      coversSubtree: false,
      issues: [
        {
          ...at,
          kind: 'documented-default-mismatch',
          message: `\`${row.key}\` is documented with the default ${describeValueAsJson(claim.value)} but the schema carries no default for it — it is ${leaf.required ? requiredDefaultCell : unsetDefaultCell}.`
        }
      ]
    }
  }

  return sameJsonValue(claim.value, leaf.defaultValue)
    ? { compared: true, exempt: false, coversSubtree: false, issues: [] }
    : {
        compared: true,
        exempt: false,
        coversSubtree: false,
        issues: [
          {
            ...at,
            kind: 'documented-default-mismatch',
            message: `\`${row.key}\` is documented with the default ${describeValueAsJson(claim.value)} but the schema's default is ${describeValueAsJson(leaf.defaultValue)}.`
          }
        ]
      }
}

/**
 * Checks every documented default on the configuration reference pages, in both
 * directions.
 *
 * WHY ZERO IS A FAILURE. Same rule as `config-example-checker.ts`, for the same
 * recorded reason: a checker that extracts nothing reports a clean result, which
 * reads exactly like a repository with no stale defaults. A root that holds
 * Markdown and yields no key table produces `no-tables-found`, and the test holds
 * a floor under the row count as well, because a parser that quietly starts
 * reading one table instead of twenty-four would clear a per-root check.
 */
export const checkConfigDefaultTables = async (
  input: {
    readonly repositoryRoot: string
    readonly roots?: readonly string[]
  }
): Promise<ConfigDefaultTableCheckResult> => {
  const roots = input.roots ?? configDefaultTableScanRoots
  const { leaves, objectPaths } = configSchemaInventory()
  const inventory = {
    leavesByKey: new Map(leaves.map((leaf) => [leaf.key, leaf])),
    objectPaths
  }
  const issues: ConfigDefaultTableIssue[] = []
  const documentedKeys = new Set<string>()
  const coveredSubtrees: string[] = []
  let keyTableCount = 0
  let documentedRowCount = 0
  let comparedRowCount = 0
  let exemptedRowCount = 0

  for (const root of roots) {
    const files = await collectTextFiles(input.repositoryRoot, root)
    const markdownFiles = files.filter((file) => file.path.endsWith('.md'))
    let rowsInRoot = 0

    for (const file of markdownFiles) {
      const rows = extractDocumentedDefaultRows(file)

      rowsInRoot += rows.length
      keyTableCount += countKeyTables(file)

      for (const row of rows) {
        documentedKeys.add(row.key)

        const result = checkDocumentedDefaultRow(row, inventory)

        comparedRowCount += result.compared ? 1 : 0
        exemptedRowCount += result.exempt ? 1 : 0

        if (result.coversSubtree) {
          coveredSubtrees.push(`${row.key}.`)
        }

        issues.push(...result.issues)
      }
    }

    documentedRowCount += rowsInRoot

    if (markdownFiles.length > 0 && rowsInRoot === 0) {
      issues.push({
        kind: 'no-tables-found',
        path: root,
        line: 1,
        message: `Scanned ${markdownFiles.length} Markdown file(s) under ${root} and read no documented configuration key at all. This root IS the configuration reference, so zero means the table parser stopped matching, not that the defaults are fine.`
      })
    }
  }

  // The direction that catches a new option shipping undocumented. Reported
  // against the reference root rather than a file, because the finding is that no
  // page carries the key — there is no line to point at.
  for (const leaf of leaves) {
    if (
      !documentedKeys.has(leaf.key) &&
      !coveredSubtrees.some((prefix) => leaf.key.startsWith(prefix))
    ) {
      issues.push({
        kind: 'undocumented-schema-key',
        path: roots[0] ?? 'docs',
        line: 1,
        message: `\`${leaf.key}\` exists in CodeReviewerConfigSchema and no reference table documents it. A user cannot discover an option that is not written down.`
      })
    }
  }

  return ConfigDefaultTableCheckResultSchema.parse({
    keyTableCount,
    documentedRowCount,
    comparedRowCount,
    exemptedRowCount,
    schemaLeafCount: leaves.length,
    issues
  })
}

/**
 * How many key tables a page carries.
 *
 * Counted separately from the rows so a test can pin BOTH: a parser that finds
 * every table but no row, and one that finds one table with every row, fail
 * different assertions.
 */
export const countKeyTables = (file: TextFile): number =>
  file.content
    .split('\n')
    .filter((line, index, lines) => {
      if (!tableRowPattern.test(line) || !isKeyTableHeader(splitRowCells(line))) {
        return false
      }

      return alignmentRowPattern.test(lines[index + 1] ?? '')
    }).length
