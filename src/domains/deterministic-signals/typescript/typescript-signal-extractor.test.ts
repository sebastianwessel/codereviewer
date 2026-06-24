import { describe, expect, test } from 'vitest'
import type {
  SupportSignalFile,
  SupportSignalSourceFile
} from '../shared/deterministic-signal-types.js'
import {
  extractEcmascriptSignals,
  detectEcmascriptSignalFiles,
  discoverEcmascriptSignalTestMappings
} from '../ecmascript/ecmascript-signal-extractor.js'

const detectTypeScriptFiles = (files: readonly SupportSignalFile[]) =>
  detectEcmascriptSignalFiles('typescript', files)
const analyzeTypeScriptFiles = (files: readonly SupportSignalSourceFile[]) =>
  extractEcmascriptSignals('typescript', files)
const discoverTypeScriptTests = (files: readonly SupportSignalFile[]) =>
  discoverEcmascriptSignalTestMappings('typescript', files)

describe('TypeScript deterministic support signal extractor', () => {
  test('detects supported TypeScript file extensions', () => {
    const detection = detectTypeScriptFiles([
      { path: 'src/app.ts' },
      { path: 'src/view.tsx' },
      { path: 'src/schema.mts' },
      { path: 'src/server.cts' },
      { path: 'src/readme.md' }
    ])

    expect(detection).toEqual({
      extractorId: 'typescript',
      detected: true,
      supportedFileCount: 4,
      unsupportedFiles: ['src/readme.md']
    })
  })

  test('emits language-neutral import and export facts', () => {
    const result = analyzeTypeScriptFiles([
      {
        path: 'src/app.ts',
        content: [
          "import defaultThing, { named as localName } from './dep.js'",
          "import * as tools from './tools.js'",
          'export const value = 1',
          'export { localName as publicName }'
        ].join('\n')
      }
    ])

    expect(result.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          language: 'typescript',
          kind: 'import',
          path: 'src/app.ts',
          name: 'defaultThing',
          moduleSpecifier: './dep.js',
          line: 1
        }),
        expect.objectContaining({
          language: 'typescript',
          kind: 'import',
          name: 'localName',
          moduleSpecifier: './dep.js'
        }),
        expect.objectContaining({
          language: 'typescript',
          kind: 'import',
          name: 'tools',
          moduleSpecifier: './tools.js'
        }),
        expect.objectContaining({
          language: 'typescript',
          kind: 'export',
          name: 'value',
          path: 'src/app.ts'
        }),
        expect.objectContaining({
          language: 'typescript',
          kind: 'export',
          name: 'publicName',
          path: 'src/app.ts'
        })
      ])
    )
    expect(result.evidence).toEqual([])
  })

  test('discovers direct and same-directory TypeScript tests', () => {
    expect(
      discoverTypeScriptTests([
        { path: 'src/app.ts' },
        { path: 'src/app.test.ts' },
        { path: 'src/other.spec.tsx' },
        { path: 'src/readme.md' }
      ])
    ).toEqual([
      {
        language: 'typescript',
        sourcePath: 'src/app.test.ts',
        testPath: 'src/app.test.ts',
        relation: 'direct'
      },
      {
        language: 'typescript',
        sourcePath: 'src/other.spec.tsx',
        testPath: 'src/other.spec.tsx',
        relation: 'direct'
      },
      {
        language: 'typescript',
        sourcePath: 'src/app.ts',
        testPath: 'src/app.test.ts',
        relation: 'same-directory'
      }
    ])
  })

  test('rejects unsupported file extensions', () => {
    expect(() =>
      analyzeTypeScriptFiles([
        {
          path: 'src/readme.md',
          content: '# no'
        }
      ])
    ).toThrow(TypeError)
  })

  test('emits parse diagnostics as evidence records', () => {
    const result = analyzeTypeScriptFiles([
      {
        path: 'src/broken.ts',
        content: 'export const ='
      }
    ])

    expect(result.evidence).toEqual([
      expect.objectContaining({
        kind: 'diagnostic',
        source: 'typescript-support-signal',
        redactionApplied: true,
        location: expect.objectContaining({
          path: 'src/broken.ts',
          startLine: 1,
          side: 'file'
        }),
        contentHash: expect.stringMatching(/^[a-f0-9]{64}$/)
      })
    ])
  })

  // The benchmark-fitted rule-evidence heuristics (backup-code, operation-message,
  // default-export, authorization, dayjs, slot-end, prorated) were removed because
  // they hardcoded benchmark-specific identifiers (eval-gaming). The extractor now
  // emits only generic facts and parse diagnostics, so benchmark-shaped source must
  // not produce any rule evidence.
  test('does not emit rule evidence for benchmark-shaped source', () => {
    const result = analyzeTypeScriptFiles([
      {
        path: 'src/auth.ts',
        content: [
          'const backupCodes = JSON.parse(symmetricDecrypt(user.backupCodes, key))',
          'const index = backupCodes.indexOf(credentials.backupCode.replaceAll("-", ""))',
          'if (index === -1) throw new Error(ErrorCode.IncorrectBackupCode)',
          'backupCodes[index] = null',
          'if (dayjs(date.start) === dayjs(date.end)) return undefined'
        ].join('\n')
      }
    ])

    expect(result.evidence).toEqual([])
  })
})
