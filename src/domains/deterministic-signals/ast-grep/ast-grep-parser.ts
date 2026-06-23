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
import rubyLanguage from '@ast-grep/lang-ruby'
import rustLanguage from '@ast-grep/lang-rust'
import type { SupportedSignalLanguage } from '../shared/deterministic-signal-types.js'
import {
  hasLanguageExtension,
  normalizeSignalPath
} from '../shared/deterministic-signal-utils.js'

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
  ruby: rubyLanguage,
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
  readonly language: SupportedSignalLanguage
  readonly parsed: boolean
  readonly root?: SgNode
  readonly rootKind?: string
  readonly hasErrorNodes?: boolean
  readonly failureKind?: 'unsupported-extension' | 'parse-error'
  readonly error?: string
}

const astGrepLanguageFor = (
  language: SupportedSignalLanguage,
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
  readonly language: SupportedSignalLanguage
  readonly path: string
  readonly content: string
}): AstGrepParseResult => {
  try {
    const normalizedPath = normalizeSignalPath(input.path)

    if (!hasLanguageExtension(input.language, normalizedPath)) {
      return {
        language: input.language,
        parsed: false,
        failureKind: 'unsupported-extension',
        error: `Unsupported ${input.language} support signal path: ${normalizedPath}`
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
