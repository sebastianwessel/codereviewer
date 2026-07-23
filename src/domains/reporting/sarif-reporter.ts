import type {
  AdmittedFinding,
  FindingFingerprint,
  ReviewReport
} from '../../shared/contracts/index.js'
import type { StructuredError } from '../../shared/errors/error-normalizer.js'
import {
  safeRedactedText,
  sortAdmittedFindings,
  validateReviewReport
} from './reporting-utils.js'

export type SarifRenderOptions = {
  readonly category: string
  readonly maxResults: number
  readonly target: 'generic' | 'github'
}

type SarifResult = {
  readonly ruleId: string
  readonly level: 'error' | 'warning' | 'note'
  readonly message: {
    readonly text: string
  }
  readonly locations: readonly [
    {
      readonly physicalLocation: {
        readonly artifactLocation: {
          readonly uri: string
        }
        readonly region: {
          readonly startLine: number
        }
      }
    }
  ]
  readonly partialFingerprints: Readonly<Record<string, string>>
  readonly properties: {
    readonly category: string
    readonly baselineStatus: string
    readonly fixProposal?: {
      readonly summary: string
      readonly evidenceIds: readonly string[]
      readonly safety: 'manual-review'
    }
  }
}

const sarifLevelFor = (finding: AdmittedFinding): SarifResult['level'] => {
  if (finding.severity === 'critical' || finding.severity === 'high') {
    return 'error'
  }

  if (finding.severity === 'medium' || finding.severity === 'low') {
    return 'warning'
  }

  return 'note'
}

// Build partial fingerprints without losing entries that share an algorithm.
// `Object.fromEntries` would collapse duplicates to the last value, silently
// weakening GitHub de-duplication keys; instead, disambiguate repeated
// algorithms with a deterministic suffix.
const fingerprintsFor = (
  fingerprints: readonly FindingFingerprint[]
): Readonly<Record<string, string>> => {
  const result: Record<string, string> = {}

  for (const fingerprint of fingerprints) {
    let key = fingerprint.algorithm
    let collision = 1

    while (key in result) {
      key = `${fingerprint.algorithm}/${collision}`
      collision += 1
    }

    result[key] = fingerprint.value
  }

  return result
}

const ruleIdFor = (finding: AdmittedFinding): string =>
  finding.ruleId ?? finding.category

// SARIF artifact URIs must be repository-relative with `/` separators and a
// valid URI reference. Encode each path segment so spaces and reserved
// characters cannot break the URI, and normalize any backslash separators.
const toArtifactUri = (repositoryRelativePath: string): string =>
  repositoryRelativePath
    .replaceAll('\\', '/')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')

const renderResult = (finding: AdmittedFinding): SarifResult => {
  const fixProposal =
    finding.fixProposal === undefined
      ? {}
      : {
          fixProposal: {
            summary: safeRedactedText(finding.fixProposal.summary),
            evidenceIds: [...finding.fixProposal.evidenceIds],
            safety: finding.fixProposal.safety,
            ...(finding.fixProposal.edits === undefined
              ? {}
              : {
                  edits: finding.fixProposal.edits.map((edit) => ({
                    path: toArtifactUri(edit.path),
                    startLine: edit.startLine,
                    endLine: edit.endLine,
                    replacement: safeRedactedText(edit.replacement),
                    ...(edit.description === undefined
                      ? {}
                      : { description: safeRedactedText(edit.description) })
                  }))
                })
          }
        }

  return {
    ruleId: ruleIdFor(finding),
    level: sarifLevelFor(finding),
    message: {
      text: safeRedactedText(`${finding.title}. ${finding.description}`)
    },
    locations: [
      {
        physicalLocation: {
          artifactLocation: {
            uri: toArtifactUri(finding.location.path)
          },
          region: {
            startLine: finding.location.startLine
          }
        }
      }
    ],
    partialFingerprints: fingerprintsFor(finding.fingerprints),
    properties: {
      category: finding.category,
      baselineStatus: finding.baselineStatus,
      ...fixProposal
    }
  }
}

type SarifRule = {
  readonly id: string
  readonly name: string
  readonly shortDescription: {
    readonly text: string
  }
}

const renderProviderIssue = (
  issue: ReviewReport['providerIssues'][number]
): ReviewReport['providerIssues'][number] => ({
  code: safeRedactedText(issue.code),
  ...(issue.stage === undefined
    ? {}
    : { stage: safeRedactedText(issue.stage) }),
  ...(issue.recovered === undefined ? {} : { recovered: issue.recovered }),
  ...(issue.message === undefined
    ? {}
    : { message: safeRedactedText(issue.message) })
})

// Every result references a rule by `ruleId`; SARIF consumers expect those rules
// to be defined in the driver. Build a stable, de-duplicated rule catalog from
// the admitted findings.
const buildRules = (
  findings: readonly AdmittedFinding[]
): readonly SarifRule[] => {
  const rulesById = new Map<string, SarifRule>()

  for (const finding of findings) {
    const id = ruleIdFor(finding)

    if (!rulesById.has(id)) {
      rulesById.set(id, {
        id,
        name: id,
        shortDescription: {
          text: safeRedactedText(`${finding.category} finding`)
        }
      })
    }
  }

  return [...rulesById.values()].sort((left, right) =>
    left.id.localeCompare(right.id)
  )
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

// Validate the rendered SARIF document against the structural invariants in
// `specs/03-contracts/finding-evidence-report.md` before it is written. This is
// a deterministic, dependency-free safety net that catches contract regressions
// rather than relying on consumers to reject malformed output.
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

export const validateSarifDocument = (
  sarif: SarifDocumentLike,
  target: SarifRenderOptions['target']
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

    if (typeof startLine !== 'number' || !Number.isInteger(startLine) || startLine < 1) {
      throw sarifError('SARIF result region startLine must be an integer >= 1.')
    }

    if (target === 'github') {
      if (Object.keys(result.partialFingerprints ?? {}).length === 0) {
        throw sarifError('GitHub SARIF results must have partial fingerprints.')
      }

      if (!definedRuleIds.has(result.ruleId)) {
        throw sarifError(
          `GitHub SARIF result references undefined rule "${result.ruleId}".`
        )
      }
    }
  }

  if (target === 'github' && definedRuleIds.size > maxGithubRules) {
    throw sarifError('GitHub SARIF runs must not define more than 1000 rules.')
  }
}

export const renderSarifReport = (
  input: unknown,
  options: SarifRenderOptions
): string => {
  const report: ReviewReport = validateReviewReport(input)
  const includedFindings = sortAdmittedFindings(
    report.admittedFindings.filter(
      (finding) => finding.reporterEligibility !== 'artifact-only'
    )
  ).slice(0, options.maxResults)
  const results = includedFindings.map(renderResult)
  const rules = buildRules(includedFindings)
  const properties =
    report.providerIssues.length === 0
      ? {}
      : {
          properties: {
            providerIssues: report.providerIssues.map(renderProviderIssue)
          }
        }
  const sarif = {
    version: '2.1.0',
    $schema:
      'https://json.schemastore.org/sarif-2.1.0.json',
    runs: [
      {
        tool: {
          driver: {
            name: 'codereviewer',
            informationUri: 'https://example.invalid/codereviewer',
            rules
          }
        },
        automationDetails: {
          id: options.category
        },
        ...properties,
        results
      }
    ]
  }

  validateSarifDocument(sarif, options.target)

  return `${JSON.stringify(sarif, null, 2)}\n`
}
