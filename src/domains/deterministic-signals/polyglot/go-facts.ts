import type { SupportSignalFact } from '../shared/deterministic-signal-types.js'
import {
  type AstNode,
  createFact,
  firstChildOfKind,
  lastPathSegment,
  spanFor,
  startsWithUppercase,
  textOf,
  trimQuotes,
  walkAst,
  kindOf
} from './ast-helpers.js'

export const extractGoFacts = (
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
