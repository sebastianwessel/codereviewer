// Every supported language must reach ITS OWN extractor, and a language that
// reaches none must fail loudly.
//
// THE DEFECT CLASS. "Which languages does this engine support" is stated five
// times — the `SupportedSignalLanguage` union, the extension table, the adapter
// registry, the fact-extractor dispatch, and the ast-grep grammar registration —
// and only some of those shapes let TypeScript check the set is complete. The
// dispatch used to be an if-chain ending in an unguarded
// `return extractJavaFacts(...)`, so a language with no branch did not error and
// did not go silent: it was parsed with its own grammar and then read by JAVA's
// extractor. Java's node kinds are absent from another grammar's tree, so what
// came back was a small, plausible, WRONG set of facts, labelled with the new
// language, feeding changed-symbol resolution and the review packet. Nothing
// anywhere would have said so.
//
// WHAT TYPESCRIPT NOW CATCHES ON ITS OWN, so this file does not re-test it: the
// adapter registry is a mapped type over the union, the extractor dispatch is a
// `Record` over it, the grammar registration is a `Record` over it minus the two
// grammars ast-grep ships built in, and the extension table is checked by
// `SignalLanguagesWithoutExtensions`. Adding an eighth language fails `tsc` at
// four sites before any test runs. That is the primary guard and it is worth more
// than anything here.
//
// WHY THERE IS A TEST ANYWAY. A structural check proves each list has an entry per
// language; it cannot prove the entry is the RIGHT one. `java: extractRubyFacts`
// type-checks perfectly. The old fall-through was, in effect, exactly that
// mis-binding for six languages at once, and the only thing that can catch it is
// running each language's extractor over that language's source and looking at
// what comes back. Nor can the type system speak for a language value that never
// passed through it — from parsed configuration, a fixture, or a cast — which is
// the population the runtime guards exist for.

import { describe, expect, test } from 'vitest'
import { parseWithAstGrep } from './ast-grep/ast-grep-parser.js'
import {
  extractDeterministicSignals,
  extractPolyglotSignals,
  supportedSignalLanguages,
  type SupportedSignalLanguage
} from './index.js'

// One minimal source file per language, each declaring a symbol whose name is
// unique across the table. The name is what makes the assertion specific: a fact
// carrying it can only have come from a parser that understood THIS grammar, so a
// language routed to a foreign extractor cannot produce it by luck.
const languageSamples: Readonly<
  Record<SupportedSignalLanguage, { readonly path: string; readonly content: string }>
> = {
  typescript: {
    path: 'src/sample-ts.ts',
    content: 'export const tsOwnedSymbol = 1\n'
  },
  javascript: {
    path: 'src/sample-js.js',
    content: 'export function jsOwnedSymbol() {}\n'
  },
  python: {
    path: 'pkg/sample_py.py',
    content: 'class PyOwnedSymbol:\n    pass\n'
  },
  go: {
    path: 'cmd/sample-go.go',
    content: 'package main\n\nfunc GoOwnedSymbol() {}\n'
  },
  rust: {
    path: 'src/sample-rs.rs',
    content: 'pub fn rs_owned_symbol() {}\n'
  },
  java: {
    path: 'src/JavaOwnedSymbol.java',
    content: 'public class JavaOwnedSymbol {}\n'
  },
  ruby: {
    path: 'lib/sample_rb.rb',
    content: 'class RbOwnedSymbol\nend\n'
  }
}

const ownedSymbolFor = (language: SupportedSignalLanguage): string =>
  ({
    typescript: 'tsOwnedSymbol',
    javascript: 'jsOwnedSymbol',
    python: 'PyOwnedSymbol',
    go: 'GoOwnedSymbol',
    rust: 'rs_owned_symbol',
    java: 'JavaOwnedSymbol',
    ruby: 'RbOwnedSymbol'
  })[language]

describe('supported signal language coverage', () => {
  test('there are languages to check', () => {
    // ANTI-VACUITY. Every assertion below is driven by `supportedSignalLanguages`,
    // so an empty or truncated list would make this whole file pass while checking
    // nothing — the same shape of silent success it exists to catch.
    expect(supportedSignalLanguages).toHaveLength(
      Object.keys(languageSamples).length
    )
    expect([...supportedSignalLanguages].sort()).toEqual(
      Object.keys(languageSamples).sort()
    )
  })

  test.each([...supportedSignalLanguages])(
    '%s is read by its own extractor, not by another language\'s',
    (language) => {
      const sample = languageSamples[language]
      const result = extractPolyglotSignals(language, [sample])
      const names = result.facts.map((fact) => fact.name)

      // The symbol only this grammar's extractor can name. Java's extractor over a
      // non-Java tree finds none of its own node kinds and returns facts that do
      // not contain it — which is precisely what the removed fall-through produced.
      expect(names).toContain(ownedSymbolFor(language))
      expect(result.facts.every((fact) => fact.language === language)).toBe(true)
    }
  )

  test('routing every language at once keeps each file with its own extractor', () => {
    // The per-language assertions above call the extractor directly. This one goes
    // through the registry's routing, so a language that routes correctly in
    // isolation but is grouped wrongly in a mixed set is still caught.
    const result = extractDeterministicSignals(
      supportedSignalLanguages.map((language) => languageSamples[language])
    )

    for (const language of supportedSignalLanguages) {
      const names = result.facts
        .filter((fact) => fact.language === language)
        .map((fact) => fact.name)

      expect(names).toContain(ownedSymbolFor(language))
    }
  })

  test('an unhandled language raises and produces no facts at all', () => {
    // The cast reproduces a language value that never passed the type system —
    // from parsed configuration, a fixture, or a cast exactly like this one.
    //
    // WHICH GATE CATCHES IT, stated because a test that passes for a reason other
    // than the one it names is worse than no test. The extension table refuses
    // first: `hasLanguageExtension` throws for a language it has no entry for,
    // before the fact dispatch is reached. That gate was always there and is NOT
    // what was broken. What was broken sat behind it — a language WITH an extension
    // entry but no dispatch branch fell through to `extractJavaFacts`, which is the
    // exact shape adding an eighth language produces: the union and the extension
    // table get updated together, the dispatch is the one that gets forgotten. That
    // combination is now a compile error, so it cannot be reproduced here at all;
    // this asserts the outer gate still holds and, crucially, that the failure is a
    // raise rather than a set of facts.
    const unhandled = 'kotlin' as SupportedSignalLanguage

    expect(() =>
      extractPolyglotSignals(unhandled, [
        { path: 'src/Sample.kt', content: 'fun main() {}\n' }
      ])
    ).toThrow(/kotlin/u)

    // The failure the fall-through produced was never an exception — it was Java's
    // extractor returning a short, plausible fact list for a tree it did not
    // understand. Asserting "throws" alone would not have caught it, so assert that
    // no path through the engine yields facts for an unhandled language.
    const parsed = parseWithAstGrep({
      language: unhandled,
      path: 'src/Sample.kt',
      content: 'fun main() {}\n'
    })

    expect(parsed.parsed).toBe(false)
    expect(parsed.root).toBeUndefined()
  })
})
