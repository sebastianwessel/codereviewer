import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  Lang,
  parse,
  registerDynamicLanguage,
  type SgNode
} from '@ast-grep/napi'
import goLanguage from '@ast-grep/lang-go'
import javaLanguage from '@ast-grep/lang-java'
import pythonLanguage from '@ast-grep/lang-python'
import rustLanguage from '@ast-grep/lang-rust'
import type { FirstClassLanguage } from '../shared/language-analyzer-types.js'
import {
  hasLanguageExtension,
  normalizeAnalyzerPath
} from '../shared/language-analyzer-utils.js'

// Real version of the AST engine, recorded in evidence provenance for
// reproducibility instead of a placeholder string.
export const astGrepVersion: string = (() => {
  try {
    const packageJson = JSON.parse(
      readFileSync(
        fileURLToPath(import.meta.resolve('@ast-grep/napi/package.json')),
        'utf8'
      )
    ) as { readonly version?: unknown }

    return typeof packageJson.version === 'string'
      ? packageJson.version
      : 'unknown'
  } catch {
    return 'unknown'
  }
})()

const dynamicLanguages = {
  python: pythonLanguage,
  go: goLanguage,
  rust: rustLanguage,
  java: javaLanguage
} as const

let dynamicLanguagesRegistered = false

const registerFirstClassDynamicLanguages = (): void => {
  if (dynamicLanguagesRegistered) {
    return
  }

  registerDynamicLanguage(dynamicLanguages)
  dynamicLanguagesRegistered = true
}

export type AstGrepParseResult = {
  readonly language: FirstClassLanguage
  readonly parsed: boolean
  readonly root?: SgNode
  readonly rootKind?: string
  readonly hasErrorNodes?: boolean
  readonly failureKind?: 'unsupported-extension' | 'parse-error'
  readonly error?: string
}

const astGrepLanguageFor = (
  language: FirstClassLanguage,
  path: string
): Lang | string => {
  if (language === 'typescript') {
    return path.endsWith('.tsx') ? Lang.Tsx : Lang.TypeScript
  }

  if (language === 'javascript') {
    return Lang.JavaScript
  }

  registerFirstClassDynamicLanguages()

  return language
}

const hasNodeKind = (root: SgNode, kind: string): boolean => {
  const stack = [root]

  while (stack.length > 0) {
    const node = stack.pop()!

    if (String(node.kind()) === kind) {
      return true
    }

    stack.push(...node.children())
  }

  return false
}

export const parseWithAstGrep = (input: {
  readonly language: FirstClassLanguage
  readonly path: string
  readonly content: string
}): AstGrepParseResult => {
  try {
    const normalizedPath = normalizeAnalyzerPath(input.path)

    if (!hasLanguageExtension(input.language, normalizedPath)) {
      return {
        language: input.language,
        parsed: false,
        failureKind: 'unsupported-extension',
        error: `Unsupported ${input.language} analyzer path: ${normalizedPath}`
      }
    }

    const root = parse(
      astGrepLanguageFor(input.language, normalizedPath),
      input.content
    ).root()

    return {
      language: input.language,
      parsed: true,
      root,
      rootKind: String(root.kind()),
      hasErrorNodes: hasNodeKind(root, 'ERROR')
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    return {
      language: input.language,
      parsed: false,
      failureKind: 'parse-error',
      error: message
    }
  }
}
