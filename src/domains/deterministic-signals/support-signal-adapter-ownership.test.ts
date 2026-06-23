import { describe, expect, test } from 'vitest'
import {
  extractEcmascriptSignals,
  extractPolyglotSignals,
  type SupportedSignalLanguage,
  type SupportSignalSourceFile
} from './index.js'

const analyzeTypeScriptFiles = (files: readonly SupportSignalSourceFile[]) =>
  extractEcmascriptSignals('typescript', files)
const analyzeJavaScriptFiles = (files: readonly SupportSignalSourceFile[]) =>
  extractEcmascriptSignals('javascript', files)
const analyzePythonFiles = (files: readonly SupportSignalSourceFile[]) =>
  extractPolyglotSignals('python', files)
const analyzeGoFiles = (files: readonly SupportSignalSourceFile[]) =>
  extractPolyglotSignals('go', files)
const analyzeRustFiles = (files: readonly SupportSignalSourceFile[]) =>
  extractPolyglotSignals('rust', files)
const analyzeJavaFiles = (files: readonly SupportSignalSourceFile[]) =>
  extractPolyglotSignals('java', files)

type AdapterCase = {
  readonly language: SupportedSignalLanguage
  readonly ownedPath: string
  readonly ownedContent: string
  readonly analyze: (files: readonly SupportSignalSourceFile[]) => unknown
}

const adapters: readonly AdapterCase[] = [
  {
    language: 'typescript',
    ownedPath: 'src/app.ts',
    ownedContent: 'export const value = 1',
    analyze: analyzeTypeScriptFiles
  },
  {
    language: 'javascript',
    ownedPath: 'src/app.js',
    ownedContent: 'export const value = 1',
    analyze: analyzeJavaScriptFiles
  },
  {
    language: 'python',
    ownedPath: 'src/app.py',
    ownedContent: 'def main():\n    return 1',
    analyze: analyzePythonFiles
  },
  {
    language: 'go',
    ownedPath: 'cmd/app.go',
    ownedContent: 'package main\nfunc main() {}',
    analyze: analyzeGoFiles
  },
  {
    language: 'rust',
    ownedPath: 'src/lib.rs',
    ownedContent: 'pub fn main() {}',
    analyze: analyzeRustFiles
  },
  {
    language: 'java',
    ownedPath: 'src/App.java',
    ownedContent: 'public class App {}',
    analyze: analyzeJavaFiles
  }
]

describe('deterministic support signal language adapter ownership', () => {
  test.each(adapters.map((adapter) => [adapter.language, adapter] as const))(
    '%s adapter rejects every non-owned first-class extension',
    (_language, adapter) => {
      for (const foreign of adapters.filter(
        (candidate) => candidate.language !== adapter.language
      )) {
        expect(() =>
          adapter.analyze([
            {
              path: foreign.ownedPath,
              content: foreign.ownedContent
            }
          ])
        ).toThrow(/Unsupported .* support signal path/u)
      }
    }
  )
})
