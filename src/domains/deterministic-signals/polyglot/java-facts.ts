import type { SupportSignalFact } from '../shared/deterministic-signal-types.js'
import {
  type AstNode,
  childrenOfKind,
  createFact,
  firstChildOfKind,
  lastPathSegment,
  spanFor,
  textOf,
  walkAst,
  kindOf
} from './ast-helpers.js'

const javaDeclarationName = (node: AstNode): string | undefined =>
  textOf(firstChildOfKind(node, ['identifier']))

const hasJavaPublicModifier = (node: AstNode): boolean =>
  childrenOfKind(node, ['modifiers']).some((modifiers) =>
    modifiers.children().some((child) => kindOf(child) === 'public')
  )

export const extractJavaFacts = (
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
