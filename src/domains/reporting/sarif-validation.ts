// Validate a rendered SARIF document against the structural invariants in
// `specs/03-contracts/finding-evidence-report.md` before it is written. This is a
// deterministic, dependency-free safety net that catches contract regressions
// rather than relying on consumers to reject malformed output.
import type { StructuredError } from '../../shared/errors/error-normalizer.js'

export type SarifTarget = 'generic' | 'github'

type SarifResultLike = {
  readonly ruleId?: unknown
  readonly message?: { readonly text?: unknown }
  readonly locations?: ReadonlyArray<{
    readonly physicalLocation?: {
      readonly artifactLocation?: { readonly uri?: unknown }
      readonly region?: { readonly startLine?: unknown }
    }
  }>
  readonly partialFingerprints?: Readonly<Record<string, unknown>>
}

type SarifDocumentLike = {
  readonly version?: unknown
  readonly runs?: ReadonlyArray<{
    readonly tool?: {
      readonly driver?: {
        readonly name?: unknown
        readonly rules?: ReadonlyArray<{ readonly id?: unknown }>
      }
    }
    readonly results?: readonly SarifResultLike[]
  }>
}

const sarifError = (message: string): StructuredError => ({
  code: 'sarif_invalid',
  message,
  category: 'report',
  recoverable: false,
  exitCode: 5,
  details: {}
})

const isValidArtifactUri = (uri: unknown): uri is string =>
  typeof uri === 'string' &&
  uri.length > 0 &&
  !uri.startsWith('/') &&
  !/^[A-Za-z]:/u.test(uri) &&
  !uri.includes('\\') &&
  !/(^|\/)\.\.(\/|$)/u.test(uri)

const maxGithubRules = 1000

const assertResult = (
  result: SarifResultLike,
  target: SarifTarget,
  definedRuleIds: ReadonlySet<unknown>
): void => {
  if (typeof result.ruleId !== 'string' || result.ruleId.length === 0) {
    throw sarifError('Every SARIF result must have a non-empty ruleId.')
  }

  if (typeof result.message?.text !== 'string') {
    throw sarifError('Every SARIF result must have message text.')
  }

  const location = result.locations?.[0]?.physicalLocation

  if (!isValidArtifactUri(location?.artifactLocation?.uri)) {
    throw sarifError('SARIF result location URI must be repository-relative.')
  }

  const startLine = location?.region?.startLine

  if (
    typeof startLine !== 'number' ||
    !Number.isInteger(startLine) ||
    startLine < 1
  ) {
    throw sarifError('SARIF result region startLine must be an integer >= 1.')
  }

  if (target !== 'github') {
    return
  }

  if (Object.keys(result.partialFingerprints ?? {}).length === 0) {
    throw sarifError('GitHub SARIF results must have partial fingerprints.')
  }

  if (!definedRuleIds.has(result.ruleId)) {
    throw sarifError(
      `GitHub SARIF result references undefined rule "${result.ruleId}".`
    )
  }
}

export const validateSarifDocument = (
  sarif: SarifDocumentLike,
  target: SarifTarget
): void => {
  if (sarif.version !== '2.1.0') {
    throw sarifError('SARIF version must be 2.1.0.')
  }

  const run = sarif.runs?.[0]

  if (run === undefined) {
    throw sarifError('SARIF document must contain at least one run.')
  }

  const driverName = run.tool?.driver?.name

  if (typeof driverName !== 'string' || driverName.length === 0) {
    throw sarifError('SARIF driver name must be a non-empty string.')
  }

  const definedRuleIds = new Set(
    (run.tool?.driver?.rules ?? []).map((rule) => rule.id)
  )

  for (const result of run.results ?? []) {
    assertResult(result, target, definedRuleIds)
  }

  if (target === 'github' && definedRuleIds.size > maxGithubRules) {
    throw sarifError('GitHub SARIF runs must not define more than 1000 rules.')
  }
}
