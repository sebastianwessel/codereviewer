import ts from 'typescript'
import {
  EvidenceRecordSchema,
  type CodeLocation,
  type EvidenceRecord
} from '../../../shared/contracts/index.js'
import type {
  FirstClassLanguage,
  LanguageAnalyzerAnalysis,
  LanguageAnalyzerFile,
  LanguageFact,
  LanguageSourceFile
} from '../shared/language-analyzer-types.js'
import {
  createLanguageFact,
  detectLanguageFiles,
  hasLanguageExtension,
  hashSegment,
  normalizeAnalyzerPath,
  optionalModuleSpecifier,
  sha256
} from '../shared/language-analyzer-utils.js'
import { discoverLanguageTests } from '../shared/test-discovery.js'

const extensionKindFor = (path: string): ts.ScriptKind => {
  if (path.endsWith('.tsx')) {
    return ts.ScriptKind.TSX
  }

  if (path.endsWith('.jsx')) {
    return ts.ScriptKind.JSX
  }

  if (path.endsWith('.js') || path.endsWith('.mjs') || path.endsWith('.cjs')) {
    return ts.ScriptKind.JS
  }

  return ts.ScriptKind.TS
}

const lineFor = (sourceFile: ts.SourceFile, node: ts.Node): number =>
  sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1

const stringLiteralText = (node: ts.Expression | undefined): string | undefined =>
  node !== undefined && ts.isStringLiteralLike(node) ? node.text : undefined

const parseDiagnosticsFor = (
  sourceFile: ts.SourceFile
): readonly ts.Diagnostic[] =>
  (sourceFile as ts.SourceFile & {
    readonly parseDiagnostics?: readonly ts.Diagnostic[]
  }).parseDiagnostics ?? []

const diagnosticLocation = (
  diagnostic: ts.Diagnostic,
  sourceFile: ts.SourceFile,
  path: string
): CodeLocation => {
  if (diagnostic.start === undefined) {
    return {
      path,
      startLine: 1,
      side: 'file'
    }
  }

  const position = sourceFile.getLineAndCharacterOfPosition(diagnostic.start)

  return {
    path,
    startLine: position.line + 1,
    startColumn: position.character + 1,
    side: 'file'
  }
}

const diagnosticSummary = (diagnostic: ts.Diagnostic): string =>
  ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ').slice(0, 500)

const diagnosticEvidence = (
  language: FirstClassLanguage,
  diagnostic: ts.Diagnostic,
  sourceFile: ts.SourceFile,
  path: string,
  contentHash: string
): EvidenceRecord =>
  EvidenceRecordSchema.parse({
    id: `evidence_${hashSegment(
      `${language}:${path}:${diagnostic.code}:${diagnostic.start ?? 0}`
    )}`,
    kind: 'diagnostic',
    summary: `Parse diagnostic TS${diagnostic.code}: ${diagnosticSummary(diagnostic)}`,
    location: diagnosticLocation(diagnostic, sourceFile, path),
    source: `${language}-analyzer`,
    sourceVersion: ts.version,
    contentHash,
    redactionApplied: true
  })

const collectImportFacts = (
  language: FirstClassLanguage,
  node: ts.ImportDeclaration,
  sourceFile: ts.SourceFile,
  path: string,
  contentHash: string
): readonly LanguageFact[] => {
  const importClause = node.importClause
  const moduleSpecifier = stringLiteralText(node.moduleSpecifier)
  const line = lineFor(sourceFile, node)
  const facts: LanguageFact[] = []

  if (importClause?.name !== undefined) {
    facts.push(
      createLanguageFact({
        language,
        kind: 'import',
        path,
        name: importClause.name.text,
        ...optionalModuleSpecifier(moduleSpecifier),
        line,
        contentHash
      })
    )
  }

  const namedBindings = importClause?.namedBindings

  if (namedBindings !== undefined && ts.isNamespaceImport(namedBindings)) {
    facts.push(
      createLanguageFact({
        language,
        kind: 'import',
        path,
        name: namedBindings.name.text,
        ...optionalModuleSpecifier(moduleSpecifier),
        line,
        contentHash
      })
    )
  }

  if (namedBindings !== undefined && ts.isNamedImports(namedBindings)) {
    for (const element of namedBindings.elements) {
      facts.push(
        createLanguageFact({
          language,
          kind: 'import',
          path,
          name: element.name.text,
          ...optionalModuleSpecifier(moduleSpecifier),
          line,
          contentHash
        })
      )
    }
  }

  return facts
}

const hasExportModifier = (node: ts.Node): boolean =>
  ts.canHaveModifiers(node) &&
  (ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ??
    false)

const declaredExportName = (node: ts.Node): string | undefined => {
  if (
    (ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isEnumDeclaration(node) ||
      ts.isModuleDeclaration(node)) &&
    node.name !== undefined
  ) {
    return node.name.text
  }

  if (ts.isVariableStatement(node)) {
    const firstDeclaration = node.declarationList.declarations[0]

    if (
      firstDeclaration !== undefined &&
      ts.isIdentifier(firstDeclaration.name)
    ) {
      return firstDeclaration.name.text
    }
  }

  return undefined
}

const collectExportFacts = (
  language: FirstClassLanguage,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  path: string,
  contentHash: string
): readonly LanguageFact[] => {
  const line = lineFor(sourceFile, node)

  if (ts.isExportDeclaration(node)) {
    const facts: LanguageFact[] = []
    const moduleSpecifier = stringLiteralText(node.moduleSpecifier)
    const exportClause = node.exportClause

    if (exportClause === undefined) {
      facts.push(
        createLanguageFact({
          language,
          kind: 'export',
          path,
          name: '*',
          ...optionalModuleSpecifier(moduleSpecifier),
          line,
          contentHash
        })
      )
    } else if (ts.isNamedExports(exportClause)) {
      for (const element of exportClause.elements) {
        facts.push(
          createLanguageFact({
            language,
            kind: 'export',
            path,
            name: element.name.text,
            ...optionalModuleSpecifier(moduleSpecifier),
            line,
            contentHash
          })
        )
      }
    }

    return facts
  }

  if (!hasExportModifier(node)) {
    return []
  }

  const name = declaredExportName(node)

  return name === undefined
    ? []
    : [
        createLanguageFact({
          language,
          kind: 'export',
          path,
          name,
          line,
          contentHash
        })
      ]
}

export const analyzeEcmascriptFiles = (
  language: 'typescript' | 'javascript',
  files: readonly LanguageSourceFile[]
): LanguageAnalyzerAnalysis => {
  const facts: LanguageFact[] = []
  const evidence: EvidenceRecord[] = []

  for (const file of files) {
    const path = normalizeAnalyzerPath(file.path)

    if (!hasLanguageExtension(language, path)) {
      throw new TypeError(`Unsupported ${language} analyzer path: ${path}`)
    }

    const contentHash = sha256(file.content)
    // TypeScript's compiler is the single source of truth for JS/TS parsing;
    // syntax errors surface through `parseDiagnosticsFor` below.

    const sourceFile = ts.createSourceFile(
      path,
      file.content,
      ts.ScriptTarget.Latest,
      true,
      extensionKindFor(path)
    )

    for (const diagnostic of parseDiagnosticsFor(sourceFile)) {
      evidence.push(
        diagnosticEvidence(language, diagnostic, sourceFile, path, contentHash)
      )
    }

    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node)) {
        facts.push(
          ...collectImportFacts(language, node, sourceFile, path, contentHash)
        )
      }

      facts.push(
        ...collectExportFacts(language, node, sourceFile, path, contentHash)
      )
      ts.forEachChild(node, visit)
    }

    visit(sourceFile)
  }

  return { facts, evidence }
}

export const detectEcmascriptFiles = (
  language: 'typescript' | 'javascript',
  files: readonly LanguageAnalyzerFile[]
) => detectLanguageFiles(language, files)

export const discoverEcmascriptTests = (
  language: 'typescript' | 'javascript',
  files: readonly LanguageAnalyzerFile[]
) => discoverLanguageTests(language, files)

