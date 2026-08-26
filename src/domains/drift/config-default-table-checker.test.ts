import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { CodeReviewerConfigSchema } from '../../shared/contracts/index.js'
import {
  checkConfigDefaultTables,
  checkDocumentedDefaultRow,
  configDefaultTableScanRoots,
  configSchemaInventory,
  countKeyTables,
  extractDocumentedDefaultRows,
  type DocumentedDefaultRow
} from './config-default-table-checker.js'
import { renderDocumentIssues } from './document-issue.js'
import type { TextFile } from './markdown-sources.js'

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..'
)

const referenceRoot = configDefaultTableScanRoots[0]

const markdown = (filePath: string, lines: readonly string[]): TextFile => ({
  path: filePath,
  content: lines.join('\n')
})

const inventory = () => {
  const { leaves, objectPaths } = configSchemaInventory()

  return {
    leavesByKey: new Map(leaves.map((leaf) => [leaf.key, leaf])),
    objectPaths
  }
}

const row = (overrides: Partial<DocumentedDefaultRow> = {}): DocumentedDefaultRow => ({
  path: 'docs/06-reference/configuration/review.md',
  line: 10,
  key: 'review.maxConcurrentTasks',
  documentedDefault: '`4`',
  ...overrides
})

describe('documented configuration defaults', () => {
  // THE GATE. The rendered issues are asserted first so a failure prints the
  // offending rows rather than a diff of two arrays.
  test('every documented default on the reference pages matches the schema', async () => {
    const result = await checkConfigDefaultTables({ repositoryRoot })

    expect(renderDocumentIssues(result.issues)).toBe('')
    expect(result.issues).toEqual([])
  })

  // ANTI-VACUITY, guard 1. A checker that finds nothing reports a clean result,
  // which reads exactly like a repository with no stale defaults. The floors sit
  // well under the real counts (24 tables, 104 rows at the time of writing) so
  // ordinary editing does not trip them; they are a tripwire, not a census.
  test('reads the reference tables in the numbers they actually contain', async () => {
    const result = await checkConfigDefaultTables({ repositoryRoot })

    expect(result.keyTableCount).toBeGreaterThanOrEqual(20)
    expect(result.documentedRowCount).toBeGreaterThanOrEqual(90)
    expect(result.comparedRowCount).toBeGreaterThanOrEqual(90)
    expect(result.schemaLeafCount).toBeGreaterThanOrEqual(100)
  })

  // ANTI-VACUITY, guard 2. Every row is accounted for: compared against the
  // schema, deliberately exempted, or reported. A parser that silently dropped
  // rows would keep the gate green and fail this.
  test('accounts for every row it read', async () => {
    const result = await checkConfigDefaultTables({ repositoryRoot })

    expect(result.comparedRowCount + result.exemptedRowCount).toBe(
      result.documentedRowCount
    )
  })

  // ANTI-VACUITY, guard 3. The table count is cross-checked against a dumber
  // independent scan of the same files, so the two have to stop working the same
  // way to agree on a wrong answer.
  test('sees exactly as many key tables as a plain line scan finds', async () => {
    const result = await checkConfigDefaultTables({ repositoryRoot })
    const pages = [
      'change-impact.md',
      'context-and-evaluation.md',
      'intent-fulfilment.md',
      'provider.md',
      'quality-gate-and-baseline.md',
      'reporting-and-observability.md',
      'review-conversation.md',
      'review.md',
      'security-and-verification.md'
    ]
    let independentCount = 0

    for (const page of pages) {
      const content = await readFile(
        path.join(repositoryRoot, referenceRoot, page),
        'utf8'
      )

      independentCount += content
        .split('\n')
        .filter((line) => /^\|\s*Key\s*\|\s*Type\s*\|\s*Default\s*\|/u.test(line))
        .length
    }

    expect(independentCount).toBeGreaterThan(0)
    expect(result.keyTableCount).toBe(independentCount)
  })

  // ANTI-VACUITY, guard 4. An exact count rather than a floor, because the next
  // exemption should be an argued decision: adding one means editing this line
  // and saying in the commit why the default cannot be written as a literal.
  test('carries exactly the three exemptions that were argued for', async () => {
    const result = await checkConfigDefaultTables({ repositoryRoot })

    expect(result.exemptedRowCount).toBe(3)
  })

  // WHY ZERO IS A FAILURE, from the other side: a root that holds Markdown and
  // yields no key table is reported rather than passed.
  test('reports a root that holds markdown but no key table', async () => {
    const result = await checkConfigDefaultTables({
      repositoryRoot,
      roots: ['docs/09-contributing']
    })

    expect(result.issues.map((issue) => issue.kind)).toContain('no-tables-found')
  })
})

// MUTATION TEST. A gate that passes is only evidence if it would have failed.
// Each of these changes ONE documented value and requires the check to fail
// NAMING THE KEY — a failure that does not say which of a hundred rows moved
// sends the reader through all of them.
describe('what the check would catch', () => {
  test('a documented default that no longer matches the schema', () => {
    const result = checkDocumentedDefaultRow(
      row({ documentedDefault: '`8`' }),
      inventory()
    )

    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]?.kind).toBe('documented-default-mismatch')
    expect(result.issues[0]?.message).toContain('review.maxConcurrentTasks')
    expect(result.issues[0]?.message).toContain('8')
    expect(result.issues[0]?.message).toContain('4')
  })

  test('a key documented as unset that the schema actually defaults', () => {
    const result = checkDocumentedDefaultRow(
      row({ documentedDefault: '*unset*' }),
      inventory()
    )

    expect(result.issues[0]?.kind).toBe('documented-default-mismatch')
    expect(result.issues[0]?.message).toContain('review.maxConcurrentTasks')
  })

  test('a key documented as defaulted that the schema leaves unset', () => {
    const result = checkDocumentedDefaultRow(
      row({ key: 'evaluation.judgeModel', documentedDefault: '`"gpt-5"`' }),
      inventory()
    )

    expect(result.issues[0]?.kind).toBe('documented-default-mismatch')
    expect(result.issues[0]?.message).toContain('evaluation.judgeModel')
  })

  test('a documented key the schema does not have', () => {
    const result = checkDocumentedDefaultRow(
      row({ key: 'review.maxConcurrentTask' }),
      inventory()
    )

    expect(result.issues[0]?.kind).toBe('documented-key-absent-from-schema')
    expect(result.issues[0]?.message).toContain('review.maxConcurrentTask')
  })

  // THE DIRECTION THAT CATCHES A NEW OPTION SHIPPING UNDOCUMENTED. Pointed at a
  // root with no tables at all, every schema leaf is undocumented — so the
  // coverage sweep produces one issue per leaf rather than quietly nothing.
  test('a schema key no page documents', async () => {
    const result = await checkConfigDefaultTables({
      repositoryRoot,
      roots: ['docs/09-contributing']
    })
    const undocumented = result.issues.filter(
      (issue) => issue.kind === 'undocumented-schema-key'
    )

    expect(undocumented).toHaveLength(result.schemaLeafCount)
    expect(undocumented.map((issue) => issue.message).join('\n')).toContain(
      'review.maxConcurrentTasks'
    )
  })

  // MUTATION TEST OVER THE SHIPPED PAGES, not over a fixture. Every real row that
  // documents a boolean is flipped in memory, one at a time, and each flip must
  // produce exactly one mismatch naming that key. A fixture proves the comparison
  // works on a fixture; this proves it works on the rows actually being checked,
  // and it is the guard that would catch an extractor that reads the pages but
  // resolves nothing.
  test('flipping any documented boolean on a real page is caught, by name', async () => {
    const schema = inventory()
    const page = await readFile(
      path.join(repositoryRoot, referenceRoot, 'review.md'),
      'utf8'
    )
    const rows = extractDocumentedDefaultRows(
      markdown(`${referenceRoot}/review.md`, page.split('\n'))
    ).filter((entry) => ['`true`', '`false`'].includes(entry.documentedDefault))

    expect(rows.length).toBeGreaterThanOrEqual(5)

    for (const entry of rows) {
      const flipped = checkDocumentedDefaultRow(
        {
          ...entry,
          documentedDefault: entry.documentedDefault === '`true`' ? '`false`' : '`true`'
        },
        schema
      )

      expect(flipped.issues).toHaveLength(1)
      expect(flipped.issues[0]?.kind).toBe('documented-default-mismatch')
      expect(flipped.issues[0]?.message).toContain(entry.key)
      // And the unflipped row still passes, so the assertion above is about the
      // flip rather than about the row being broken already.
      expect(checkDocumentedDefaultRow(entry, schema).issues).toEqual([])
    }
  })

  test('a default cell in none of the documented spellings', () => {
    const result = checkDocumentedDefaultRow(
      row({ documentedDefault: 'four' }),
      inventory()
    )

    expect(result.issues[0]?.kind).toBe('unreadable-default')
    expect(result.compared).toBe(false)
  })
})

describe('declaring an exemption', () => {
  test('an exemption without a reason is reported', () => {
    const result = checkDocumentedDefaultRow(
      row({
        key: 'paths.exclude',
        documentedDefault: 'see below <!-- no-literal-default n/a -->'
      }),
      inventory()
    )

    expect(result.issues[0]?.kind).toBe('unexplained-exemption')
    expect(result.exempt).toBe(false)
  })

  test('an argued exemption stops the comparison and nothing else', () => {
    const result = checkDocumentedDefaultRow(
      row({
        key: 'paths.exclude',
        documentedDefault:
          'see below <!-- no-literal-default the default is eighteen globs printed under the table -->'
      }),
      inventory()
    )

    expect(result.issues).toEqual([])
    expect(result.exempt).toBe(true)
    expect(result.compared).toBe(false)
  })

  // An exemption that names nothing exempts nothing, which is the escape hatch
  // turning into a skip list.
  test('an exemption on a key the schema does not have is reported', () => {
    const result = checkDocumentedDefaultRow(
      row({
        key: 'paths.excludes',
        documentedDefault:
          'see below <!-- no-literal-default the default is eighteen globs printed under the table -->'
      }),
      inventory()
    )

    expect(result.issues[0]?.kind).toBe('documented-key-absent-from-schema')
  })

  test('a subtree exemption covers the leaves beneath it', () => {
    const result = checkDocumentedDefaultRow(
      row({
        key: 'evaluation.regressionGate.overrides',
        documentedDefault:
          '`{}` <!-- covers-subtree the thresholds are documented as a profile table rather than as rows -->'
      }),
      inventory()
    )

    expect(result.issues).toEqual([])
    expect(result.coversSubtree).toBe(true)
  })

  // A nested object is not a settable leaf, and a row that states a default for
  // one without declaring the subtree is told exactly which of the two to do.
  test('a nested object documented as a leaf is reported with the remedy', () => {
    const result = checkDocumentedDefaultRow(
      row({ key: 'evaluation.regressionGate.overrides', documentedDefault: '`{}`' }),
      inventory()
    )

    expect(result.issues[0]?.kind).toBe('documented-key-absent-from-schema')
    expect(result.issues[0]?.message).toContain('covers-subtree')
  })
})

describe('reading a table', () => {
  // The Type column is full of escaped pipes. Splitting on a bare `|`
  // mis-columns those rows, and a mis-columned row reads its Type cell as its
  // Default cell — which would report a mismatch on a page that is correct.
  test('an escaped pipe in a cell does not shift the columns', () => {
    const rows = extractDocumentedDefaultRows(
      markdown('docs/06-reference/configuration/provider.md', [
        '| Key | Type | Default | What it does |',
        '| --- | --- | --- | --- |',
        '| `provider.id` | `"openai"` \\| `"bedrock"` | *required* | Adapter. |'
      ])
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]?.documentedDefault).toBe('*required*')
  })

  // How a cell is emphasised is a presentation choice, not a different claim.
  test('a bold-wrapped literal is the same claim as a plain one', () => {
    const result = checkDocumentedDefaultRow(
      row({ documentedDefault: '**`4`**' }),
      inventory()
    )

    expect(result.issues).toEqual([])
    expect(result.compared).toBe(true)
  })

  // The two single-row tables under `### \`review.signalFacts\`` and
  // `### \`review.citations\`` write their key as a bare `enabled`. The heading
  // carries the qualification, so nothing is guessed.
  test('a key relative to its section is qualified by the heading', () => {
    const rows = extractDocumentedDefaultRows(
      markdown('docs/06-reference/configuration/review.md', [
        '### `review.signalFacts`',
        '',
        '| Key | Type | Default | Meaning |',
        '| --- | --- | --- | --- |',
        '| `enabled` | boolean | `false` | Show discovery the signal facts. |'
      ])
    )

    expect(rows[0]?.key).toBe('review.signalFacts.enabled')
  })

  test('a table that is not a key table is left alone', () => {
    const file = markdown('docs/06-reference/configuration/review.md', [
      '| arm | product recall | adjusted precision |',
      '| --- | ---: | ---: |',
      '| control | 33% | 95% |'
    ])

    expect(extractDocumentedDefaultRows(file)).toEqual([])
    expect(countKeyTables(file)).toBe(0)
  })
})

// THE STATED GAP, pinned so it cannot grow in silence.
//
// `context-and-evaluation.md`'s context-provider union table has its own header
// (`` `type` | Key | Type | Default ``) and Key cells relative to a union member
// selected by the first column. Resolving those means walking a discriminated
// union and inventing an addressing scheme for array elements that no other row
// uses, for six rows. It is uncovered deliberately. This test asserts the shape
// still exists exactly once, so a SECOND uncovered table cannot appear without
// somebody re-reading this argument.
describe('the table shape this check does not read', () => {
  test('exactly one union-member table exists, on the page that argues for it', async () => {
    const files = [
      'change-impact.md',
      'context-and-evaluation.md',
      'intent-fulfilment.md',
      'provider.md',
      'quality-gate-and-baseline.md',
      'reporting-and-observability.md',
      'review-conversation.md',
      'review.md',
      'security-and-verification.md'
    ]
    const found: string[] = []

    for (const page of files) {
      const content = await readFile(
        path.join(repositoryRoot, referenceRoot, page),
        'utf8'
      )

      if (content.includes('| `type` | Key | Type | Default |')) {
        found.push(page)
      }
    }

    expect(found).toEqual(['context-and-evaluation.md'])
  })
})

// The default a page documents must be the one a user actually gets, so the
// checker reports the RESOLVED value wherever an empty config reaches the key and
// the schema's declared value only where it does not (`provider.*`, whose parent
// is optional). Both halves are pinned.
describe('the defaults the schema really carries', () => {
  const resolvedValueAt = (
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

  test('every reachable leaf reports the value an empty config resolves to', () => {
    const resolved = CodeReviewerConfigSchema.parse({}) as unknown
    const disagreements = configSchemaInventory()
      .leaves.filter((leaf) => {
        const effective = resolvedValueAt(resolved, leaf.key)

        return (
          effective !== undefined &&
          (!leaf.hasDefault ||
            JSON.stringify(leaf.defaultValue) !== JSON.stringify(effective.value))
        )
      })
      .map((leaf) => leaf.key)

    expect(disagreements).toEqual([])
  })

  // ANTI-VACUITY for the overlay itself. If the declared and resolved readings
  // agreed everywhere, the test above would pass with the overlay deleted. They
  // do not: `contextSources.providers` DECLARES `[{type:'inbox'},
  // {type:'changed-files'}]` and resolves to two fully populated objects, so a
  // page documenting the declared value would document something no run holds.
  test('at least one leaf genuinely differs between the two readings', () => {
    const declared = new Map<string, string>()

    for (const [key, child] of Object.entries(
      (CodeReviewerConfigSchema.shape.contextSources as never as {
        unwrap: () => { shape: Record<string, unknown> }
      })
        .unwrap()
        .shape
    )) {
      declared.set(
        key,
        JSON.stringify(
          (child as { def?: { defaultValue?: unknown } }).def?.defaultValue
        )
      )
    }

    const providers = configSchemaInventory().leaves.find(
      (leaf) => leaf.key === 'contextSources.providers'
    )

    expect(declared.get('providers')).toBe(
      '[{"type":"inbox"},{"type":"changed-files"}]'
    )
    expect(JSON.stringify(providers?.defaultValue)).not.toBe(
      declared.get('providers')
    )
    expect(providers?.defaultValue).toEqual(
      (CodeReviewerConfigSchema.parse({}) as { contextSources: { providers: unknown } })
        .contextSources.providers
    )
  })
})

describe('the checked corpus', () => {
  test('the contributing guide documents the convention', async () => {
    const guide = await readFile(
      path.join(
        repositoryRoot,
        'docs/09-contributing/running-tests-and-checks.md'
      ),
      'utf8'
    )

    expect(guide).toContain('config-default-table-checker')
    expect(guide).toContain('no-literal-default')
    expect(guide).toContain('covers-subtree')
  })
})
