import type { SgNode } from '@ast-grep/napi'
import type {
  SupportedSignalLanguage,
  SupportSignalFact
} from '../shared/deterministic-signal-types.js'
import { createSupportSignalFact } from '../shared/deterministic-signal-utils.js'

// Every supported language runs through this engine, so the alias is simply the
// supported set. It is kept as a name because the exported functions read better
// with it than with a bare `SupportedSignalLanguage` repeated at each site.
export type PolyglotLanguage = SupportedSignalLanguage

export const createFact = (
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

export type AstNode = SgNode

export const kindOf = (node: AstNode): string => String(node.kind())

export const lineFor = (node: AstNode): number => node.range().start.line + 1

// The 1-based line range the node occupies, from the grammar's own range. Every
// adapter below reports it for every fact, so the extent of a declaration is read
// rather than inferred from whatever declaration happens to follow it.
export const spanFor = (node: AstNode): { readonly line: number; readonly endLine: number } => {
  const range = node.range()
  const line = range.start.line + 1

  return { line, endLine: Math.max(line, range.end.line + 1) }
}

export const childrenOfKind = (
  node: AstNode,
  kinds: readonly string[]
): readonly AstNode[] => node.children().filter((child) => kinds.includes(kindOf(child)))

export const firstChildOfKind = (
  node: AstNode,
  kinds: readonly string[]
): AstNode | undefined => childrenOfKind(node, kinds)[0]

export const walkAst = (root: AstNode, visit: (node: AstNode) => void): void => {
  const stack = [root]

  while (stack.length > 0) {
    const node = stack.pop()!
    visit(node)
    stack.push(...[...node.children()].reverse())
  }
}

export const descendantsOfKind = (
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

export const firstDescendantOfKind = (
  node: AstNode,
  kinds: readonly string[]
): AstNode | undefined => descendantsOfKind(node, kinds)[0]

export const hasChildOfKind = (node: AstNode, kinds: readonly string[]): boolean =>
  firstChildOfKind(node, kinds) !== undefined

export const textOf = (node: AstNode | undefined): string | undefined => {
  const text = node?.text().trim()

  return text === '' ? undefined : text
}

export const trimQuotes = (value: string): string => {
  const trimmed = value.trim()
  const first = trimmed[0]
  const last = trimmed.at(-1)

  return first !== undefined &&
    first === last &&
    (first === '"' || first === "'" || first === '`')
    ? trimmed.slice(1, -1)
    : trimmed
}

export const lastPathSegment = (value: string, separator: string): string =>
  value.split(separator).filter(Boolean).at(-1) ?? value

export const startsWithUppercase = (value: string): boolean => {
  const first = value[0]

  return first !== undefined && first === first.toUpperCase() && first !== first.toLowerCase()
}

export const firstIdentifierText = (node: AstNode): string | undefined =>
  textOf(firstDescendantOfKind(node, ['identifier', 'type_identifier', 'package_identifier']))

export const lastIdentifierText = (node: AstNode): string | undefined => {
  const identifiers = descendantsOfKind(node, [
    'identifier',
    'type_identifier',
    'package_identifier'
  ])

  return textOf(identifiers.at(-1))
}

export const moduleTextFromImportTarget = (node: AstNode): string | undefined =>
  textOf(firstChildOfKind(node, ['dotted_name'])) ?? textOf(node)
