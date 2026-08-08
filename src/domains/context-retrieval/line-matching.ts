// How a grep query is compared against a source line.
//
// `literal` is the historical behaviour: a plain substring test. It is the right
// default for a model-driven search, where the query is often a phrase or a
// fragment. It is the WRONG mode for a symbol lookup, because searching for
// `get` also matches `forget` and `widget`.
//
// `identifier` requires the query to appear bounded by non-identifier characters
// on both sides. The character class is deliberately language-neutral: letters,
// digits, `_` and `$` are identifier characters in every language this engine
// analyses, so the mode needs no per-language configuration.
export type ContextRetrievalMatchMode = 'literal' | 'identifier'

// Identifier characters shared by every language this engine analyses. Kept as
// one definition so the two lookarounds below can never disagree.
const identifierCharacterClass = 'A-Za-z0-9_$'

const escapeRegExp = (value: string): string =>
  value.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&')

// A predicate rather than a shared RegExp object, so no `lastIndex` state can
// leak between lines. The lookarounds (not `\b`) are what make the match work
// for a query that begins or ends with a non-word character.
export const createLineMatcher = (
  query: string,
  matchMode: ContextRetrievalMatchMode
): ((line: string) => boolean) => {
  if (matchMode === 'literal') {
    return (line) => line.includes(query)
  }

  const pattern = new RegExp(
    `(?<![${identifierCharacterClass}])${escapeRegExp(
      query
    )}(?![${identifierCharacterClass}])`,
    'u'
  )

  return (line) => pattern.test(line)
}
