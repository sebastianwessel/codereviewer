import type { SupportSignalFact } from '../shared/deterministic-signal-types.js'
import { isTestOnlyDeclaration } from '../shared/test-discovery.js'
import {
  type AstNode,
  createFact,
  descendantsOfKind,
  firstChildOfKind,
  hasChildOfKind,
  lastIdentifierText,
  spanFor,
  textOf,
  walkAst,
  kindOf
} from './ast-helpers.js'

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

export const extractRustFacts = (
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
