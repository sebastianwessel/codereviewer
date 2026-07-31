import type {
  AdmittedFinding,
  FindingFingerprint,
  ReviewReport
} from '../../shared/contracts/index.js'
import {
  validateSarifDocument,
  type SarifTarget
} from './sarif-validation.js'
import {
  safeRedactedText,
  sortAdmittedFindings,
  validateReviewReport
} from './reporting-utils.js'

export type SarifRenderOptions = {
  readonly category: string
  readonly maxResults: number
  readonly target: SarifTarget
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
      // Apply-ready edits, redacted and with artifact-URI paths. Present when the
      // finding's fix proposal carries edits (including a fix-lane enrichment,
      // spec 12).
      readonly edits?: readonly {
        readonly path: string
        readonly startLine: number
        readonly endLine: number
        readonly replacement: string
        readonly description?: string
      }[]
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
