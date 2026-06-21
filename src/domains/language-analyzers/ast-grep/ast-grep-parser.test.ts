import { describe, expect, test } from 'vitest'
import { parseWithAstGrep } from './ast-grep-parser.js'

describe('ast-grep parser bridge', () => {
  test.each([
    ['typescript', 'src/app.ts', 'export const value = 1'],
    ['javascript', 'src/app.js', 'export const value = 1'],
    ['python', 'app.py', 'def main():\n    return 1'],
    ['go', 'main.go', 'package main\nfunc main() {}'],
    ['rust', 'src/lib.rs', 'pub fn main() {}'],
    ['java', 'src/App.java', 'public class App {}']
  ] as const)('parses %s files', (language, path, content) => {
    expect(parseWithAstGrep({ language, path, content })).toEqual(
      expect.objectContaining({
        language,
        parsed: true,
        rootKind: expect.any(String)
      })
    )
  })

  test.each([
    ['python', 'src/app.ts'],
    ['python', 'src/app.js'],
    ['go', 'src/app.ts'],
    ['go', 'src/app.js'],
    ['rust', 'src/app.ts'],
    ['rust', 'src/app.js'],
    ['java', 'src/app.ts'],
    ['java', 'src/app.js']
  ] as const)(
    'rejects %s parsing for unowned path %s',
    (language, path) => {
      expect(
        parseWithAstGrep({
          language,
          path,
          content: 'export const value = ;'
        })
      ).toEqual(
        expect.objectContaining({
          language,
          parsed: false,
          failureKind: 'unsupported-extension',
          error: expect.stringContaining(`Unsupported ${language} analyzer path`)
        })
      )
    }
  )
})
