import type { SgNode } from '@ast-grep/napi'
import {
  EvidenceRecordSchema,
  type EvidenceRecord
} from '../../../shared/contracts/index.js'
import { astGrepVersion, parseWithAstGrep } from '../ast-grep/ast-grep-parser.js'
import type {
  SupportedSignalLanguage,
  DeterministicSignalExtraction,
  SupportSignalFile,
  SupportSignalFact,
  SupportSignalSourceFile
} from '../shared/deterministic-signal-types.js'
import {
  createSupportSignalFact,
  detectSupportSignalFiles,
  hasLanguageExtension,
  hashSegment,
  normalizeSignalPath,
  sha256
} from '../shared/deterministic-signal-utils.js'
import { discoverSignalLanguageTests } from '../shared/test-discovery.js'

type PolyglotLanguage = 'python' | 'go' | 'rust' | 'java' | 'ruby'

const astParseEvidence = (
  language: SupportedSignalLanguage,
  path: string,
  contentHash: string,
  error: string
): EvidenceRecord =>
  EvidenceRecordSchema.parse({
    id: `evidence_${hashSegment(`${language}:${path}:ast-grep:${error}`)}`,
    kind: 'diagnostic',
    summary: `AST parse failed: ${error.slice(0, 500)}`,
    location: {
      path,
      startLine: 1,
      side: 'file'
    },
    source: `${language}-support-signal`,
    sourceVersion: `ast-grep@${astGrepVersion}`,
    contentHash,
    redactionApplied: true
  })

const createFact = (
  language: PolyglotLanguage,
  contentHash: string,
  path: string,
  input: {
    readonly kind: 'import' | 'declaration' | 'public-symbol' | 'module'
    readonly name: string
    readonly line: number
    readonly moduleSpecifier?: string
  }
): SupportSignalFact =>
  createSupportSignalFact({
    language,
    kind: input.kind,
    path,
    name: input.name,
    ...(input.moduleSpecifier === undefined
      ? {}
      : { moduleSpecifier: input.moduleSpecifier }),
    line: input.line,
    contentHash
  })

type AstNode = SgNode

const kindOf = (node: AstNode): string => String(node.kind())

const lineFor = (node: AstNode): number => node.range().start.line + 1

const childrenOfKind = (
  node: AstNode,
  kinds: readonly string[]
): readonly AstNode[] => node.children().filter((child) => kinds.includes(kindOf(child)))

const firstChildOfKind = (
  node: AstNode,
  kinds: readonly string[]
): AstNode | undefined => childrenOfKind(node, kinds)[0]

const walkAst = (root: AstNode, visit: (node: AstNode) => void): void => {
  const stack = [root]

  while (stack.length > 0) {
    const node = stack.pop()!
    visit(node)
    stack.push(...[...node.children()].reverse())
  }
}

const descendantsOfKind = (
  node: AstNode,
  kinds: readonly string[]
): readonly AstNode[] => {
  const matches: AstNode[] = []

  walkAst(node, (current) => {
    if (current.id() !== node.id() && kinds.includes(kindOf(current))) {
      matches.push(current)
    }
  })

  return matches
}

const firstDescendantOfKind = (
  node: AstNode,
  kinds: readonly string[]
): AstNode | undefined => descendantsOfKind(node, kinds)[0]

const hasChildOfKind = (node: AstNode, kinds: readonly string[]): boolean =>
  firstChildOfKind(node, kinds) !== undefined

const textOf = (node: AstNode | undefined): string | undefined => {
  const text = node?.text().trim()

  return text === '' ? undefined : text
}

const trimQuotes = (value: string): string => {
  const trimmed = value.trim()
  const first = trimmed[0]
  const last = trimmed.at(-1)

  return first !== undefined &&
    first === last &&
    (first === '"' || first === "'" || first === '`')
    ? trimmed.slice(1, -1)
    : trimmed
}

const lastPathSegment = (value: string, separator: string): string =>
  value.split(separator).filter(Boolean).at(-1) ?? value

const startsWithUppercase = (value: string): boolean => {
  const first = value[0]

  return first !== undefined && first === first.toUpperCase() && first !== first.toLowerCase()
}

const firstIdentifierText = (node: AstNode): string | undefined =>
  textOf(firstDescendantOfKind(node, ['identifier', 'type_identifier', 'package_identifier']))

const lastIdentifierText = (node: AstNode): string | undefined => {
  const identifiers = descendantsOfKind(node, [
    'identifier',
    'type_identifier',
    'package_identifier'
  ])

  return textOf(identifiers.at(-1))
}

const moduleTextFromImportTarget = (node: AstNode): string | undefined =>
  textOf(firstChildOfKind(node, ['dotted_name'])) ?? textOf(node)

const pythonImportName = (
  node: AstNode,
  mode: 'import' | 'from-import'
): string | undefined => {
  if (kindOf(node) === 'aliased_import') {
    return textOf(childrenOfKind(node, ['identifier']).at(-1))
  }

  if (mode === 'import') {
    return firstIdentifierText(node)
  }

  return lastIdentifierText(node)
}

const extractPythonFacts = (
  path: string,
  root: AstNode,
  contentHash: string
): readonly SupportSignalFact[] => {
  const facts: SupportSignalFact[] = []

  walkAst(root, (node) => {
    if (kindOf(node) === 'import_statement') {
      let importSeen = false

      for (const child of node.children()) {
        const kind = kindOf(child)

        if (kind === 'import') {
          importSeen = true
          continue
        }

        if (importSeen && (kind === 'dotted_name' || kind === 'aliased_import')) {
          const name = pythonImportName(child, 'import')
          const moduleSpecifier = moduleTextFromImportTarget(child)

          if (name !== undefined && moduleSpecifier !== undefined) {
            facts.push(
              createFact('python', contentHash, path, {
                kind: 'import',
                name,
                moduleSpecifier,
                line: lineFor(child)
              })
            )
          }
        }
      }
    }

    if (kindOf(node) === 'import_from_statement') {
      let importSeen = false
      let moduleSpecifier: string | undefined

      for (const child of node.children()) {
        const kind = kindOf(child)

        if (kind === 'dotted_name' && !importSeen && moduleSpecifier === undefined) {
          moduleSpecifier = textOf(child)
          continue
        }

        if (kind === 'import') {
          importSeen = true
          continue
        }

        if (importSeen && (kind === 'dotted_name' || kind === 'aliased_import')) {
          const name = pythonImportName(child, 'from-import')

          if (name !== undefined && moduleSpecifier !== undefined) {
            facts.push(
              createFact('python', contentHash, path, {
                kind: 'import',
                name,
                moduleSpecifier,
                line: lineFor(child)
              })
            )
          }
        }
      }
    }

    if (kindOf(node) === 'function_definition' || kindOf(node) === 'class_definition') {
      const name = textOf(firstChildOfKind(node, ['identifier']))

      if (name !== undefined) {
        facts.push(
          createFact('python', contentHash, path, {
            kind: 'declaration',
            name,
            line: lineFor(node)
          })
        )

        if (!name.startsWith('_')) {
          facts.push(
            createFact('python', contentHash, path, {
              kind: 'public-symbol',
              name,
              line: lineFor(node)
            })
          )
        }
      }
    }
  })

  return facts
}

const extractGoFacts = (
  path: string,
  root: AstNode,
  contentHash: string
): readonly SupportSignalFact[] => {
  const facts: SupportSignalFact[] = []

  walkAst(root, (node) => {
    if (kindOf(node) === 'package_clause') {
      const name = textOf(firstChildOfKind(node, ['package_identifier']))

      if (name !== undefined) {
        facts.push(
          createFact('go', contentHash, path, {
            kind: 'module',
            name,
            line: lineFor(node)
          })
        )
      }
    }

    if (kindOf(node) === 'import_spec') {
      const moduleSpecifier = textOf(
        firstChildOfKind(node, ['interpreted_string_literal', 'raw_string_literal'])
      )

      if (moduleSpecifier !== undefined) {
        const alias = textOf(firstChildOfKind(node, ['package_identifier']))
        const unquotedModule = trimQuotes(moduleSpecifier)

        facts.push(
          createFact('go', contentHash, path, {
            kind: 'import',
            name: alias ?? lastPathSegment(unquotedModule, '/'),
            moduleSpecifier: unquotedModule,
            line: lineFor(node)
          })
        )
      }
    }

    if (kindOf(node) === 'function_declaration' || kindOf(node) === 'method_declaration') {
      const name = textOf(firstChildOfKind(node, ['identifier', 'field_identifier']))

      if (name !== undefined) {
        facts.push(
          createFact('go', contentHash, path, {
            kind: 'declaration',
            name,
            line: lineFor(node)
          })
        )

        if (startsWithUppercase(name)) {
          facts.push(
            createFact('go', contentHash, path, {
              kind: 'public-symbol',
              name,
              line: lineFor(node)
            })
          )
        }
      }
    }

    if (kindOf(node) === 'type_spec') {
      const name = textOf(firstChildOfKind(node, ['type_identifier']))

      if (name !== undefined) {
        facts.push(
          createFact('go', contentHash, path, {
            kind: 'declaration',
            name,
            line: lineFor(node)
          })
        )

        if (startsWithUppercase(name)) {
          facts.push(
            createFact('go', contentHash, path, {
              kind: 'public-symbol',
              name,
              line: lineFor(node)
            })
          )
        }
      }
    }
  })

  return facts
}

const rustUseNames = (node: AstNode): readonly string[] => {
  const useLists = descendantsOfKind(node, ['use_list'])
  const targetNodes =
    useLists.length > 0
      ? useLists.flatMap((useList) =>
          useList
            .children()
            .filter((child) => ['identifier', 'scoped_identifier'].includes(kindOf(child)))
        )
      : [firstChildOfKind(node, ['identifier', 'scoped_identifier', 'scoped_use_list'])].filter(
          (child): child is AstNode => child !== undefined
        )
  const names = targetNodes
    .map((targetNode) =>
      kindOf(targetNode) === 'identifier' ? textOf(targetNode) : lastIdentifierText(targetNode)
    )
    .filter((name): name is string => name !== undefined)
    .filter((name) => name !== 'crate' && name !== 'self' && name !== 'super')

  return [...new Set(names)]
}

const rustUseSpecifier = (node: AstNode): string | undefined =>
  textOf(firstChildOfKind(node, ['scoped_use_list', 'scoped_identifier', 'identifier']))

const extractRustFacts = (
  path: string,
  root: AstNode,
  contentHash: string
): readonly SupportSignalFact[] => {
  const facts: SupportSignalFact[] = []

  walkAst(root, (node) => {
    if (kindOf(node) === 'use_declaration') {
      const moduleSpecifier = rustUseSpecifier(node)

      for (const name of rustUseNames(node)) {
        facts.push(
          createFact('rust', contentHash, path, {
            kind: 'import',
            name,
            ...(moduleSpecifier === undefined ? {} : { moduleSpecifier }),
            line: lineFor(node)
          })
        )
      }
    }

    if (kindOf(node) === 'mod_item') {
      const name = textOf(firstChildOfKind(node, ['identifier']))

      if (name !== undefined) {
        facts.push(
          createFact('rust', contentHash, path, {
            kind: 'module',
            name,
            line: lineFor(node)
          })
        )
      }
    }

    if (
      kindOf(node) === 'function_item' ||
      kindOf(node) === 'struct_item' ||
      kindOf(node) === 'enum_item' ||
      kindOf(node) === 'trait_item'
    ) {
      const name = textOf(firstChildOfKind(node, ['identifier', 'type_identifier']))

      if (name !== undefined) {
        facts.push(
          createFact('rust', contentHash, path, {
            kind: 'declaration',
            name,
            line: lineFor(node)
          })
        )

        if (hasChildOfKind(node, ['visibility_modifier'])) {
          facts.push(
            createFact('rust', contentHash, path, {
              kind: 'public-symbol',
              name,
              line: lineFor(node)
            })
          )
        }
      }
    }
  })

  return facts
}

const javaDeclarationName = (node: AstNode): string | undefined =>
  textOf(firstChildOfKind(node, ['identifier']))

const hasJavaPublicModifier = (node: AstNode): boolean =>
  childrenOfKind(node, ['modifiers']).some((modifiers) =>
    modifiers.children().some((child) => kindOf(child) === 'public')
  )

const extractJavaFacts = (
  path: string,
  root: AstNode,
  contentHash: string
): readonly SupportSignalFact[] => {
  const facts: SupportSignalFact[] = []

  walkAst(root, (node) => {
    if (kindOf(node) === 'package_declaration') {
      const name = textOf(firstChildOfKind(node, ['identifier', 'scoped_identifier']))

      if (name !== undefined) {
        facts.push(
          createFact('java', contentHash, path, {
            kind: 'module',
            name,
            line: lineFor(node)
          })
        )
      }
    }

    if (kindOf(node) === 'import_declaration') {
      const moduleSpecifier = textOf(firstChildOfKind(node, ['scoped_identifier', 'asterisk']))

      if (moduleSpecifier !== undefined) {
        facts.push(
          createFact('java', contentHash, path, {
            kind: 'import',
            name: lastPathSegment(moduleSpecifier, '.'),
            moduleSpecifier,
            line: lineFor(node)
          })
        )
      }
    }

    if (
      kindOf(node) === 'class_declaration' ||
      kindOf(node) === 'interface_declaration' ||
      kindOf(node) === 'enum_declaration' ||
      kindOf(node) === 'record_declaration'
    ) {
      const name = javaDeclarationName(node)

      if (name !== undefined) {
        facts.push(
          createFact('java', contentHash, path, {
            kind: 'declaration',
            name,
            line: lineFor(node)
          })
        )

        if (hasJavaPublicModifier(node)) {
          facts.push(
            createFact('java', contentHash, path, {
              kind: 'public-symbol',
              name,
              line: lineFor(node)
            })
          )
        }
      }
    }
  })

  return facts
}

const extractRubyFacts = (
  path: string,
  root: AstNode,
  contentHash: string
): readonly SupportSignalFact[] => {
  const facts: SupportSignalFact[] = []

  walkAst(root, (node) => {
    // Module declarations: module Foo
    if (kindOf(node) === 'module') {
      const name = textOf(firstChildOfKind(node, ['constant', 'scope_resolution']))

      if (name !== undefined) {
        facts.push(
          createFact('ruby', contentHash, path, {
            kind: 'module',
            name,
            line: lineFor(node)
          })
        )
      }
    }

    // Class declarations: class Foo or class Foo < Bar
    if (kindOf(node) === 'class') {
      const name = textOf(firstChildOfKind(node, ['constant', 'scope_resolution']))

      if (name !== undefined) {
        facts.push(
          createFact('ruby', contentHash, path, {
            kind: 'declaration',
            name,
            line: lineFor(node)
          })
        )

        facts.push(
          createFact('ruby', contentHash, path, {
            kind: 'public-symbol',
            name,
            line: lineFor(node)
          })
        )
      }
    }

    // Method declarations: def foo or def self.foo
    if (kindOf(node) === 'method' || kindOf(node) === 'singleton_method') {
      const name = textOf(firstChildOfKind(node, ['identifier', 'operator']))

      if (name !== undefined) {
        facts.push(
          createFact('ruby', contentHash, path, {
            kind: 'declaration',
            name,
            line: lineFor(node)
          })
        )

        // Public by convention: non-underscore-prefixed methods
        if (!name.startsWith('_')) {
          facts.push(
            createFact('ruby', contentHash, path, {
              kind: 'public-symbol',
              name,
              line: lineFor(node)
            })
          )
        }
      }
    }

    // require / require_relative import edges
    if (kindOf(node) === 'call') {
      const methodNode = firstChildOfKind(node, ['identifier'])
      const method = textOf(methodNode)

      if (method === 'require' || method === 'require_relative') {
        const argList = firstChildOfKind(node, ['argument_list'])
        const stringNode = argList !== undefined
          ? firstChildOfKind(argList, ['string'])
          : firstDescendantOfKind(node, ['string'])
        const rawSpecifier = textOf(stringNode)

        if (rawSpecifier !== undefined) {
          const moduleSpecifier = trimQuotes(rawSpecifier)

          facts.push(
            createFact('ruby', contentHash, path, {
              kind: 'import',
              name: lastPathSegment(moduleSpecifier, '/'),
              moduleSpecifier,
              line: lineFor(node)
            })
          )
        }
      }
    }
  })

  return facts
}

const extractFacts = (
  language: PolyglotLanguage,
  path: string,
  root: AstNode,
  contentHash: string
): readonly SupportSignalFact[] => {
  if (language === 'python') {
    return extractPythonFacts(path, root, contentHash)
  }

  if (language === 'go') {
    return extractGoFacts(path, root, contentHash)
  }

  if (language === 'rust') {
    return extractRustFacts(path, root, contentHash)
  }

  if (language === 'ruby') {
    return extractRubyFacts(path, root, contentHash)
  }

  return extractJavaFacts(path, root, contentHash)
}

export const extractPolyglotSignals = (
  language: PolyglotLanguage,
  files: readonly SupportSignalSourceFile[]
): DeterministicSignalExtraction => {
  const facts: SupportSignalFact[] = []
  const evidence: EvidenceRecord[] = []

  for (const file of files) {
    const path = normalizeSignalPath(file.path)

    if (!hasLanguageExtension(language, path)) {
      throw new TypeError(`Unsupported ${language} support signal path: ${path}`)
    }

    const contentHash = sha256(file.content)
    const astParseResult = parseWithAstGrep({
      language,
      path,
      content: file.content
    })

    if (
      !astParseResult.parsed ||
      astParseResult.root === undefined ||
      astParseResult.hasErrorNodes
    ) {
      if (astParseResult.failureKind === 'unsupported-extension') {
        throw new TypeError(
          astParseResult.error ?? `Unsupported ${language} support signal path: ${path}`
        )
      }

      evidence.push(
        astParseEvidence(
          language,
          path,
          contentHash,
          astParseResult.error ?? 'AST contains syntax error nodes.'
        )
      )
      continue
    }

    facts.push(...extractFacts(language, path, astParseResult.root, contentHash))
  }

  return { facts, evidence }
}

export const detectPolyglotSignalFiles = (
  language: PolyglotLanguage,
  files: readonly SupportSignalFile[]
) => detectSupportSignalFiles(language, files)

export const discoverPolyglotSignalTestMappings = (
  language: PolyglotLanguage,
  files: readonly SupportSignalFile[]
) => discoverSignalLanguageTests(language, files)
