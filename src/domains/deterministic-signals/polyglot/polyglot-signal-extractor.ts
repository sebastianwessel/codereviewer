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
import {
  discoverSignalLanguageTests,
  isTestOnlyDeclaration
} from '../shared/test-discovery.js'

// Every supported language runs through this engine, so the alias is simply the
// supported set. It is kept as a name because the exported functions read better
// with it than with a bare `SupportedSignalLanguage` repeated at each site.
type PolyglotLanguage = SupportedSignalLanguage

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
    readonly kind: 'import' | 'export' | 'declaration' | 'public-symbol' | 'module'
    readonly name: string
    readonly line: number
    readonly endLine: number
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
    endLine: input.endLine,
    contentHash
  })

type AstNode = SgNode

const kindOf = (node: AstNode): string => String(node.kind())

const lineFor = (node: AstNode): number => node.range().start.line + 1

// The 1-based line range the node occupies, from the grammar's own range. Every
// adapter below reports it for every fact, so the extent of a declaration is read
// rather than inferred from whatever declaration happens to follow it.
const spanFor = (node: AstNode): { readonly line: number; readonly endLine: number } => {
  const range = node.range()
  const line = range.start.line + 1

  return { line, endLine: Math.max(line, range.end.line + 1) }
}

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

// The wrapper this grammar puts around a decorated definition, when there is one.
const pythonDecoratedDefinition = (node: AstNode): AstNode | undefined => {
  const parent = node.parent()

  return parent !== null && parent !== undefined && kindOf(parent) === 'decorated_definition'
    ? parent
    : undefined
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
                ...spanFor(child)
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
                ...spanFor(child)
              })
            )
          }
        }
      }
    }

    if (kindOf(node) === 'function_definition' || kindOf(node) === 'class_definition') {
      const name = textOf(firstChildOfKind(node, ['identifier']))

      if (name !== undefined) {
        // A decorator is part of the declaration it decorates: it replaces what
        // every caller of that name receives. This grammar puts it in a wrapper
        // node instead of inside the definition, so the definition's own range
        // stops below it and a decorator-only change would be attributed to
        // whatever declaration happens to sit above — a confident statement about
        // the wrong symbol. Java's grammar nests its annotations inside the
        // declaration and already reports the annotated range; reading the wrapper
        // here is what makes the two languages mean the same thing.
        const declared = pythonDecoratedDefinition(node) ?? node

        facts.push(
          createFact('python', contentHash, path, {
            kind: 'declaration',
            name,
            ...spanFor(declared)
          })
        )

        if (!name.startsWith('_')) {
          facts.push(
            createFact('python', contentHash, path, {
              kind: 'public-symbol',
              name,
              ...spanFor(declared)
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
            ...spanFor(node)
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
            ...spanFor(node)
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
            ...spanFor(node)
          })
        )

        if (startsWithUppercase(name)) {
          facts.push(
            createFact('go', contentHash, path, {
              kind: 'public-symbol',
              name,
              ...spanFor(node)
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
            ...spanFor(node)
          })
        )

        if (startsWithUppercase(name)) {
          facts.push(
            createFact('go', contentHash, path, {
              kind: 'public-symbol',
              name,
              ...spanFor(node)
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
            ...spanFor(node)
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
            ...spanFor(node)
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
      // A declaration the crate compiles only for its test build is not part of
      // what this file provides, so it must not become a changed public symbol.
      // The whole file is not test code just because it
      // carries an inline `#[cfg(test)] mod tests`, which is why this is asked
      // here, per declaration, rather than of the path.
      //
      // Only the two DECLARATION facts are suppressed. A `use` inside a test
      // module is still an edge this file has, and retrieval reads those edges to
      // find definitions a reviewer needs while reading the test — so the import
      // and module facts stay, and "test-side" stops at the production surface it
      // is about.
      if (isTestOnlyDeclaration('rust', node)) {
        return
      }

      const name = textOf(firstChildOfKind(node, ['identifier', 'type_identifier']))

      if (name !== undefined) {
        facts.push(
          createFact('rust', contentHash, path, {
            kind: 'declaration',
            name,
            ...spanFor(node)
          })
        )

        if (hasChildOfKind(node, ['visibility_modifier'])) {
          facts.push(
            createFact('rust', contentHash, path, {
              kind: 'public-symbol',
              name,
              ...spanFor(node)
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
            ...spanFor(node)
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
            ...spanFor(node)
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
            ...spanFor(node)
          })
        )

        if (hasJavaPublicModifier(node)) {
          facts.push(
            createFact('java', contentHash, path, {
              kind: 'public-symbol',
              name,
              ...spanFor(node)
            })
          )
        }
      }
    }
  })

  return facts
}

// Ruby lets a definition appear anywhere a statement can, including inside a
// block or another method body. Those definitions do not exist until the
// enclosing body RUNS, and they attach to whatever `self` holds at that moment —
// so no other file can reference them by that name, and the name is usually a
// throwaway one reused all over the codebase for something else entirely.
//
// Namespace bodies are deliberately absent from this set. A `class`, `module` or
// `class << self` body is how a file states what it provides, and a definition
// inside a `begin`/`if`/`rescue` at that level is still reached by loading the
// file, so neither is a runtime scope.
const rubyRuntimeScopeKinds = [
  'block',
  'do_block',
  'method',
  'singleton_method'
] as const

const isInsideRubyRuntimeScope = (node: AstNode): boolean => {
  let ancestor = node.parent()

  while (ancestor !== null && ancestor !== undefined) {
    if ((rubyRuntimeScopeKinds as readonly string[]).includes(kindOf(ancestor))) {
      return true
    }

    ancestor = ancestor.parent()
  }

  return false
}

// The node kinds the guard above applies to: the ones that would otherwise emit a
// `declaration`/`public-symbol` fact. `require` is not among them — a require runs
// wherever it sits, and the module it pulls in is a real edge from this file even
// when the call is inside a block.
const rubyDefinitionKinds = [
  'module',
  'class',
  'method',
  'singleton_method'
] as const

const extractRubyFacts = (
  path: string,
  root: AstNode,
  contentHash: string
): readonly SupportSignalFact[] => {
  const facts: SupportSignalFact[] = []

  walkAst(root, (node) => {
    if (
      (rubyDefinitionKinds as readonly string[]).includes(kindOf(node)) &&
      isInsideRubyRuntimeScope(node)
    ) {
      return
    }

    // Module declarations: module Foo
    if (kindOf(node) === 'module') {
      const name = textOf(firstChildOfKind(node, ['constant', 'scope_resolution']))

      if (name !== undefined) {
        facts.push(
          createFact('ruby', contentHash, path, {
            kind: 'module',
            name,
            ...spanFor(node)
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
            ...spanFor(node)
          })
        )

        facts.push(
          createFact('ruby', contentHash, path, {
            kind: 'public-symbol',
            name,
            ...spanFor(node)
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
            ...spanFor(node)
          })
        )

        // Public by convention: non-underscore-prefixed methods
        if (!name.startsWith('_')) {
          facts.push(
            createFact('ruby', contentHash, path, {
              kind: 'public-symbol',
              name,
              ...spanFor(node)
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
              ...spanFor(node)
            })
          )
        }
      }
    }
  })

  return facts
}

// ECMAScript (TypeScript and JavaScript).
//
// This replaces a separate 438-line extractor built on the TypeScript compiler
// API. That engine used the compiler purely as a PARSER — `createSourceFile`,
// node predicates and `forEachChild`, with no `Program` and no type checker — and
// reached `parseDiagnostics`, an internal undocumented field, through a cast. Two
// of seven languages having their own engine, one of them resting on a private
// API, is the thing this consolidation removes. ast-grep already supported these
// grammars natively (`ast-grep-parser.ts` has mapped them to `Lang.TypeScript` /
// `Lang.Tsx` / `Lang.JavaScript` all along); only extraction bypassed it.
//
// Scope is deliberately LIKE-FOR-LIKE with the engine it replaces: `import` and
// `export` facts only. The other five languages also emit `declaration` and
// `public-symbol`, and ECMAScript could — but widening what downstream consumers
// receive is a specification change, not a refactor, and the replaced extractor
// said so explicitly. Kept identical so this change is measurable.

const ecmascriptDeclarationKinds = [
  'function_declaration',
  'function_signature',
  'generator_function_declaration',
  'class_declaration',
  'abstract_class_declaration',
  'interface_declaration',
  'type_alias_declaration',
  'enum_declaration',
  'module',
  'internal_module'
] as const

const ecmascriptVariableKinds = ['lexical_declaration', 'variable_declaration'] as const

const identifierKinds = [
  'identifier',
  'type_identifier',
  'property_identifier',
  'shorthand_property_identifier'
] as const

// `import { a as b }` binds `b`; `export { a as b }` exports `b`. In both the
// wanted name is `alias ?? name`, which is what the compiler-based extractor read
// (`element.name` — the local binding for imports, the exported name for
// exports).
//
// Read from the grammar's FIELDS rather than by position. "Last identifier" looks
// equivalent and is not: `export { X as default }` has a keyword alias and
// `export { x as "module.exports" }` a string-literal one, neither of which is an
// identifier node, so a positional rule silently returned the LOCAL name for both
// — the wrong name, not a missing one. Real packages ship both spellings.
const specifierName = (node: AstNode): string | undefined => {
  // `field` returns null, not undefined, for an absent field.
  const named = node.field('alias') ?? node.field('name')

  if (named === null || named === undefined) {
    return undefined
  }

  // A string-literal alias carries its quotes in the source text.
  return textOf(named) === undefined ? undefined : trimQuotes(named.text())
}

const ecmascriptModuleSpecifier = (node: AstNode): string | undefined => {
  const literal = firstChildOfKind(node, ['string'])

  return literal === undefined ? undefined : trimQuotes(literal.text())
}

const declaredEcmascriptName = (node: AstNode): string | undefined => {
  if (ecmascriptVariableKinds.some((kind) => kind === kindOf(node))) {
    // Only the FIRST declarator, matching `declarationList.declarations[0]`, and
    // only when it binds a plain identifier — a destructuring pattern named
    // nothing the compiler-based extractor would record either.
    const declarator = firstChildOfKind(node, ['variable_declarator'])

    if (declarator === undefined) {
      return undefined
    }

    const bound = declarator.children()[0]

    return bound !== undefined && kindOf(bound) === 'identifier'
      ? textOf(bound)
      : undefined
  }

  return textOf(firstChildOfKind(node, [...identifierKinds]))
}

const collectEcmascriptImportFacts = (
  language: PolyglotLanguage,
  node: AstNode,
  path: string,
  contentHash: string
): readonly SupportSignalFact[] => {
  const moduleSpecifier = ecmascriptModuleSpecifier(node)
  const span = spanFor(node)
  const names: string[] = []
  const clause = firstChildOfKind(node, ['import_clause'])

  // A side-effect import (`import 'module'`) binds nothing and produced no facts
  // before; without a clause there is nothing to name.
  if (clause !== undefined) {
    for (const child of clause.children()) {
      const kind = kindOf(child)

      if (kind === 'identifier') {
        names.push(child.text())
        continue
      }

      if (kind === 'namespace_import') {
        const name = textOf(firstChildOfKind(child, ['identifier']))

        if (name !== undefined) {
          names.push(name)
        }
        continue
      }

      if (kind === 'named_imports') {
        for (const specifier of childrenOfKind(child, ['import_specifier'])) {
          const name = specifierName(specifier)

          if (name !== undefined) {
            names.push(name)
          }
        }
      }
    }
  }

  return names.map((name) =>
    createFact(language, contentHash, path, {
      kind: 'import',
      name,
      ...(moduleSpecifier === undefined ? {} : { moduleSpecifier }),
      ...span
    })
  )
}

const collectEcmascriptExportFacts = (
  language: PolyglotLanguage,
  node: AstNode,
  path: string,
  contentHash: string
): readonly SupportSignalFact[] => {
  const moduleSpecifier = ecmascriptModuleSpecifier(node)
  const span = spanFor(node)
  const withModule = moduleSpecifier === undefined ? {} : { moduleSpecifier }
  const clause = firstChildOfKind(node, ['export_clause'])

  if (clause !== undefined) {
    return childrenOfKind(clause, ['export_specifier'])
      .map((specifier) => specifierName(specifier))
      .filter((name): name is string => name !== undefined)
      .map((name) =>
        createFact(language, contentHash, path, {
          kind: 'export',
          name,
          ...withModule,
          ...span
        })
      )
  }

  // `export * from 'm'` — a star with a source and no clause.
  if (
    moduleSpecifier !== undefined &&
    node.children().some((child) => kindOf(child) === '*')
  ) {
    return [
      createFact(language, contentHash, path, {
        kind: 'export',
        name: '*',
        ...withModule,
        ...span
      })
    ]
  }

  const declaration = firstChildOfKind(node, [
    ...ecmascriptDeclarationKinds,
    ...ecmascriptVariableKinds
  ])

  if (declaration === undefined) {
    // `export default someIdentifier` and `export = x` name no declaration. The
    // compiler-based extractor recorded neither, so neither does this.
    return []
  }

  const name = declaredEcmascriptName(declaration)

  return name === undefined
    ? []
    : [
        createFact(language, contentHash, path, {
          kind: 'export',
          name,
          ...withModule,
          ...span
        })
      ]
}

// CommonJS assignment exports. Recognising only ESM left a CommonJS file with NO
// facts at all — measured over four real JavaScript repositories, 1,046 `.js`
// files yielded six declarations in total. These facts feed the stage-1 packet
// and `impact check`'s changed symbols, so a CommonJS codebase degraded both
// SILENTLY. Applies to `.ts` too: a
// TypeScript file may use CommonJS and the parse is identical.
const isExportsTarget = (node: AstNode | undefined): boolean =>
  node !== undefined && kindOf(node) === 'identifier' && node.text() === 'exports'

const isModuleExportsTarget = (node: AstNode | undefined): boolean => {
  if (node === undefined || kindOf(node) !== 'member_expression') {
    return false
  }

  const [object, property] = [node.children()[0], childrenOfKind(node, ['property_identifier'])[0]]

  return (
    object !== undefined &&
    kindOf(object) === 'identifier' &&
    object.text() === 'module' &&
    textOf(property) === 'exports'
  )
}

// Matched against the STATEMENT, not against any `assignment_expression` found
// anywhere. Babel's compiled output is full of chained forms like
// `exports.a = exports.b = void 0`, where the inner assignment is an expression
// rather than a statement. The compiler-based extractor tested
// `isExpressionStatement` and so recorded only the outermost name; walking every
// assignment node instead would have silently started reporting the inner ones
// too — 3 083 extra facts across 1 897 real files. Recovering those names is
// probably worth doing, but it changes what every downstream consumer receives
// and belongs in a spec, not in a refactor whose whole claim is like-for-like.
const commonJsExportedNames = (statement: AstNode): readonly string[] => {
  if (kindOf(statement) !== 'expression_statement') {
    return []
  }

  const node = statement.children()[0]

  if (node === undefined || kindOf(node) !== 'assignment_expression') {
    return []
  }

  const target = node.children()[0]

  if (target === undefined || kindOf(target) !== 'member_expression') {
    return []
  }

  const targetObject = target.children()[0]
  const targetProperty = textOf(childrenOfKind(target, ['property_identifier'])[0])

  // `exports.name = …` and `module.exports.name = …` name themselves.
  if (
    (isExportsTarget(targetObject) || isModuleExportsTarget(targetObject)) &&
    targetProperty !== undefined
  ) {
    return [targetProperty]
  }

  if (!isModuleExportsTarget(target)) {
    return []
  }

  // `module.exports = …`. The name has to come from the right-hand side.
  const right = node.children().at(-1)

  if (right === undefined) {
    return []
  }

  const rightKind = kindOf(right)

  if (rightKind === 'object') {
    // `{ a, b }` puts the shorthand identifier directly under the object, while
    // `{ a: impl }` wraps it in a `pair`. Reading only the pair form silently
    // dropped every shorthand export — the commonest spelling of the canonical
    // `module.exports = { … }`.
    return right.children().flatMap((property) => {
      if (kindOf(property) === 'shorthand_property_identifier') {
        return [property.text()]
      }

      const key = childrenOfKind(property, [
        'property_identifier',
        'shorthand_property_identifier'
      ])[0]

      return key === undefined ? [] : [key.text()]
    })
  }

  if (rightKind === 'function_expression' || rightKind === 'class') {
    const name = textOf(firstChildOfKind(right, ['identifier', 'type_identifier']))

    return name === undefined ? [] : [name]
  }

  if (rightKind === 'identifier') {
    return [right.text()]
  }

  // An anonymous `module.exports = function () {}` names nothing a peer set or a
  // reference lookup could match on, so it is deliberately not recorded rather
  // than invented as a placeholder.
  return []
}

// Behavioural named declarations, for the `declaration`/`public-symbol` facts the
// other five languages already emit. No `interface`, no `type` alias: a construct
// with no body cannot hold a behavioural pattern.
const ecmascriptNamedDeclarationKinds = [
  'function_declaration',
  'generator_function_declaration',
  'class_declaration',
  'abstract_class_declaration',
  'method_definition'
] as const

const functionValuedDeclaratorName = (node: AstNode): string | undefined => {
  const value = node.children().at(-1)

  if (
    value === undefined ||
    !['arrow_function', 'function_expression', 'class', 'generator_function'].includes(
      kindOf(value)
    )
  ) {
    return undefined
  }

  const bound = node.children()[0]

  return bound !== undefined && kindOf(bound) === 'identifier' ? textOf(bound) : undefined
}

const extractEcmascriptFacts = (
  language: PolyglotLanguage,
  path: string,
  root: AstNode,
  contentHash: string
): readonly SupportSignalFact[] => {
  const facts: SupportSignalFact[] = []
  const exportedLines = new Set<number>()

  walkAst(root, (node) => {
    if (kindOf(node) === 'export_statement') {
      const declaration = firstChildOfKind(node, [
        ...ecmascriptDeclarationKinds,
        ...ecmascriptVariableKinds
      ])

      if (declaration !== undefined) {
        exportedLines.add(lineFor(declaration))
      }
    }
  })

  walkAst(root, (node) => {
    const kind = kindOf(node)
    const named = node.field('name')
    const declaredName = ecmascriptNamedDeclarationKinds.some((k) => k === kind)
      ? named === null || named === undefined
        ? undefined
        : textOf(named)
      : kind === 'variable_declarator'
        ? functionValuedDeclaratorName(node)
        : undefined

    if (declaredName !== undefined) {
      const span = spanFor(node)

      facts.push(
        createFact(language, contentHash, path, {
          kind: 'declaration',
          name: declaredName,
          ...span
        })
      )

      if (exportedLines.has(span.line)) {
        facts.push(
          createFact(language, contentHash, path, {
            kind: 'public-symbol',
            name: declaredName,
            ...span
          })
        )
      }
    }

    if (kind === 'import_statement') {
      facts.push(
        ...collectEcmascriptImportFacts(language, node, path, contentHash)
      )
    }

    if (kind === 'export_statement') {
      facts.push(
        ...collectEcmascriptExportFacts(language, node, path, contentHash)
      )
    }

    for (const name of commonJsExportedNames(node)) {
      facts.push(
        createFact(language, contentHash, path, {
          kind: 'export',
          name,
          ...spanFor(node)
        })
      )
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
  if (language === 'typescript' || language === 'javascript') {
    return extractEcmascriptFacts(language, path, root, contentHash)
  }

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

      // A parse error costs the file its facts for most languages. For
      // ECMAScript it must not, because the engine replaced here reported parse
      // diagnostics AND still extracted — and the grammar has a real gap that
      // makes this common in published packages: exporting under a RESERVED WORD
      // (`export { _null as null }`, `as void`, `as function`) is legal
      // ECMAScript that tree-sitter rejects. Discarding those files cost 512
      // facts across 4 of 1 897 real files, and lost them silently — the file
      // reported "nothing to say" rather than "could not see".
      //
      // tree-sitter recovers, so the rest of the tree is sound and the valid
      // parts still yield correct facts. Doing the same for the other five
      // languages is probably right too, but that changes their behaviour and
      // needs its own measurement rather than a free ride on this one.
      if (
        astParseResult.root === undefined ||
        !(language === 'typescript' || language === 'javascript')
      ) {
        continue
      }
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
