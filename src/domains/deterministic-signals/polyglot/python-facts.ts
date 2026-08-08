import type { SupportSignalFact } from '../shared/deterministic-signal-types.js'
import {
  type AstNode,
  createFact,
  firstChildOfKind,
  firstIdentifierText,
  lastIdentifierText,
  moduleTextFromImportTarget,
  spanFor,
  textOf,
  walkAst,
  kindOf
} from './ast-helpers.js'

const pythonImportName = (
  node: AstNode,
  mode: 'import' | 'from-import'
): string | undefined => {
  if (kindOf(node) === 'aliased_import') {
    return textOf(firstChildOfKind(node, ['identifier']))
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

export const extractPythonFacts = (
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
