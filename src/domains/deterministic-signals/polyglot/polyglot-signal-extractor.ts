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

const extractFacts = (
  language: PolyglotLanguage,
  path: string,
  root: AstNode,
  contentHash: string
): readonly SupportSignalFact[] => {
  if (language === 'typescript' || language === 'javascript') {
    return extractEcmascriptFacts(language, path, root, contentHash)
  }

  if (language === 'python') {
    return extractPythonFacts(path, root, contentHash)
  }

  if (language === 'go') {
    return extractGoFacts(path, root, contentHash)
  }

  if (language === 'rust') {
    return extractRustFacts(path, root, contentHash)
  }

  if (language === 'ruby') {
    return extractRubyFacts(path, root, contentHash)
  }

  return extractJavaFacts(path, root, contentHash)
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
