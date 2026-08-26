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

// ast-grep ships TypeScript/TSX and JavaScript in its own `Lang` enum; every other
// supported language arrives as a separate grammar package that must be registered
// before `parse` can resolve it by name.
//
// The split is expressed in the type rather than in a comment: this record is keyed
// by the language union MINUS the two built-in grammars, so the two halves are
// CHECKED to cover the union between them. Adding an eighth language fails to
// compile here until its grammar is registered. Before, `astGrepLanguageFor` simply
// returned the language string for anything that was not TypeScript or JavaScript,
// so an unregistered grammar reached `parse` as a name resolving to nothing and
// came back as an ordinary parse failure — indistinguishable, in the evidence
// record it produces, from a file with a syntax error.
type DynamicGrammarLanguage = Exclude<
  SupportedSignalLanguage,
  'typescript' | 'javascript'
>

const dynamicLanguages = {
  python: pythonLanguage,
  go: goLanguage,
  ruby: rubyLanguage,
  rust: rustLanguage,
  java: javaLanguage
} as const satisfies Record<DynamicGrammarLanguage, unknown>

let dynamicLanguagesRegistered = false

const registerFirstClassDynamicLanguages = (): void => {
  if (dynamicLanguagesRegistered) {
    return
  }

  registerDynamicLanguage(dynamicLanguages)
  dynamicLanguagesRegistered = true
}

type AstGrepParseResult = {
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

  // `language` is narrowed to `DynamicGrammarLanguage` here, and every member of
  // that type is a key of `dynamicLanguages` by the `satisfies` above, so the name
  // returned is always one `parse` can resolve. No runtime guard is added for the
  // values that never passed the type system: they are already refused upstream by
  // `hasLanguageExtension`, which throws for a language with no extension entry
  // before this function is reached, and a second unreachable check here would be
  // a branch nothing could ever exercise.
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
