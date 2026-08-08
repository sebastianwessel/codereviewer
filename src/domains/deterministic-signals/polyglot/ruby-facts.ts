import type { SupportSignalFact } from '../shared/deterministic-signal-types.js'
import {
  type AstNode,
  createFact,
  firstChildOfKind,
  firstDescendantOfKind,
  lastPathSegment,
  spanFor,
  textOf,
  trimQuotes,
  walkAst,
  kindOf
} from './ast-helpers.js'

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

export const extractRubyFacts = (
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
