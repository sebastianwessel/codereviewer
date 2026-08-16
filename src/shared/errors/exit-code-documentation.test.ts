import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { StructuredErrorCategorySchema } from '../contracts/cli/cli-output.schema.js'
import { createStructuredError } from './error-normalizer.js'

// `docs/06-reference/exit-codes-and-error-codes.md` calls itself "the single place
// these are listed", and its category table had drifted from this module in three
// ways at once: `input-limit` was missing from the table entirely, and two
// paragraphs told the reader the `intent check` refusals were category `config`
// while a third — on the same page — correctly said `input-limit`.
//
// Nothing caught it. The drift checker reads links and fenced JSON blocks; a
// Markdown table cell is neither. This test is the cheapest possible pin: the
// category column of that one table, against the pairing `createStructuredError`
// derives. It deliberately checks nothing else on the page, because a checker
// broad enough to be interesting is one people start exempting.
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..'
)

const documentPath = path.join(
  'docs',
  '06-reference',
  'exit-codes-and-error-codes.md'
)

const sectionHeading = '## Category → exit code / recoverability'

type DocumentedCategory = {
  readonly category: string
  readonly exitCode: string
  readonly recoverable: string
}

// The rows of the table that follows `sectionHeading`, read as cells. The parse is
// deliberately literal: a row it cannot read is one the assertions below never see,
// so the shape it expects is asserted (three columns, one row per category) rather
// than assumed.
const documentedCategories = (markdown: string): readonly DocumentedCategory[] => {
  const section = markdown.split(sectionHeading)[1]

  if (section === undefined) {
    throw new Error(
      `${documentPath} has no "${sectionHeading}" section; the exit-code table moved or was renamed.`
    )
  }

  const rows: DocumentedCategory[] = []

  for (const line of section.split('\n')) {
    const trimmed = line.trim()

    if (!trimmed.startsWith('|')) {
      // The table ends at the first non-row line after it started.
      if (rows.length > 0) {
        break
      }
      continue
    }

    const cells = trimmed
      .slice(1, trimmed.endsWith('|') ? -1 : undefined)
      .split('|')
      .map((cell) => cell.trim())
    const [category, exitCode, recoverable] = cells

    if (
      cells.length !== 3 ||
      category === undefined ||
      exitCode === undefined ||
      recoverable === undefined ||
      // The header row and its `| --- |` separator.
      !category.startsWith('`')
    ) {
      continue
    }

    rows.push({
      category: category.replaceAll('`', ''),
      exitCode: exitCode.replaceAll('`', ''),
      recoverable
    })
  }

  return rows
}

describe('documented error categories', () => {
  test('the category table states this module’s exit code and recoverability', async () => {
    const markdown = await readFile(
      path.join(repositoryRoot, documentPath),
      'utf8'
    )
    const rows = documentedCategories(markdown)
    const categories = StructuredErrorCategorySchema.options

    // Every category is documented, and nothing that is not a category is.
    expect([...rows].map((row) => row.category).sort()).toEqual(
      [...categories].sort()
    )

    for (const row of rows) {
      const category = StructuredErrorCategorySchema.parse(row.category)
      const structured = createStructuredError({
        code: 'documented_category_probe',
        message: 'Probe.',
        category
      })

      expect(row.exitCode, `documented exit code for ${category}`).toBe(
        String(structured.exitCode)
      )
      expect(row.recoverable, `documented recoverability for ${category}`).toBe(
        structured.recoverable ? 'yes' : 'no'
      )
    }
  })
})
