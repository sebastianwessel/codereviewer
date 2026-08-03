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

// The tool's own home page, used as `tool.driver.informationUri`. Kept as a
// constant rather than read from `package.json` at runtime (the published
// package ships `dist/` without a resolvable path back to the manifest); a unit
// test asserts it still equals the manifest's `homepage` so the two cannot
// drift.
export const SARIF_INFORMATION_URI =
  'https://github.com/sebastianwessel/codereviewer#readme'

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
        // `endLine` is present whenever the finding carries one, so a
        // multi-line defect highlights its whole span instead of collapsing to
        // its first line (SARIF defaults `endLine` to `startLine`).
        readonly region: {
          readonly startLine: number
          readonly endLine?: number
        }
      }
    }
  ]
  readonly partialFingerprints: Readonly<Record<string, string>>
  readonly properties: {
    readonly category: string
    readonly baselineStatus: string
    // The finding's own security classification, exactly as the contract
    // carries it. The rule-level projection below is lossy when several
    // findings share a rule id; this is not.
    readonly cwe?: readonly string[]
    readonly securitySeverity?: number
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
            startLine: finding.location.startLine,
            ...(finding.location.endLine === undefined
              ? {}
              : { endLine: finding.location.endLine })
          }
        }
      }
    ],
    partialFingerprints: fingerprintsFor(finding.fingerprints),
    properties: {
      category: finding.category,
      baselineStatus: finding.baselineStatus,
      ...(finding.cwe === undefined ? {} : { cwe: [...finding.cwe] }),
      ...(finding.securitySeverity === undefined
        ? {}
        : { securitySeverity: finding.securitySeverity }),
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
  readonly helpUri?: string
  readonly properties?: {
    readonly tags: readonly string[]
    readonly 'security-severity'?: string
  }
}

// CWE ids travel in `tags` as `external/cwe/cwe-<id>`, the convention CodeQL and
// GitHub's own SARIF annotators use. The id is lower-cased and otherwise passed
// through: the contract already constrains it to `CWE-<digits>`, and zero-padding
// it (a CodeQL habit, not a documented requirement) would invent a spelling the
// finding never claimed.
const cweTagFor = (cwe: string): string => `external/cwe/${cwe.toLowerCase()}`

// Per-rule security metadata, accumulated across the findings that reference the
// rule. `helpUri` is a property of the rule, so the first one wins; CWEs are
// unioned; `security-severity` takes the maximum, because GitHub shows ONE
// severity per rule and understating a security score is the direction that
// costs. Exact per-finding values remain on each result's own properties.
type SarifRuleAccumulator = {
  readonly id: string
  readonly shortDescriptionText: string
  helpUri: string | undefined
  readonly cweTags: Set<string>
  securitySeverity: number | undefined
}

// GitHub code scanning reads `properties['security-severity']` as a STRING
// holding a 0.0-10.0 score and bands it: above 9.0 is critical, 7.0 to 8.9 is
// high, 4.0 to 6.9 is medium, and 0.1 to 3.9 is low. It is honoured only for
// rules whose `tags` include `security`, so the tag is emitted alongside it. No
// score is synthesised from `finding.severity`: a CVSS-like number nobody
// measured would be a fabrication, and a rule with no score simply falls back to
// the result `level` GitHub already receives.
const rulePropertiesFor = (
  accumulator: SarifRuleAccumulator
): SarifRule['properties'] => {
  if (accumulator.cweTags.size === 0 && accumulator.securitySeverity === undefined) {
    return undefined
  }

  return {
    tags: ['security', ...[...accumulator.cweTags].sort()],
    ...(accumulator.securitySeverity === undefined
      ? {}
      : { 'security-severity': `${accumulator.securitySeverity}` })
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
  const rulesById = new Map<string, SarifRuleAccumulator>()

  for (const finding of findings) {
    const id = ruleIdFor(finding)
    const existing = rulesById.get(id)
    const accumulator = existing ?? {
      id,
      shortDescriptionText: safeRedactedText(`${finding.category} finding`),
      helpUri: undefined,
      cweTags: new Set<string>(),
      securitySeverity: undefined
    }

    if (accumulator.helpUri === undefined && finding.helpUri !== undefined) {
      accumulator.helpUri = safeRedactedText(finding.helpUri)
    }

    for (const cwe of finding.cwe ?? []) {
      accumulator.cweTags.add(cweTagFor(cwe))
    }

    if (
      finding.securitySeverity !== undefined &&
      (accumulator.securitySeverity === undefined ||
        finding.securitySeverity > accumulator.securitySeverity)
    ) {
      accumulator.securitySeverity = finding.securitySeverity
    }

    if (existing === undefined) {
      rulesById.set(id, accumulator)
    }
  }

  return [...rulesById.values()]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((accumulator) => {
      const properties = rulePropertiesFor(accumulator)

      return {
        id: accumulator.id,
        name: accumulator.id,
        shortDescription: { text: accumulator.shortDescriptionText },
        ...(accumulator.helpUri === undefined
          ? {}
          : { helpUri: accumulator.helpUri }),
        ...(properties === undefined ? {} : { properties })
      }
    })
}

// The notification id the withheld-results disclosure reports under. Defined in
// `tool.driver.notifications` as well as referenced from the notification, so the
// reference resolves instead of dangling.
const RESULTS_WITHHELD_NOTIFICATION_ID = 'codereviewer/sarif-results-withheld'

type SarifNotificationDescriptor = {
  readonly id: string
  readonly shortDescription: {
    readonly text: string
  }
}

type SarifInvocation = {
  readonly executionSuccessful: boolean
  readonly toolExecutionNotifications: readonly [
    {
      readonly descriptor: { readonly id: string }
      readonly level: 'warning'
      readonly message: { readonly text: string }
    }
  ]
}

// A capped result list is not read as "there is more". Code scanning resolves any
// alert whose result is ABSENT from a later run under the same
// `automationDetails.id`, so a silent `maxResults` cut does not read as "not
// shown" — it reads as "fixed", and the withheld findings disappear off the
// security dashboard with no trace anywhere in this file. SARIF's own channel for
// a tool reporting something about its own run is
// `runs[].invocations[].toolExecutionNotifications`, so the cut announces itself
// there, naming what it dropped, the key that dropped it, and where the whole set
// still lives. Emitted only when the cap actually binds: a notification on every
// run would train consumers to ignore it.
const resultsWithheldDisclosure = (input: {
  readonly withheld: number
  readonly eligible: number
  readonly maxResults: number
}): {
  readonly notifications: readonly [SarifNotificationDescriptor]
  readonly invocations: readonly [SarifInvocation]
} => ({
  notifications: [
    {
      id: RESULTS_WITHHELD_NOTIFICATION_ID,
      shortDescription: {
        text: 'Some findings were withheld from this SARIF run by the configured result cap.'
      }
    }
  ],
  invocations: [
    {
      // The run itself succeeded; what failed to arrive is results, and that is
      // what the notification says. Reporting `false` here would make a code
      // scanning upload read as a failed analysis, which is a different claim.
      executionSuccessful: true,
      toolExecutionNotifications: [
        {
          descriptor: { id: RESULTS_WITHHELD_NOTIFICATION_ID },
          level: 'warning',
          message: {
            text: `${input.withheld} of ${input.eligible} findings are withheld from this SARIF run because reporting.sarif.maxResults is ${input.maxResults}. A consumer that treats a result missing from a run as resolved will report those findings as fixed; they are not. Raise reporting.sarif.maxResults to emit them, and read report.json or report.md for the complete set.`
          }
        }
      ]
    }
  ]
})

export const renderSarifReport = (
  input: unknown,
  options: SarifRenderOptions
): string => {
  const report: ReviewReport = validateReviewReport(input)
  const eligibleFindings = sortAdmittedFindings(
    report.admittedFindings.filter(
      (finding) => finding.reporterEligibility !== 'artifact-only'
    )
  )
  const includedFindings = eligibleFindings.slice(0, options.maxResults)
  const withheld = eligibleFindings.length - includedFindings.length
  const disclosure =
    withheld === 0
      ? undefined
      : resultsWithheldDisclosure({
          withheld,
          eligible: eligibleFindings.length,
          maxResults: options.maxResults
        })
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
            informationUri: SARIF_INFORMATION_URI,
            rules,
            ...(disclosure === undefined
              ? {}
              : { notifications: disclosure.notifications })
          }
        },
        automationDetails: {
          id: options.category
        },
        ...(disclosure === undefined
          ? {}
          : { invocations: disclosure.invocations }),
        ...properties,
        results
      }
    ]
  }

  validateSarifDocument(sarif, options.target)

  return `${JSON.stringify(sarif, null, 2)}\n`
}
