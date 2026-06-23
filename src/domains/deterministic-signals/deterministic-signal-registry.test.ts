import { describe, expect, test } from 'vitest'
import {
  extractDeterministicSignals,
  extractDeterministicSignalsForLanguage,
  assertDeterministicSignalEvidenceOwnsPath,
  assertSupportSignalFactOwnsPath,
  detectDeterministicSignalFiles,
  discoverDeterministicSignalTestMappings,
  supportedSignalLanguageForPath,
  routeFilesBySignalLanguage
} from './index.js'

describe('first-class deterministic support signal extractor registry', () => {
  test('routes each file to exactly one owning support signal extractor', () => {
    const routing = routeFilesBySignalLanguage([
      { path: 'src/app.ts' },
      { path: 'src/app.js' },
      { path: 'pkg/app.py' },
      { path: 'cmd/main.go' },
      { path: 'src/lib.rs' },
      { path: 'src/App.java' },
      { path: 'README.md' }
    ])

    expect(supportedSignalLanguageForPath('SRC/App.TS')).toBe('typescript')
    expect(routing.groups.map((group) => [group.language, group.files.length])).toEqual([
      ['typescript', 1],
      ['javascript', 1],
      ['python', 1],
      ['go', 1],
      ['rust', 1],
      ['java', 1]
    ])
    expect(routing.unsupportedFiles.map((file) => file.path)).toEqual(['README.md'])
  })

  test('detects all deterministic support signal language targets', () => {
    const detections = detectDeterministicSignalFiles([
      { path: 'src/app.ts' },
      { path: 'src/app.js' },
      { path: 'pkg/app.py' },
      { path: 'cmd/main.go' },
      { path: 'src/lib.rs' },
      { path: 'src/App.java' },
      { path: 'README.md' }
    ])

    expect(detections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ extractorId: 'typescript', supportedFileCount: 1 }),
        expect.objectContaining({ extractorId: 'javascript', supportedFileCount: 1 }),
        expect.objectContaining({ extractorId: 'python', supportedFileCount: 1 }),
        expect.objectContaining({ extractorId: 'go', supportedFileCount: 1 }),
        expect.objectContaining({ extractorId: 'rust', supportedFileCount: 1 }),
        expect.objectContaining({ extractorId: 'java', supportedFileCount: 1 })
      ])
    )
  })

  test('detection dispatches only routed files to each support signal owner', () => {
    const detections = detectDeterministicSignalFiles([
      { path: 'src/app.ts' }
    ])

    expect(detections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          extractorId: 'typescript',
          detected: true,
          supportedFileCount: 1,
          unsupportedFiles: []
        }),
        expect.objectContaining({
          extractorId: 'go',
          detected: false,
          supportedFileCount: 0,
          unsupportedFiles: []
        }),
        expect.objectContaining({
          extractorId: 'python',
          detected: false,
          supportedFileCount: 0,
          unsupportedFiles: []
        }),
        expect.objectContaining({
          extractorId: 'rust',
          detected: false,
          supportedFileCount: 0,
          unsupportedFiles: []
        }),
        expect.objectContaining({
          extractorId: 'java',
          detected: false,
          supportedFileCount: 0,
          unsupportedFiles: []
        })
      ])
    )
  })

  test('extracts facts for every deterministic support signal language', () => {
    const result = extractDeterministicSignals([
      {
        path: 'src/app.ts',
        content: "import { dep } from './dep.js'\nexport const value = dep"
      },
      {
        path: 'src/app.js',
        content: "import tool from './tool.js'\nexport function run() {}"
      },
      {
        path: 'pkg/app.py',
        content: 'from os import path\nclass Runner:\n    pass'
      },
      {
        path: 'cmd/main.go',
        content: 'package main\nimport "fmt"\nfunc Run() {}'
      },
      {
        path: 'src/lib.rs',
        content: 'pub mod api;\npub fn run() {}'
      },
      {
        path: 'src/App.java',
        content: 'package app;\nimport java.util.List;\npublic class App {}'
      }
    ])

    expect(result.evidence).toEqual([])
    expect(result.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ language: 'typescript', kind: 'export', name: 'value' }),
        expect.objectContaining({ language: 'javascript', kind: 'export', name: 'run' }),
        expect.objectContaining({ language: 'python', kind: 'public-symbol', name: 'Runner' }),
        expect.objectContaining({ language: 'go', kind: 'public-symbol', name: 'Run' }),
        expect.objectContaining({ language: 'rust', kind: 'public-symbol', name: 'run' }),
        expect.objectContaining({ language: 'java', kind: 'public-symbol', name: 'App' })
      ])
    )
  })

  test('never emits diagnostics from extractors that do not own the file extension', () => {
    const result = extractDeterministicSignals([
      {
        path: 'src/app.ts',
        content: 'export const value = ;'
      }
    ])

    expect(result.evidence).toEqual([
      expect.objectContaining({
        source: 'typescript-support-signal',
        location: expect.objectContaining({
          path: 'src/app.ts'
        })
      })
    ])
    expect(result.evidence).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'go-support-signal' }),
        expect.objectContaining({ source: 'python-support-signal' }),
        expect.objectContaining({ source: 'rust-support-signal' }),
        expect.objectContaining({ source: 'java-support-signal' })
      ])
    )
  })

  test('registry rejects direct support signal calls with foreign routed files', () => {
    expect(() =>
      extractDeterministicSignalsForLanguage('go', [
        {
          path: 'src/app.ts',
          content: 'export const value = ;'
        }
      ])
    ).toThrow(/Support signal extractor "go" received files outside its language ownership/u)
  })

  test('matches support-signal-owned extensions case-insensitively', () => {
    const result = extractDeterministicSignals([
      {
        path: String.raw`SRC\App.TS`,
        content: 'export const value = 1'
      }
    ])

    expect(result.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          language: 'typescript',
          path: 'SRC/App.TS'
        })
      ])
    )
  })

  test('rejects support signal evidence attached to unsupported file extensions', () => {
    expect(() =>
      assertDeterministicSignalEvidenceOwnsPath({
        id: 'evidence_wrong_owner',
        kind: 'diagnostic',
        summary: 'Go parser saw TypeScript.',
        location: {
          path: 'src/app.ts',
          startLine: 1,
          side: 'file'
        },
        source: 'go-support-signal',
        redactionApplied: true
      })
    ).toThrow(/does not own/)
  })

  test('rejects support signal facts attached to unsupported file extensions', () => {
    expect(() =>
      assertSupportSignalFactOwnsPath({
        id: 'fact_wrong_owner',
        language: 'go',
        kind: 'public-symbol',
        path: 'src/app.ts',
        name: 'Run',
        line: 1,
        summary: 'Exposes public symbol Run.',
        contentHash:
          '1111111111111111111111111111111111111111111111111111111111111111'
      })
    ).toThrow(/does not own/)
  })

  test('discovers direct and same-directory tests per language', () => {
    expect(
      discoverDeterministicSignalTestMappings([
        { path: 'src/app.js' },
        { path: 'src/app.test.js' },
        { path: 'pkg/app.py' },
        { path: 'pkg/test_app.py' },
        { path: 'cmd/main.go' },
        { path: 'cmd/main_test.go' },
        { path: 'src/lib.rs' },
        { path: 'src/lib_test.rs' },
        { path: 'src/App.java' },
        { path: 'src/AppTest.java' }
      ])
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          language: 'javascript',
          sourcePath: 'src/app.js',
          testPath: 'src/app.test.js',
          relation: 'same-directory'
        }),
        expect.objectContaining({
          language: 'python',
          sourcePath: 'pkg/app.py',
          testPath: 'pkg/test_app.py',
          relation: 'same-directory'
        }),
        expect.objectContaining({
          language: 'go',
          sourcePath: 'cmd/main.go',
          testPath: 'cmd/main_test.go',
          relation: 'same-directory'
        }),
        expect.objectContaining({
          language: 'rust',
          sourcePath: 'src/lib.rs',
          testPath: 'src/lib_test.rs',
          relation: 'same-directory'
        }),
        expect.objectContaining({
          language: 'java',
          sourcePath: 'src/App.java',
          testPath: 'src/AppTest.java',
          relation: 'same-directory'
        })
      ])
    )
  })
})
