import ts from 'typescript'
import {
  EvidenceRecordSchema,
  type CodeLocation,
  type EvidenceRecord
} from '../../../shared/contracts/index.js'
import type {
  SupportedSignalLanguage,
  DeterministicSignalExtraction,
  SupportSignalFile,
  SupportSignalFact,
  SupportSignalSourceFile
} from '../shared/deterministic-signal-types.js'
import {
  createSupportSignalFact,
  detectSupportSignalFiles,
  hasLanguageExtension,
  hashSegment,
  normalizeSignalPath,
  optionalModuleSpecifier,
  sha256
} from '../shared/deterministic-signal-utils.js'
import { discoverSignalLanguageTests } from '../shared/test-discovery.js'

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
  language: SupportedSignalLanguage,
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
    source: `${language}-support-signal`,
    sourceVersion: ts.version,
    contentHash,
    redactionApplied: true
  })

const collectImportFacts = (
  language: SupportedSignalLanguage,
  node: ts.ImportDeclaration,
  sourceFile: ts.SourceFile,
  path: string,
  contentHash: string
): readonly SupportSignalFact[] => {
  const importClause = node.importClause
  const moduleSpecifier = stringLiteralText(node.moduleSpecifier)
  const line = lineFor(sourceFile, node)
  const facts: SupportSignalFact[] = []

  if (importClause?.name !== undefined) {
    facts.push(
      createSupportSignalFact({
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
      createSupportSignalFact({
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
        createSupportSignalFact({
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

// The names a CommonJS assignment exports, or an empty list when the node is not
// one.
//
// WHY THIS EXISTS. The extractor recognised ESM `export` and nothing else, so a
// CommonJS file produced NO facts at all. Measured 2026-07-30 over four real
// JavaScript repositories (1,046 `.js` files): six declarations in total, and
// `fastify`'s 701-line `lib/route.js` produced zero. That is not a niche gap —
// these facts feed the stage-1 support-signal packet, `impact check`'s changed
// symbols, and `conformance check`'s declarations, so a CommonJS codebase
// degraded all three SILENTLY, reporting "nothing to say" rather than "cannot
// see".
//
// Scope is deliberately like-for-like: a CommonJS export becomes the same
// `export` fact an ESM export would. No new fact kind, and unexported top-level
// declarations stay invisible here exactly as they are for ESM — that is a
// separate, already-recorded hole, and widening it here would change what every
// downstream consumer receives without a spec.
//
// Applies to `.ts` as well as `.js`: a TypeScript file may use CommonJS, and the
// parse is identical.
const commonJsExportedNames = (node: ts.Node): readonly string[] => {
  if (!ts.isExpressionStatement(node)) {
    return []
  }

  const expression = node.expression

  if (
    !ts.isBinaryExpression(expression) ||
    expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken ||
    !ts.isPropertyAccessExpression(expression.left)
  ) {
    return []
  }

  const target = expression.left
  const isExportsIdentifier = (candidate: ts.Node): boolean =>
    ts.isIdentifier(candidate) && candidate.text === 'exports'
  // `module.exports`
  const isModuleExports = (candidate: ts.Node): boolean =>
    ts.isPropertyAccessExpression(candidate) &&
    ts.isIdentifier(candidate.expression) &&
    candidate.expression.text === 'module' &&
    candidate.name.text === 'exports'

  // `exports.name = ...` and `module.exports.name = ...` name themselves.
  if (isExportsIdentifier(target.expression) || isModuleExports(target.expression)) {
    return [target.name.text]
  }

  if (!isModuleExports(target)) {
    return []
  }

  // `module.exports = ...`. The name has to come from the right-hand side.
  const right = expression.right

  if (ts.isObjectLiteralExpression(right)) {
    // `module.exports = { a, b: impl }` — the canonical multi-export form.
    return right.properties
      .map((property) =>
        property.name !== undefined && ts.isIdentifier(property.name)
          ? property.name.text
          : undefined
      )
      .filter((name): name is string => name !== undefined)
  }

  if (
    (ts.isFunctionExpression(right) || ts.isClassExpression(right)) &&
    right.name !== undefined
  ) {
    return [right.name.text]
  }

  if (ts.isIdentifier(right)) {
    return [right.text]
  }

  // An anonymous `module.exports = function () {}` names nothing a peer set or a
  // reference lookup could match on, so it is deliberately not recorded rather
  // than invented as a placeholder.
  return []
}

const collectCommonJsExportFacts = (
  language: SupportedSignalLanguage,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  path: string,
  contentHash: string
): readonly SupportSignalFact[] => {
  const names = commonJsExportedNames(node)

  if (names.length === 0) {
    return []
  }

  const line = lineFor(sourceFile, node)

  return names.map((name) =>
    createSupportSignalFact({
      language,
      kind: 'export',
      path,
      name,
      line,
      contentHash
    })
  )
}

const collectExportFacts = (
  language: SupportedSignalLanguage,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  path: string,
  contentHash: string
): readonly SupportSignalFact[] => {
  const line = lineFor(sourceFile, node)

  if (ts.isExportDeclaration(node)) {
    const facts: SupportSignalFact[] = []
    const moduleSpecifier = stringLiteralText(node.moduleSpecifier)
    const exportClause = node.exportClause

    if (exportClause === undefined) {
      facts.push(
        createSupportSignalFact({
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
          createSupportSignalFact({
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
        createSupportSignalFact({
          language,
          kind: 'export',
          path,
          name,
        line,
        contentHash
      })
    ]
}

export const extractEcmascriptSignals = (
  language: 'typescript' | 'javascript',
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
      facts.push(
        ...collectCommonJsExportFacts(
          language,
          node,
          sourceFile,
          path,
          contentHash
        )
      )
      ts.forEachChild(node, visit)
    }

    visit(sourceFile)
  }

  return { facts, evidence }
}

export const detectEcmascriptSignalFiles = (
  language: 'typescript' | 'javascript',
  files: readonly SupportSignalFile[]
) => detectSupportSignalFiles(language, files)

export const discoverEcmascriptSignalTestMappings = (
  language: 'typescript' | 'javascript',
  files: readonly SupportSignalFile[]
) => discoverSignalLanguageTests(language, files)
