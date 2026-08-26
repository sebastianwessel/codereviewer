import type { SupportSignalFact } from '../shared/deterministic-signal-types.js'
import {
  type AstNode,
  type PolyglotLanguage,
  childrenOfKind,
  createFact,
  firstChildOfKind,
  lineFor,
  spanFor,
  textOf,
  trimQuotes,
  walkAst,
  kindOf
} from './ast-helpers.js'

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

export const extractEcmascriptFacts = (
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
