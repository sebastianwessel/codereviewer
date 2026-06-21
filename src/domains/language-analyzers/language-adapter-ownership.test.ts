import { describe, expect, test } from 'vitest'
import {
  analyzeEcmascriptFiles,
  analyzePolyglotFiles,
  type FirstClassLanguage,
  type LanguageSourceFile
} from './index.js'

const analyzeTypeScriptFiles = (files: readonly LanguageSourceFile[]) =>
  analyzeEcmascriptFiles('typescript', files)
const analyzeJavaScriptFiles = (files: readonly LanguageSourceFile[]) =>
  analyzeEcmascriptFiles('javascript', files)
const analyzePythonFiles = (files: readonly LanguageSourceFile[]) =>
  analyzePolyglotFiles('python', files)
const analyzeGoFiles = (files: readonly LanguageSourceFile[]) =>
  analyzePolyglotFiles('go', files)
const analyzeRustFiles = (files: readonly LanguageSourceFile[]) =>
  analyzePolyglotFiles('rust', files)
const analyzeJavaFiles = (files: readonly LanguageSourceFile[]) =>
  analyzePolyglotFiles('java', files)

type AdapterCase = {
  readonly language: FirstClassLanguage
  readonly ownedPath: string
  readonly ownedContent: string
  readonly analyze: (files: readonly LanguageSourceFile[]) => unknown
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

describe('first-class language adapter ownership', () => {
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
        ).toThrow(/Unsupported .* analyzer path/u)
      }
    }
  )
})
