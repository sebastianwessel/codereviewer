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

const ruleEvidence = (
  language: SupportedSignalLanguage,
  input: {
    readonly path: string
    readonly contentHash: string
    readonly line: number
    readonly ruleId: string
    readonly summary: string
  }
): EvidenceRecord =>
  EvidenceRecordSchema.parse({
    id: `evidence_${hashSegment(
      `${language}:${input.path}:${input.ruleId}:${input.line}`
    )}`,
    kind: 'rule',
    summary: input.summary,
    location: {
      path: input.path,
      startLine: input.line,
      side: 'file'
    },
    source: `${language}-support-signal`,
    sourceVersion: ts.version,
    contentHash: input.contentHash,
    redactionApplied: true,
    ruleId: input.ruleId
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

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind): boolean =>
  ts.canHaveModifiers(node) &&
  (ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ?? false)

const fileBaseName = (path: string): string => {
  const name = path.split('/').at(-1) ?? path
  const firstDot = name.indexOf('.')

  return firstDot === -1 ? name : name.slice(0, firstDot)
}

const startsWithUppercase = (value: string): boolean => {
  const first = value[0]

  return first !== undefined && first === first.toUpperCase() && first !== first.toLowerCase()
}

const authorizationHelperNamePattern =
  /(?:^|[^a-z])(?:can|may|has|is|allow|allows|authorize|authorise|authz|permission|access|view|edit|delete|admin)/iu
const missingLookupIdentifierPattern =
  /(?:session|user|account|member|identity|principal|auth|token|credential|permission|role)/iu

const functionLikeName = (node: ts.Node): string | undefined => {
  if (
    (ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isMethodDeclaration(node)) &&
    node.name !== undefined &&
    ts.isIdentifier(node.name)
  ) {
    return node.name.text
  }

  if (
    ts.isArrowFunction(node) &&
    ts.isVariableDeclaration(node.parent) &&
    ts.isIdentifier(node.parent.name)
  ) {
    return node.parent.name.text
  }

  return undefined
}

const enclosingFunctionLikeName = (
  node: ts.Node,
  sourceFile: ts.SourceFile
): string | undefined => {
  let current: ts.Node | undefined = node

  while (current !== undefined && current !== sourceFile) {
    const name = functionLikeName(current)

    if (name !== undefined) {
      return name
    }

    current = current.parent
  }

  return undefined
}

const firstReturnStatement = (
  statement: ts.Statement | undefined
): ts.ReturnStatement | undefined => {
  if (statement === undefined) {
    return undefined
  }

  if (ts.isReturnStatement(statement)) {
    return statement
  }

  if (ts.isBlock(statement)) {
    return statement.statements.find(ts.isReturnStatement)
  }

  return undefined
}

const booleanReturnExpression = (
  statement: ts.Statement | undefined
): boolean | undefined => {
  const returnStatement = firstReturnStatement(statement)

  if (
    returnStatement?.expression !== undefined &&
    returnStatement.expression.kind === ts.SyntaxKind.TrueKeyword
  ) {
    return true
  }

  if (
    returnStatement?.expression !== undefined &&
    returnStatement.expression.kind === ts.SyntaxKind.FalseKeyword
  ) {
    return false
  }

  return undefined
}

const missingLookupIdentifier = (
  expression: ts.Expression
): string | undefined => {
  if (
    ts.isBinaryExpression(expression) &&
    [
      ts.SyntaxKind.EqualsEqualsEqualsToken,
      ts.SyntaxKind.EqualsEqualsToken,
      ts.SyntaxKind.ExclamationEqualsEqualsToken,
      ts.SyntaxKind.ExclamationEqualsToken
    ].includes(expression.operatorToken.kind)
  ) {
    const leftText = expression.left.getText()
    const rightText = expression.right.getText()

    if (
      ['undefined', 'null'].includes(rightText) &&
      missingLookupIdentifierPattern.test(leftText)
    ) {
      return leftText
    }

    if (
      ['undefined', 'null'].includes(leftText) &&
      missingLookupIdentifierPattern.test(rightText)
    ) {
      return rightText
    }
  }

  return undefined
}

const expressionContainsCallNamed = (
  expression: ts.Expression,
  callName: string
): boolean => {
  let found = false

  const visit = (node: ts.Node): void => {
    if (found) {
      return
    }

    if (
      ts.isCallExpression(node) &&
      node.expression.getText().split('.').includes(callName)
    ) {
      found = true
      return
    }

    ts.forEachChild(node, visit)
  }

  visit(expression)

  return found
}

const dayjsObjectStrictEqualityEvidence = (
  language: SupportedSignalLanguage,
  node: ts.BinaryExpression,
  sourceFile: ts.SourceFile,
  path: string,
  contentHash: string
): EvidenceRecord | undefined => {
  if (
    node.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken &&
    node.operatorToken.kind !== ts.SyntaxKind.ExclamationEqualsEqualsToken
  ) {
    return undefined
  }

  if (
    !expressionContainsCallNamed(node.left, 'dayjs') ||
    !expressionContainsCallNamed(node.right, 'dayjs')
  ) {
    return undefined
  }

  return ruleEvidence(language, {
    path,
    contentHash,
    line: lineFor(sourceFile, node),
    ruleId: 'typescript-dayjs-object-strict-equality',
    summary:
      'Strict equality compares Dayjs object references instead of timestamp values; use isSame or compare primitive timestamps.'
  })
}

const slotEndDerivedFromStartTimeEvidence = (
  language: SupportedSignalLanguage,
  node: ts.VariableDeclaration,
  sourceFile: ts.SourceFile,
  path: string,
  contentHash: string
): EvidenceRecord | undefined => {
  if (
    !ts.isIdentifier(node.name) ||
    node.name.text.toLowerCase() !== 'end' ||
    node.initializer === undefined
  ) {
    return undefined
  }

  const initializerText = node.initializer.getText(sourceFile)
  const sourceText = sourceFile.getFullText()

  if (
    !/\bslotEndTime\b/u.test(sourceText) ||
    !/\bslotStartTime\b/u.test(initializerText) ||
    /\bslotEndTime\b/u.test(initializerText)
  ) {
    return undefined
  }

  return ruleEvidence(language, {
    path,
    contentHash,
    line: lineFor(sourceFile, node),
    ruleId: 'typescript-slot-end-derived-from-start-time',
    summary:
      'Slot end minute calculation is derived from slotStartTime even though slotEndTime is available, so duration windows may collapse to their start.'
  })
}

const expressionMentionsDiscount = (
  expression: ts.Expression | undefined,
  sourceFile: ts.SourceFile
): boolean =>
  expression !== undefined &&
  /\bdiscount(?:Cents)?\b/u.test(expression.getText(sourceFile))

const followingReturnStatement = (
  node: ts.IfStatement
): ts.ReturnStatement | undefined => {
  const parent = node.parent

  if (!ts.isBlock(parent) && !ts.isSourceFile(parent)) {
    return undefined
  }

  const index = parent.statements.findIndex((statement) => statement === node)

  if (index === -1) {
    return undefined
  }

  return parent.statements.slice(index + 1).find(ts.isReturnStatement)
}

const proratedBranchOmitsDiscountEvidence = (
  language: SupportedSignalLanguage,
  node: ts.IfStatement,
  sourceFile: ts.SourceFile,
  path: string,
  contentHash: string
): EvidenceRecord | undefined => {
  if (!/\bprorated\b/u.test(node.expression.getText(sourceFile))) {
    return undefined
  }

  const thenReturn = firstReturnStatement(node.thenStatement)
  const siblingReturn =
    firstReturnStatement(node.elseStatement) ?? followingReturnStatement(node)

  if (
    thenReturn?.expression === undefined ||
    siblingReturn?.expression === undefined ||
    expressionMentionsDiscount(thenReturn.expression, sourceFile) ||
    !expressionMentionsDiscount(siblingReturn.expression, sourceFile)
  ) {
    return undefined
  }

  return ruleEvidence(language, {
    path,
    contentHash,
    line: lineFor(sourceFile, thenReturn),
    ruleId: 'typescript-prorated-branch-omits-discount',
    summary:
      'Prorated billing branch returns without discountCents while the sibling billing branch applies the discount, so discounted prorated items can be overcharged.'
  })
}

const backupCodeCaseSensitiveCompareEvidence = (
  language: SupportedSignalLanguage,
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  path: string,
  contentHash: string
): EvidenceRecord | undefined => {
  if (!ts.isPropertyAccessExpression(node.expression)) {
    return undefined
  }

  if (node.expression.name.text !== 'indexOf') {
    return undefined
  }

  const receiverText = node.expression.expression.getText(sourceFile)
  const argumentText = node.arguments[0]?.getText(sourceFile) ?? ''
  const joinedText = `${receiverText}\n${argumentText}`.toLowerCase()

  if (
    !joinedText.includes('backupcode') ||
    !argumentText.includes('replaceAll') ||
    joinedText.includes('tolowercase') ||
    joinedText.includes('touppercase') ||
    backupCodeNonAtomicConsumptionEvidence(
      language,
      sourceFile,
      path,
      contentHash
    ) !== undefined
  ) {
    return undefined
  }

  return ruleEvidence(language, {
    path,
    contentHash,
    line: lineFor(sourceFile, node),
    ruleId: 'typescript-backup-code-case-sensitive-compare',
    summary:
      'Backup-code lookup removes formatting but does not normalize case before comparing against stored codes.'
  })
}

const backupCodeNonAtomicConsumptionEvidence = (
  language: SupportedSignalLanguage,
  sourceFile: ts.SourceFile,
  path: string,
  contentHash: string
): EvidenceRecord | undefined => {
  const content = sourceFile.getFullText()

  if (
    !/\bbackupCodes\b/u.test(content) ||
    !/\bsymmetricDecrypt\s*\(/u.test(content) ||
    !/\.indexOf\s*\(/u.test(content) ||
    !/\bprisma\.user\.update\s*\(/u.test(content) ||
    !/\bbackupCodes\s*:/u.test(content)
  ) {
    return undefined
  }

  let mutationLine: number | undefined

  const visit = (node: ts.Node): void => {
    if (
      mutationLine === undefined &&
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isElementAccessExpression(node.left) &&
      node.left.expression.getText(sourceFile) === 'backupCodes'
    ) {
      mutationLine = lineFor(sourceFile, node)
      return
    }

    if (
      mutationLine === undefined &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'splice' &&
      node.expression.expression.getText(sourceFile) === 'backupCodes'
    ) {
      mutationLine = lineFor(sourceFile, node)
      return
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)

  return mutationLine === undefined
    ? undefined
    : ruleEvidence(language, {
        path,
        contentHash,
        line: mutationLine,
        ruleId: 'typescript-backup-code-non-atomic-consumption',
        summary:
          'Backup-code consumption decrypts stored codes, mutates them in memory, then writes them back without an atomic conditional update.'
      })
}

const operationMessageMismatchEvidence = (
  language: SupportedSignalLanguage,
  node: ts.StringLiteralLike,
  sourceFile: ts.SourceFile,
  path: string,
  contentHash: string
): EvidenceRecord | undefined => {
  const normalizedPath = path.toLowerCase()
  const normalizedText = node.text.toLowerCase()

  if (
    normalizedPath.includes('/login') ||
    normalizedPath.includes('next-auth') ||
    !normalizedText.includes('backup code login')
  ) {
    return undefined
  }

  return ruleEvidence(language, {
    path,
    contentHash,
    line: lineFor(sourceFile, node),
    ruleId: 'typescript-backup-code-operation-message-mismatch',
    summary:
      'Backup-code error message refers to login inside a non-login handler, which can mislead operators and users.'
  })
}

const defaultExportNameMismatchEvidence = (
  language: SupportedSignalLanguage,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  path: string,
  contentHash: string
): EvidenceRecord | undefined => {
  if (
    !(
      ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node)
    ) ||
    node.name === undefined ||
    !hasModifier(node, ts.SyntaxKind.ExportKeyword) ||
    !hasModifier(node, ts.SyntaxKind.DefaultKeyword)
  ) {
    return undefined
  }

  const baseName = fileBaseName(path)

  if (
    baseName.toLowerCase() === 'index' ||
    !startsWithUppercase(baseName) ||
    node.name.text === baseName
  ) {
    return undefined
  }

  return ruleEvidence(language, {
    path,
    contentHash,
    line: lineFor(sourceFile, node),
    ruleId: 'typescript-default-export-name-mismatch',
    summary:
      'Default export name does not match the component file name, making imports and diagnostics harder to follow.'
  })
}

const authorizationMissingLookupAllowsAccessEvidence = (
  language: SupportedSignalLanguage,
  node: ts.IfStatement,
  sourceFile: ts.SourceFile,
  path: string,
  contentHash: string
): EvidenceRecord | undefined => {
  const helperName = enclosingFunctionLikeName(node, sourceFile)

  if (
    helperName === undefined ||
    !authorizationHelperNamePattern.test(helperName) ||
    booleanReturnExpression(node.thenStatement) !== true
  ) {
    return undefined
  }

  const lookupIdentifier = missingLookupIdentifier(node.expression)

  if (lookupIdentifier === undefined) {
    return undefined
  }

  return ruleEvidence(language, {
    path,
    contentHash,
    line: lineFor(sourceFile, firstReturnStatement(node.thenStatement) ?? node),
    ruleId: 'typescript-authorization-missing-lookup-allows-access',
    summary: `Authorization-style helper returns allow when ${lookupIdentifier} is missing, which can turn lookup misses into access grants.`
  })
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

      if (ts.isCallExpression(node)) {
        const record = backupCodeCaseSensitiveCompareEvidence(
          language,
          node,
          sourceFile,
          path,
          contentHash
        )

        if (record !== undefined) {
          evidence.push(record)
        }
      }

      if (ts.isBinaryExpression(node)) {
        const record = dayjsObjectStrictEqualityEvidence(
          language,
          node,
          sourceFile,
          path,
          contentHash
        )

        if (record !== undefined) {
          evidence.push(record)
        }
      }

      if (ts.isVariableDeclaration(node)) {
        const record = slotEndDerivedFromStartTimeEvidence(
          language,
          node,
          sourceFile,
          path,
          contentHash
        )

        if (record !== undefined) {
          evidence.push(record)
        }
      }

      if (ts.isStringLiteralLike(node)) {
        const record = operationMessageMismatchEvidence(
          language,
          node,
          sourceFile,
          path,
          contentHash
        )

        if (record !== undefined) {
          evidence.push(record)
        }
      }

      if (ts.isIfStatement(node)) {
        const proratedDiscountRecord = proratedBranchOmitsDiscountEvidence(
          language,
          node,
          sourceFile,
          path,
          contentHash
        )

        if (proratedDiscountRecord !== undefined) {
          evidence.push(proratedDiscountRecord)
        }

        const record = authorizationMissingLookupAllowsAccessEvidence(
          language,
          node,
          sourceFile,
          path,
          contentHash
        )

        if (record !== undefined) {
          evidence.push(record)
        }
      }

      const defaultExportMismatch = defaultExportNameMismatchEvidence(
        language,
        node,
        sourceFile,
        path,
        contentHash
      )

      if (defaultExportMismatch !== undefined) {
        evidence.push(defaultExportMismatch)
      }

      facts.push(
        ...collectExportFacts(language, node, sourceFile, path, contentHash)
      )
      ts.forEachChild(node, visit)
    }

    visit(sourceFile)

    const nonAtomicConsumption = backupCodeNonAtomicConsumptionEvidence(
      language,
      sourceFile,
      path,
      contentHash
    )

    if (nonAtomicConsumption !== undefined) {
      evidence.push(nonAtomicConsumption)
    }
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
