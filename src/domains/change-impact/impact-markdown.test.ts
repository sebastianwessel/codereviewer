// What the rendered report must communicate, asserted as behaviour rather than as
// a snapshot: a snapshot would pin the wording and let the MEANING drift with it,
// and the meaning is the whole deliverable here. Every test below names the
// reader's question it protects.

import { describe, expect, test } from 'vitest'
import { renderChangeImpactMarkdown } from './impact-markdown.js'
import {
  ChangeImpactReferenceReportSchema,
  type ChangeImpactReferenceReport,
  type ChangedSymbolReport,
  type ImpactedFile,
  type ImpactFinding
} from './impact-report.js'

const changedSymbol = (
  overrides: Partial<ChangedSymbolReport> & { readonly name: string }
): ChangedSymbolReport => ({
  kind: 'export',
  language: 'typescript',
  definitionPath: `src/${overrides.name}.ts`,
  definitionLine: 10,
  changeKind: 'modified',
  contractChanges: [],
  referencesInDefinitionFile: 0,
  referencesInNonSourceFiles: 0,
  referencesTruncated: false,
  referenceSearchTruncated: false,
  ...overrides
})

// A destination file referencing one changed symbol, addressed the way the report
// addresses it: by the symbol's definition triple.
const impactedFile = (
  path: string,
  symbol: ChangedSymbolReport,
  sites: readonly { readonly line: number; readonly text: string }[]
): ImpactedFile => ({
  path,
  symbols: [
    {
      name: symbol.name,
      definitionPath: symbol.definitionPath,
      definitionLine: symbol.definitionLine,
      sites: [...sites]
    }
  ]
})

// Built through the schema so a test can never assert over a report shape the
// command could not actually produce.
const report = (input: {
  readonly changedSymbols?: readonly ChangedSymbolReport[]
  readonly impactedFiles?: readonly ImpactedFile[]
  readonly impactedTestFiles?: readonly ImpactedFile[]
  readonly status?: ChangeImpactReferenceReport['status']
  readonly adjudicationStatus?: ChangeImpactReferenceReport['adjudicationStatus']
  readonly impactFindings?: readonly ImpactFinding[]
  readonly deterministicNoImpactPairCount?: number
  readonly modelNoImpactPairCount?: number
  readonly adjudicationCallCount?: number
  readonly unadjudicatedPairCount?: number
  readonly warnings?: readonly string[]
  readonly changedSymbolsTruncated?: boolean
}): ChangeImpactReferenceReport => {
  const changedSymbols = input.changedSymbols ?? []
  const impactedFiles = input.impactedFiles ?? []
  const impactedTestFiles = input.impactedTestFiles ?? []
  const sites = (files: readonly ImpactedFile[]): number =>
    files.reduce(
      (total, file) =>
        total +
        file.symbols.reduce(
          (fileTotal, symbol) => fileTotal + symbol.sites.length,
          0
        ),
      0
    )

  const impactFindings = input.impactFindings ?? []
  const modelNoImpactPairCount = input.modelNoImpactPairCount ?? 0
  const reliances = impactFindings.flatMap((finding) => finding.reliances)
  const modelRelianceCount = reliances.filter(
    (reliance) => reliance.adjudicatedBy === 'model'
  ).length
  // Every model-answered pair cost a call, so the default keeps the two
  // consistent rather than letting a test assert over a report the engine could
  // not have produced.
  const adjudicationCallCount =
    input.adjudicationCallCount ?? modelRelianceCount + modelNoImpactPairCount

  return ChangeImpactReferenceReportSchema.parse({
    schemaVersion: '3.0',
    status: input.status ?? 'completed',
    adjudicationStatus:
      input.adjudicationStatus ??
      (input.status === 'disabled' ? 'disabled' : 'completed'),
    generatedAt: '2026-08-01T10:00:00.000Z',
    scope: {
      baseRef: 'main',
      headRef: 'HEAD',
      changedFileCount: changedSymbols.length,
      deletedFileCount: 0
    },
    summary: {
      changedSymbolCount: changedSymbols.length,
      changedSymbolsTruncated: input.changedSymbolsTruncated ?? false,
      referencedSymbolCount: new Set(
        [...impactedFiles, ...impactedTestFiles].flatMap((file) =>
          file.symbols.map((symbol) => symbol.name)
        )
      ).size,
      impactedFileCount: impactedFiles.length,
      impactedTestFileCount: impactedTestFiles.length,
      referenceCount: sites(impactedFiles),
      testReferenceCount: sites(impactedTestFiles),
      nonSourceReferenceCount: changedSymbols.reduce(
        (total, symbol) => total + symbol.referencesInNonSourceFiles,
        0
      ),
      impactFindingCount: impactFindings.length,
      reliedUponPairCount: reliances.length,
      deterministicNoImpactPairCount: input.deterministicNoImpactPairCount ?? 0,
      unadjudicatedPairCount: input.unadjudicatedPairCount ?? 0,
      adjudicationCallCount,
      failedAdjudicationCallCount: 0,
      modelVerdictCounts: {
        relies: modelRelianceCount,
        'does-not-rely': modelNoImpactPairCount,
        undetermined: 0
      },
      adjudicationCallsTruncated: false,
      rejectedFindingCount: 0
    },
    changedSymbols,
    impactFindings,
    impactedFiles,
    impactedTestFiles,
    warnings: input.warnings ?? []
  })
}

describe('change-impact Markdown', () => {
  // Spec 22's file-granularity requirement, at the level a reader experiences it:
  // the document's unit of work is a file to open, not a symbol to trace.
  test('leads with the destination files and nests their sites', () => {
    const scheme = changedSymbol({ name: 'scheme' })
    const rendered = renderChangeImpactMarkdown(
      report({
        changedSymbols: [scheme],
        impactedFiles: [
          impactedFile('src/a.ts', scheme, [
            { line: 3, text: 'scheme()' },
            { line: 40, text: 'scheme()' }
          ]),
          impactedFile('src/b.ts', scheme, [{ line: 8, text: 'scheme()' }])
        ]
      })
    )

    // One heading per file, the sites beneath it, and the changed symbol reaching
    // it named on it.
    expect(rendered).toContain('### `src/a.ts`')
    expect(rendered).toContain('1 changed symbol used here, at 2 sites.')
    expect(rendered).toContain('- `scheme` - defined at `src/scheme.ts:10`')
    expect(rendered).toContain('  - line 3: `scheme()`')
    expect(rendered).toContain('  - line 40: `scheme()`')
    expect(rendered.indexOf('### `src/a.ts`')).toBeLessThan(
      rendered.indexOf('### `src/b.ts`')
    )
    // The file list is above the symbol table: files are what a reviewer works
    // through, and the symbol table answers "and what about the rest".
    expect(rendered.indexOf('### `src/a.ts`')).toBeLessThan(
      rendered.indexOf('## Changed symbols')
    )
    expect(rendered).toContain('- Files to look at: 2 (plus 0 test)')
  })

  test('leads with the files using a symbol whose contract changed', () => {
    const quiet = changedSymbol({ name: 'quiet' })
    const loud = changedSymbol({
      name: 'loud',
      contractChanges: [
        'may now yield an absent value (null/nil/None) where it previously did not'
      ]
    })
    const rendered = renderChangeImpactMarkdown(
      report({
        changedSymbols: [quiet, loud],
        impactedFiles: [
          impactedFile('src/quiet-caller.ts', quiet, [
            { line: 4, text: 'quiet()' }
          ]),
          impactedFile('src/loud-caller.ts', loud, [
            { line: 9, text: 'loud()' }
          ])
        ]
      })
    )

    // Order is the report's argument. A reviewer reads from the top and stops, so
    // the file using a symbol whose contract moved must be above the one using a
    // symbol that only changed, whatever order the engine emitted them in.
    expect(rendered.indexOf('`src/loud-caller.ts`')).toBeLessThan(
      rendered.indexOf('`src/quiet-caller.ts`')
    )
    expect(
      rendered.indexOf('Files using a symbol whose contract changed')
    ).toBeLessThan(
      rendered.indexOf('Files using a changed symbol, no contract change detected')
    )
    // Escaped rather than raw: contract statements are prose, and prose goes
    // through the same Markdown escaping every other report here applies, so a
    // statement can never inject a link, an image or a heading.
    expect(rendered).toContain(
      '- may now yield an absent value \\(null/nil/None\\) where it previously did not'
    )
  })

  test('separates production files from test files', () => {
    const fetchUser = changedSymbol({
      name: 'fetchUser',
      contractChanges: ['may now fail where it previously did not']
    })
    const rendered = renderChangeImpactMarkdown(
      report({
        changedSymbols: [fetchUser],
        impactedFiles: [
          impactedFile('src/caller.ts', fetchUser, [
            { line: 3, text: 'fetchUser()' }
          ])
        ],
        impactedTestFiles: [
          impactedFile('src/caller.test.ts', fetchUser, [
            { line: 7, text: 'fetchUser()' }
          ])
        ]
      })
    )
    const tests = rendered.indexOf('## Test files')

    // A broken caller shows up in production and a broken test shows up in CI.
    // They must never be readable as one list.
    expect(tests).toBeGreaterThan(rendered.indexOf('### `src/caller.ts`'))
    expect(rendered.slice(0, tests).includes('src/caller.test.ts')).toBe(false)
    expect(rendered.slice(tests).includes('src/caller.test.ts')).toBe(true)
  })

  test('surfaces truncation, definition-file and non-source counts', () => {
    const scheme = changedSymbol({
      name: 'scheme',
      referencesInDefinitionFile: 5,
      referencesInNonSourceFiles: 12,
      referencesTruncated: true,
      referenceSearchTruncated: false
    })
    const rendered = renderChangeImpactMarkdown(
      report({
        changedSymbols: [scheme],
        impactedFiles: [
          impactedFile('src/a.ts', scheme, [{ line: 3, text: 'scheme()' }])
        ],
        changedSymbolsTruncated: true
      })
    )

    // The report must never look cleaner than the search actually was.
    expect(rendered).toContain('more dependent sites were found than the per-symbol cap lists')
    expect(rendered).toContain('5 references inside the defining file')
    expect(rendered).toContain(
      '12 matches in files no language adapter recognises as source'
    )
    expect(rendered).toContain('the seed cap was reached')
  })

  // Two cuts, two claims. A ranked list shortened by the cap was fully examined;
  // a search stopped at its match bound was not, and the withheld counts beside
  // it describe only the part that was. Rendering both as "truncated" would let a
  // reader discount the second as the first.
  test('words a shortened list and an unfinished search apart', () => {
    const shortened = renderChangeImpactMarkdown(
      report({
        changedSymbols: [
          changedSymbol({
            name: 'scheme',
            referencesTruncated: true,
            referenceSearchTruncated: false
          })
        ]
      })
    )
    const unfinished = renderChangeImpactMarkdown(
      report({
        changedSymbols: [
          changedSymbol({
            name: 'scheme',
            referencesTruncated: false,
            referenceSearchTruncated: true
          })
        ]
      })
    )

    expect(shortened).toContain('the ranked head of them')
    expect(shortened).not.toContain('never examined')
    expect(unfinished).toContain('never examined')
    expect(unfinished).not.toContain('the ranked head of them')
  })

  test('carries the report warnings', () => {
    const rendered = renderChangeImpactMarkdown(
      report({ warnings: ['No changed symbols were seeded.'] })
    )

    expect(rendered).toContain('## Warnings')
    expect(rendered).toContain('No changed symbols were seeded.')
  })

  test('never phrases an absent contract change as safety', () => {
    const quiet = changedSymbol({ name: 'quiet' })
    const rendered = renderChangeImpactMarkdown(
      report({
        changedSymbols: [quiet, changedSymbol({ name: 'alone' })],
        impactedFiles: [
          impactedFile('src/a.ts', quiet, [{ line: 2, text: 'quiet()' }])
        ]
      })
    )

    // The failure this guards against is a reader taking "nothing detected" for
    // "nothing wrong". Both places an empty `contractChanges` is rendered must say
    // what it actually means, and neither may claim safety.
    expect(rendered).toContain('it is NOT a statement that the change is safe')
    expect(rendered).not.toMatch(/\bsafe to\b|\bno impact\b|\bunaffected\b/iu)
  })

  test('names a changed symbol nothing was found to use rather than dropping it', () => {
    const rendered = renderChangeImpactMarkdown(
      report({
        changedSymbols: [changedSymbol({ name: 'alone', definitionLine: 42 })]
      })
    )

    // A symbol with no dependent has no file to appear under, so the symbol table
    // is the only place a reader can see that the engine looked at it at all.
    expect(rendered).toContain('## Changed symbols')
    expect(rendered).toContain('- `alone` - `src/alone.ts:42` (modified, export, typescript)')
    expect(rendered).toContain('No listed dependent.')
  })

  test('renders a report with no symbols as an answer rather than an empty document', () => {
    const rendered = renderChangeImpactMarkdown(report({}))

    expect(rendered).toContain('# Change Impact Report')
    expect(rendered).toContain('- Changed symbols: 0')
    expect(rendered).toContain('No changed symbol was seeded from this range')
  })

  // Spec 22 design step 3, at the level a reader experiences it. The findings
  // section leads the document because it is the only list whose entries were
  // checked against what changed; the reference lists under it are the untriaged
  // floor, and published rates put an untriaged list near 90% irrelevant.
  describe('the adjudicated layer', () => {
    const scheme = changedSymbol({ name: 'scheme' })
    const finding: ImpactFinding = {
      id: 'impact_abc',
      path: 'src/a.ts',
      destination: 'production',
      compatibilityClass: 'breaks-at-runtime',
      reliances: [
        {
          symbolName: 'scheme',
          definitionPath: 'src/scheme.ts',
          definitionLine: 10,
          line: 3,
          contractElement: 'scheme may now yield an absent value',
          consequence: 'a use here that assumes a value is present fails',
          adjudicatedBy: 'model'
        }
      ]
    }

    test('leads with the dependents shown to rely, naming the line and the reason', () => {
      const rendered = renderChangeImpactMarkdown(
        report({
          changedSymbols: [scheme],
          impactedFiles: [
            impactedFile('src/a.ts', scheme, [{ line: 3, text: 'scheme()' }])
          ],
          impactFindings: [finding]
        })
      )

      expect(rendered).toContain('## Dependents shown to rely on the change (1 file)')
      expect(rendered.indexOf('Dependents shown to rely')).toBeLessThan(
        rendered.indexOf('Files using a changed symbol')
      )
      // Spec 22: findings carry the dependent's path and line, the contract
      // element relied upon, and the consequence. All four, in one line.
      expect(rendered).toContain(
        '- line 3: `scheme` - relies on scheme may now yield an absent value; a use here that assumes a value is present fails (model)'
      )
      // The class states a MECHANISM, not a rating. Printing the bare token would
      // hand a reader a severity by another name.
      expect(rendered).toContain('Breaks at runtime - the name still resolves')
      // Evidence, not verdict, and honest about being unmeasured.
      expect(rendered).toContain('It is evidence, not a verdict')
      expect(rendered).toContain('UNMEASURED')
    })

    test('says nothing was shown to rely when the check ran and found nothing', () => {
      const rendered = renderChangeImpactMarkdown(
        report({
          changedSymbols: [scheme],
          impactedFiles: [
            impactedFile('src/a.ts', scheme, [{ line: 3, text: 'scheme()' }])
          ],
          modelNoImpactPairCount: 1
        })
      )

      // Spec 22: the command MUST be able to report NO IMPACT. An empty list is an
      // ANSWER here, and the document has to say which of the three kinds of empty
      // it is.
      expect(rendered).toContain('1 dependent use was checked')
      expect(rendered).toContain(
        'none was shown to rely on the part of the contract that changed'
      )
      // And WHICH tier checked it. One model call was spent and it answered.
      expect(rendered).toContain('1 adjudication call was made')
      expect(rendered).toContain('1 "does not rely"')
    })

    // THE VOIDED RUN'S SHAPE, at the surface a user reads. Spec 22's first
    // adjudication measurement removed every dependent it was given without ever
    // calling the model; the document said nothing about that, and the removals
    // read as the judge's rejections.
    test('an empty finding list from a run that made no call says the model never ran', () => {
      const rendered = renderChangeImpactMarkdown(
        report({
          changedSymbols: [scheme],
          impactedFiles: [
            impactedFile('src/a.ts', scheme, [{ line: 3, text: 'scheme()' }]),
            impactedFile('src/b.ts', scheme, [{ line: 9, text: 'scheme()' }])
          ],
          deterministicNoImpactPairCount: 2,
          adjudicationCallCount: 0
        })
      )

      expect(rendered).toContain('The model tier was never called on this change')
      expect(rendered).toContain(
        '- Adjudication model calls: none — the model tier was never called'
      )
      expect(rendered).toContain(
        '- Dependent uses the deterministic tier settled without a model call: 2'
      )
      expect(rendered).toContain(
        '- Dependent uses the model checked and found not to rely: 0'
      )
      // Absence is never zero: the sentence must not read as a model that looked
      // and cleared two dependents.
      expect(rendered).not.toContain('2 adjudication calls were made')
    })

    test('separates the tiers in the summary rather than pooling them', () => {
      const rendered = renderChangeImpactMarkdown(
        report({
          changedSymbols: [scheme],
          impactedFiles: [
            impactedFile('src/a.ts', scheme, [{ line: 3, text: 'scheme()' }])
          ],
          deterministicNoImpactPairCount: 4,
          modelNoImpactPairCount: 1
        })
      )

      expect(rendered).toContain(
        '- Dependent uses the deterministic tier settled without a model call: 4'
      )
      expect(rendered).toContain(
        '- Dependent uses the model checked and found not to rely: 1'
      )
      expect(rendered).toContain(
        '- Adjudication model calls: 1 (relies 0, does not rely 1, unusable 0, failed 0)'
      )
      // The pooled line the two replaced must not come back.
      expect(rendered).not.toContain('Dependent uses checked and found not to rely')
    })

    test('says an off adjudicator checked nothing, rather than found nothing', () => {
      const rendered = renderChangeImpactMarkdown(
        report({ adjudicationStatus: 'disabled' })
      )

      expect(rendered).toContain('Adjudication is switched off')
      expect(rendered).toContain(
        'This is not a report that nothing depends on the change.'
      )
      // A switched-off adjudicator has no call count to print, and printing `0`
      // would read as a run that tried.
      expect(rendered).toContain(
        '- Adjudication model calls: not run (adjudication is switched off)'
      )
    })

    test('discloses unadjudicated dependents beside the findings', () => {
      const rendered = renderChangeImpactMarkdown(
        report({
          changedSymbols: [scheme],
          impactedFiles: [
            impactedFile('src/a.ts', scheme, [{ line: 3, text: 'scheme()' }])
          ],
          impactFindings: [finding],
          unadjudicatedPairCount: 4
        })
      )

      // A short list must never look like a complete one. Absence from the
      // findings is not a statement that a dependent is unaffected.
      expect(rendered).toContain('4 dependent uses were left unadjudicated')
      expect(rendered).toContain(
        'Absence here is not a statement that a dependent is unaffected.'
      )
    })

    test('labels a test dependent as breaking in CI rather than production', () => {
      const rendered = renderChangeImpactMarkdown(
        report({
          changedSymbols: [scheme],
          impactedTestFiles: [
            impactedFile('src/a.test.ts', scheme, [
              { line: 3, text: 'scheme()' }
            ])
          ],
          impactFindings: [
            {
              ...finding,
              path: 'src/a.test.ts',
              destination: 'test',
              compatibilityClass: 'breaks-on-build'
            }
          ]
        })
      )

      expect(rendered).toContain(
        'This is a test file, so it breaks in CI rather than in production.'
      )
    })
  })

  test('says a disabled run analysed nothing rather than found nothing', () => {
    const rendered = renderChangeImpactMarkdown(
      report({
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

  describe('a removed symbol', () => {
    const gone = changedSymbol({
      name: 'legacyApi',
      definitionPath: 'src/legacy.ts',
      definitionLine: 1,
      changeKind: 'deleted',
      removalPairing: { match: 'none' }
    })

    test('states a confident removal when every added declaration was searched', () => {
      const rendered = renderChangeImpactMarkdown(
        report({
          changedSymbols: [gone],
          impactedFiles: [
            impactedFile('src/caller.ts', gone, [
              { line: 2, text: 'legacyApi()' }
            ])
          ]
        })
      )

      expect(rendered).toContain(
        'no declaration of this name is added by this change in any file this engine can read'
      )
    })

    test('states a move rather than a deletion when the name reappears', () => {
      const moved = changedSymbol({
        ...gone,
        changeKind: 'moved',
        removalPairing: {
          match: 'same-name',
          declaration: { name: 'legacyApi', path: 'src/api.ts', line: 12 }
        }
      })
      const rendered = renderChangeImpactMarkdown(
        report({
          changedSymbols: [moved],
          impactedFiles: [
            impactedFile('src/caller.ts', moved, [
              { line: 2, text: 'legacyApi()' }
            ])
          ]
        })
      )

      // Reporting a rename or a move as a deletion applies the most severe
      // category this report has to a refactoring. The new address is what makes
      // the difference actionable.
      expect(rendered).toContain('`src/api.ts:12`')
      expect(rendered).toContain('rather than a deletion')
      expect(rendered).not.toContain('Everything listed below depends on a symbol that is gone')
    })

    test('does not present an unverifiable removal as a verified one', () => {
      const unverified = changedSymbol({
        ...gone,
        removalPairing: {
          match: 'inconclusive',
          reason: '2 changed file(s) could not be read.'
        }
      })
      const rendered = renderChangeImpactMarkdown(
        report({ changedSymbols: [unverified] })
      )

      // The recurring defect class this codebase names: a missing input must not
      // produce the confident answer. "We could not check" and "we checked and
      // found nothing" are different statements and the reader gets the right one.
      expect(rendered).toContain('could NOT be determined')
      expect(rendered).toContain('2 changed file\\(s\\) could not be read.')
      expect(rendered).not.toContain(
        'no declaration of this name is added by this change in any file this engine can read'
      )
    })
  })

  test('renders matched source text as code, and cannot be broken out of', () => {
    const render = changedSymbol({ name: 'render' })
    const rendered = renderChangeImpactMarkdown(
      report({
        changedSymbols: [render],
        impactedFiles: [
          impactedFile('src/a.ts', render, [
            { line: 1, text: 'render(`${x}`) // *emphasis* [link](x)' }
          ])
        ]
      })
    )

    // Source is rendered verbatim inside a code span rather than escaped
    // character by character, so a reader reads code instead of backslashes — and
    // the span's delimiter outgrows any backtick run in the text.
    expect(rendered).toContain('``render(`${x}`) // *emphasis* [link](x)``')
  })

  test('redacts a secret that reached a matched line', () => {
    const token = changedSymbol({ name: 'token' })
    const rendered = renderChangeImpactMarkdown(
      report({
        changedSymbols: [token],
        impactedFiles: [
          impactedFile('src/a.ts', token, [
            {
              line: 1,
              text: 'const token = "sk-proj-abcdefghijklmnopqrstuvwxyz"'
            }
          ])
        ]
      })
    )

    expect(rendered).not.toContain('sk-proj-abcdefghijklmnopqrstuvwxyz')
  })
})
