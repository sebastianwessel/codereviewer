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
  detectSupportSignalFiles,
  hasLanguageExtension,
  hashSegment,
  normalizeSignalPath,
  sha256
} from '../shared/deterministic-signal-utils.js'
import { discoverSignalLanguageTests } from '../shared/test-discovery.js'
import type { AstNode, PolyglotLanguage } from './ast-helpers.js'
import { extractEcmascriptFacts } from './ecmascript-facts.js'
import { extractGoFacts } from './go-facts.js'
import { extractJavaFacts } from './java-facts.js'
import { extractPythonFacts } from './python-facts.js'
import { extractRubyFacts } from './ruby-facts.js'
import { extractRustFacts } from './rust-facts.js'

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

type SupportSignalFactExtractor = (
  path: string,
  root: AstNode,
  contentHash: string
) => readonly SupportSignalFact[]

// WHICH EXTRACTOR READS WHICH GRAMMAR. A `Record` over the language union, not an
// if-chain, and the difference is the whole point of this declaration.
//
// This was a chain of `if (language === …)` tests that ENDED in a bare
// `return extractJavaFacts(path, root, contentHash)`. Java was not chosen there; it
// was simply last, so every language without a branch inherited it. An eighth
// member added to `SupportedSignalLanguage` would have type-checked, parsed with
// its own grammar, and then had that tree read by Java's extractor — which would
// find Java's node kinds absent and emit a plausible, small, WRONG set of facts.
// Not an error, not silence: confident wrong facts, attributed to the new language,
// flowing into changed-symbol resolution and the review packet. That is the
// silent-optimism class this repository keeps re-finding, armed to fire on the one
// change most likely to trip it.
//
// As a `Record` keyed by the union, `satisfies` refuses to compile until the new
// language has an extractor, and there is no last branch to fall into.
const factExtractorsByLanguage = {
  // ECMAScript is one extractor serving two languages, so it takes the language as
  // an argument; every other extractor serves exactly one and does not need it.
  typescript: (path, root, contentHash) =>
    extractEcmascriptFacts('typescript', path, root, contentHash),
  javascript: (path, root, contentHash) =>
    extractEcmascriptFacts('javascript', path, root, contentHash),
  python: extractPythonFacts,
  go: extractGoFacts,
  rust: extractRustFacts,
  java: extractJavaFacts,
  ruby: extractRubyFacts
} satisfies Record<SupportedSignalLanguage, SupportSignalFactExtractor>

const extractFacts = (
  language: PolyglotLanguage,
  path: string,
  root: AstNode,
  contentHash: string
): readonly SupportSignalFact[] => {
  // Typed through `| undefined` deliberately. The record is exhaustive over the
  // union, so this branch is unreachable for any value the type system vouched
  // for — and unreachable is not the same as impossible. A language string that
  // arrives from parsed configuration, a fixture, or a cast has never been checked
  // by anything, and the branch it would otherwise fall into is what produced the
  // wrong-facts defect above. It fails loudly instead.
  const extractor: SupportSignalFactExtractor | undefined =
    factExtractorsByLanguage[language]

  if (extractor === undefined) {
    throw new TypeError(
      `No support signal fact extractor is registered for language "${language}".`
    )
  }

  return extractor(path, root, contentHash)
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
