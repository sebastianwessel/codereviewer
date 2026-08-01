// What the rendered report must communicate, asserted as behaviour rather than as
// a snapshot: a snapshot would pin the wording and let the MEANING drift with it,
// and the meaning is the whole deliverable here. Every test below names the
// reader's question it protects.

import { describe, expect, test } from 'vitest'
import { renderChangeImpactMarkdown } from './impact-markdown.js'
import {
  ChangeImpactReferenceReportSchema,
  type ChangeImpactReferenceReport,
  type ChangedSymbolReferences
} from './impact-report.js'

const symbol = (
  overrides: Partial<ChangedSymbolReferences> & { readonly name: string }
): ChangedSymbolReferences => ({
  kind: 'export',
  language: 'typescript',
  definitionPath: `src/${overrides.name}.ts`,
  definitionLine: 10,
  changeKind: 'modified',
  contractChanges: [],
  references: [],
  testReferences: [],
  referencesInDefinitionFile: 0,
  referencesInNonSourceFiles: 0,
  referencesTruncated: false,
  ...overrides
})

// Built through the schema so a test can never assert over a report shape the
// command could not actually produce.
const report = (
  symbols: readonly ChangedSymbolReferences[],
  overrides: {
    readonly status?: ChangeImpactReferenceReport['status']
    readonly warnings?: readonly string[]
    readonly changedSymbolsTruncated?: boolean
  } = {}
): ChangeImpactReferenceReport =>
  ChangeImpactReferenceReportSchema.parse({
    schemaVersion: '1.1',
    status: overrides.status ?? 'completed',
    generatedAt: '2026-08-01T10:00:00.000Z',
    scope: {
      baseRef: 'main',
      headRef: 'HEAD',
      changedFileCount: symbols.length,
      deletedFileCount: 0
    },
    summary: {
      changedSymbolCount: symbols.length,
      changedSymbolsTruncated: overrides.changedSymbolsTruncated ?? false,
      referencedSymbolCount: symbols.filter(
        (entry) =>
          entry.references.length > 0 || entry.testReferences.length > 0
      ).length,
      referenceCount: symbols.reduce(
        (total, entry) => total + entry.references.length,
        0
      ),
      testReferenceCount: symbols.reduce(
        (total, entry) => total + entry.testReferences.length,
        0
      ),
      nonSourceReferenceCount: symbols.reduce(
        (total, entry) => total + entry.referencesInNonSourceFiles,
        0
      )
    },
    symbols,
    warnings: overrides.warnings ?? []
  })

const site = (path: string, line: number, text: string) => ({
  path,
  line,
  text
})

describe('change-impact Markdown', () => {
  test('leads with the symbol whose contract changed and has dependents', () => {
    const rendered = renderChangeImpactMarkdown(
      report([
        symbol({
          name: 'quiet',
          references: [site('src/caller.ts', 4, 'quiet()')]
        }),
        symbol({
          name: 'loud',
          contractChanges: [
            'may now yield an absent value (null/nil/None) where it previously did not'
          ],
          references: [site('src/caller.ts', 9, 'loud()')]
        })
      ])
    )

    // Order is the report's argument. A reviewer reads from the top and stops, so
    // the symbol whose contract moved AND which has callers must be above the one
    // that only has callers, whatever order the engine emitted them in.
    expect(rendered.indexOf('`loud`')).toBeLessThan(rendered.indexOf('`quiet`'))
    expect(rendered.indexOf('Contract changed, and it has dependents')).toBeLessThan(
      rendered.indexOf('Dependents found, no contract change detected')
    )
    // Escaped rather than raw: contract statements are prose, and prose goes
    // through the same Markdown escaping every other report here applies, so a
    // statement can never inject a link, an image or a heading.
    expect(rendered).toContain('may now yield an absent value')
    expect(rendered).toContain(
      '- may now yield an absent value \\(null/nil/None\\) where it previously did not'
    )
  })

  test('separates production dependents from tests', () => {
    const rendered = renderChangeImpactMarkdown(
      report([
        symbol({
          name: 'fetchUser',
          contractChanges: ['may now fail where it previously did not'],
          references: [site('src/caller.ts', 3, 'fetchUser()')],
          testReferences: [site('src/caller.test.ts', 7, 'fetchUser()')]
        })
      ])
    )
    const dependents = rendered.indexOf('#### Dependents')
    const tests = rendered.indexOf('#### Tests')

    // A broken caller shows up in production and a broken test shows up in CI.
    // They must never be readable as one list.
    expect(dependents).toBeGreaterThan(-1)
    expect(tests).toBeGreaterThan(dependents)
    expect(
      rendered.slice(dependents, tests).includes('src/caller.test.ts')
    ).toBe(false)
    expect(rendered.slice(tests).includes('src/caller.test.ts')).toBe(true)
  })

  test('groups sites by the file they landed in', () => {
    const rendered = renderChangeImpactMarkdown(
      report([
        symbol({
          name: 'scheme',
          references: [
            site('src/a.ts', 3, 'scheme()'),
            site('src/a.ts', 40, 'scheme()'),
            site('src/b.ts', 8, 'scheme()')
          ]
        })
      ])
    )

    expect(rendered).toContain('#### Dependents (3 sites in 2 files)')
    expect(rendered).toContain('- `src/a.ts`\n  - line 3: `scheme()`\n  - line 40: `scheme()`')
  })

  test('surfaces truncation, definition-file and non-source counts', () => {
    const rendered = renderChangeImpactMarkdown(
      report(
        [
          symbol({
            name: 'scheme',
            references: [site('src/a.ts', 3, 'scheme()')],
            referencesInDefinitionFile: 5,
            referencesInNonSourceFiles: 12,
            referencesTruncated: true
          })
        ],
        { changedSymbolsTruncated: true }
      )
    )

    // The report must never look cleaner than the search actually was.
    expect(rendered).toContain('per-symbol reference cap was reached')
    expect(rendered).toContain('5 references inside the defining file')
    expect(rendered).toContain('12 matches in files no language adapter recognises as source')
    expect(rendered).toContain('the seed cap was reached')
  })

  test('carries the report warnings', () => {
    const rendered = renderChangeImpactMarkdown(
      report([], { warnings: ['No changed symbols were seeded.'] })
    )

    expect(rendered).toContain('## Warnings')
    expect(rendered).toContain('No changed symbols were seeded.')
  })

  test('never phrases an absent contract change as safety', () => {
    const rendered = renderChangeImpactMarkdown(
      report([
        symbol({ name: 'quiet', references: [site('src/a.ts', 2, 'quiet()')] }),
        symbol({ name: 'alone' })
      ])
    )

    // The failure this guards against is a reader taking "nothing detected" for
    // "nothing wrong". Both places an empty `contractChanges` is rendered must say
    // what it actually means, and neither may claim safety.
    expect(rendered).toContain(
      'it is NOT a statement that the change is safe'
    )
    expect(rendered).not.toMatch(/\bsafe to\b|\bno impact\b|\bunaffected\b/iu)
  })

  test('renders a symbol with neither a contract change nor a dependent as a footnote', () => {
    const rendered = renderChangeImpactMarkdown(
      report([symbol({ name: 'alone', definitionLine: 42 })])
    )

    expect(rendered).toContain('## Other changed symbols')
    expect(rendered).toContain('- `alone` - `src/alone.ts:42` (modified)')
    // A footnote, not a section of its own with reference headings.
    expect(rendered).not.toContain('#### Dependents')
  })

  test('renders a report with no symbols as an answer rather than an empty document', () => {
    const rendered = renderChangeImpactMarkdown(report([]))

    expect(rendered).toContain('# Change Impact Report')
    expect(rendered).toContain('- Changed symbols: 0')
    expect(rendered).toContain('No changed symbol was seeded from this range')
  })

  test('says a disabled run analysed nothing rather than found nothing', () => {
    const rendered = renderChangeImpactMarkdown(
      report([], {
        status: 'disabled',
        warnings: ['Change-impact review is disabled.']
      })
    )

    // The distinction the schema's `disabled` status exists to preserve: an empty
    // report from a capability that never ran must not read as "nothing depends on
    // your change".
    expect(rendered).toContain('- Status: disabled')
    expect(rendered).toContain('nothing was analysed')
  })

  test('renders matched source text as code, and cannot be broken out of', () => {
    const rendered = renderChangeImpactMarkdown(
      report([
        symbol({
          name: 'render',
          references: [
            site('src/a.ts', 1, 'render(`${x}`) // *emphasis* [link](x)')
          ]
        })
      ])
    )

    // Source is rendered verbatim inside a code span rather than escaped
    // character by character, so a reader reads code instead of backslashes — and
    // the span's delimiter outgrows any backtick run in the text.
    expect(rendered).toContain('``render(`${x}`) // *emphasis* [link](x)``')
  })

  test('redacts a secret that reached a matched line', () => {
    const rendered = renderChangeImpactMarkdown(
      report([
        symbol({
          name: 'token',
          references: [
            site('src/a.ts', 1, 'const token = "sk-proj-abcdefghijklmnopqrstuvwxyz"')
          ]
        })
      ])
    )

    expect(rendered).not.toContain('sk-proj-abcdefghijklmnopqrstuvwxyz')
  })
})
