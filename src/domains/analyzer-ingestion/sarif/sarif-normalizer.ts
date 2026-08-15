// SARIF 2.1.0 -> the canonical `AnalyzerAlert` model.
//
// This is the ONLY module that knows what a SARIF document looks like. Everything
// downstream — attribution, evidence, the packet section — reads `AnalyzerAlert`
// and would be unchanged by a second artifact format.
//
// Two rules govern every conversion below.
//
// NOTHING IS INVENTED. A field the producer did not supply yields an absent field,
// never a default that reads like a measurement: no fabricated severity, no guessed
// CWE, no synthesized data flow. The one place a value is constructed is the alert
// message when the artifact carries none, and the constructed text says exactly
// that rather than describing a defect.
//
// NOTHING IS DROPPED SILENTLY. A result that cannot be normalized — no rule id, no
// usable location, a location outside the repository — is counted as unusable and
// the count is reported, because a smaller alert list is otherwise indistinguishable
// from a cleaner repository.

import { z } from 'zod'
import { sha256 } from '../../../shared/hash/hash.js'
import {
  ANALYZER_MESSAGE_MAX,
  AnalyzerAlertSchema,
  type AnalyzerAlert,
  type AnalyzerIdentity
} from '../contracts.js'
import type {
  SarifLogSchema,
  SarifLocation,
  SarifReportingDescriptor,
  SarifResult,
  SarifRun
} from './sarif.schema.js'

// Bounds on what one alert may contribute to a model packet. An artifact can
// legitimately carry a hundred-step interprocedural flow; a review packet cannot,
// and the value of a flow is its shape (source, barrier, sink), not its length.
// Both cuts are disclosed in the flow label rather than applied invisibly.
const MAX_FLOWS_PER_ALERT = 2
const MAX_STEPS_PER_FLOW = 12
const MAX_RELATED_LOCATIONS_PER_ALERT = 6

// Resolves an artifact-supplied URI to a repository-relative path this run may
// reference, or `undefined` when it does not resolve to one. Injected because path
// resolution needs the repository root and the run's eligible path universe, and
// this module must stay free of both.
export type AnalyzerPathResolver = (uri: string) => string | undefined

export type SarifNormalizationResult = {
  readonly analyzer: AnalyzerIdentity
  readonly alerts: readonly AnalyzerAlert[]
  readonly resultCount: number
  readonly unusableCount: number
}

const firstText = (
  ...candidates: readonly (string | undefined)[]
): string | undefined =>
  candidates.find((candidate) => candidate !== undefined && candidate.trim().length > 0)

// Collapse whitespace and cut at the contract cap. Analyzer messages are untrusted
// third-party text: they arrive with embedded newlines, and a multi-line block
// pasted into a packet section would let one entry impersonate the section's own
// structure.
const normalizeMessageText = (value: string): string => {
  const collapsed = value.replaceAll(/\s+/gu, ' ').trim()

  return collapsed.length > ANALYZER_MESSAGE_MAX
    ? `${collapsed.slice(0, ANALYZER_MESSAGE_MAX - 1)}…`
    : collapsed
}

// A URL only where the producer supplied a real absolute one. `helpUri` and
// `informationUri` reach `z.url()` fields on the contract, and a relative or
// malformed value must be dropped rather than fail the whole ingestion: a broken
// help link is not a reason to discard a security observation.
const absoluteUrlOrUndefined = (value: string | undefined): string | undefined => {
  if (value === undefined) {
    return undefined
  }

  return z.url().safeParse(value).success ? value : undefined
}

// CWE identifiers as the shapes producers actually emit: a tag namespaced under a
// taxonomy path (`external/cwe/cwe-89`, CodeQL's convention), a plain property,
// and an id-first tag whose remainder is the weakness NAME
// (`CWE-1004: Sensitive Cookie Without 'HttpOnly' Flag`, Semgrep's convention).
//
// The third shape is why this pattern is bounded on BOTH sides rather than
// anchored at the end. Requiring end-of-string dropped every CWE from real
// Semgrep output — an artifact whose rules are meticulously CWE-tagged normalized
// to an empty `cwe` list, silently, which reads exactly like an analyzer that
// tags nothing. The leading and trailing boundaries keep the match anchored to a
// whole token, so an unrelated tag containing the letters "cwe" still contributes
// nothing.
const cwePattern = /(?:^|[/:\s])cwe[-_]?(\d{1,6})(?=$|[:,;\s/])/iu

const cweFromToken = (token: string): string | undefined => {
  const trimmed = token.trim()
  const match = cwePattern.exec(trimmed)

  return match?.[1] === undefined ? undefined : `CWE-${Number(match[1])}`
}

type CwePropertyBag = {
  readonly tags?: readonly string[] | undefined
  readonly cwe?: string | readonly string[] | undefined
}

const collectCwe = (
  ...bags: readonly (CwePropertyBag | undefined)[]
): readonly string[] => {
  const found = new Set<string>()

  for (const bag of bags) {
    if (bag === undefined) {
      continue
    }

    const tokens = [
      ...(bag.tags ?? []),
      ...(bag.cwe === undefined
        ? []
        : typeof bag.cwe === 'string'
          ? [bag.cwe]
          : [...bag.cwe])
    ]

    for (const token of tokens) {
      const cwe = cweFromToken(token)

      if (cwe !== undefined) {
        found.add(cwe)
      }
    }
  }

  // Sorted numerically so the same artifact always produces the same alert id.
  return [...found].sort(
    (left, right) => Number(left.slice(4)) - Number(right.slice(4))
  )
}

const securitySeverityFrom = (
  value: string | number | undefined
): number | undefined => {
  if (value === undefined) {
    return undefined
  }

  const parsed = typeof value === 'number' ? value : Number(value.trim())

  // Out of range is DROPPED, not clamped. Clamping a producer's 42 to 10 would
  // publish a maximal severity this engine invented.
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 10
    ? parsed
    : undefined
}

type ResolvedLocation = {
  readonly path: string
  readonly startLine: number
  readonly startColumn?: number
  readonly endLine?: number
  readonly message?: string
}

const resolveLocation = (
  location: SarifLocation | undefined,
  resolvePath: AnalyzerPathResolver
): ResolvedLocation | undefined => {
  const uri = location?.physicalLocation?.artifactLocation?.uri

  if (uri === undefined) {
    return undefined
  }

  const path = resolvePath(uri)

  if (path === undefined) {
    return undefined
  }

  const region = location?.physicalLocation?.region
  const startLine = region?.startLine

  // A location with no line is not usable as evidence: it names a file, and this
  // engine attributes by line. Treated as unusable rather than pinned to line 1,
  // which would put the alert on whatever happens to be at the top of the file.
  if (
    startLine === undefined ||
    !Number.isInteger(startLine) ||
    startLine < 1
  ) {
    return undefined
  }

  const endLine =
    region?.endLine !== undefined &&
    Number.isInteger(region.endLine) &&
    region.endLine >= startLine
      ? region.endLine
      : undefined
  const startColumn =
    region?.startColumn !== undefined &&
    Number.isInteger(region.startColumn) &&
    region.startColumn >= 1
      ? region.startColumn
      : undefined
  const message = location?.message?.text

  return {
    path,
    startLine,
    ...(startColumn === undefined ? {} : { startColumn }),
    ...(endLine === undefined ? {} : { endLine }),
    ...(message === undefined ? {} : { message: normalizeMessageText(message) })
  }
}

const codeLocationFrom = (resolved: ResolvedLocation) => ({
  path: resolved.path,
  startLine: resolved.startLine,
  ...(resolved.startColumn === undefined
    ? {}
    : { startColumn: resolved.startColumn }),
  ...(resolved.endLine === undefined ? {} : { endLine: resolved.endLine }),
  // The artifact describes the post-change working tree the analyzer scanned, so
  // its lines are new-side lines.
  side: 'new' as const
})

const ruleForResult = (
  result: SarifResult,
  rules: readonly SarifReportingDescriptor[]
): SarifReportingDescriptor | undefined => {
  if (
    result.ruleIndex !== undefined &&
    Number.isInteger(result.ruleIndex) &&
    result.ruleIndex >= 0 &&
    result.ruleIndex < rules.length
  ) {
    return rules[result.ruleIndex]
  }

  return result.ruleId === undefined
    ? undefined
    : rules.find((rule) => rule.id === result.ruleId)
}

const analyzerIdentityFor = (run: SarifRun): AnalyzerIdentity => {
  const driver = run.tool.driver
  const version = firstText(driver.semanticVersion, driver.version)
  const informationUri = absoluteUrlOrUndefined(driver.informationUri)

  return {
    // A run whose driver does not name itself still produced observations. The
    // placeholder states that fact instead of dropping the whole run.
    name: (firstText(driver.name) ?? 'unnamed analyzer').slice(0, 120),
    ...(version === undefined ? {} : { version: version.slice(0, 80) }),
    ...(informationUri === undefined ? {} : { informationUri })
  }
}

const dataFlowsFor = (
  result: SarifResult,
  alertId: string,
  resolvePath: AnalyzerPathResolver
): AnalyzerAlert['dataFlow'] => {
  const flows: AnalyzerAlert['dataFlow'] = []

  for (const [flowIndex, codeFlow] of (result.codeFlows ?? []).entries()) {
    if (flows.length >= MAX_FLOWS_PER_ALERT) {
      break
    }

    const threadFlowLocations = (codeFlow.threadFlows ?? []).flatMap(
      (threadFlow) => threadFlow.locations ?? []
    )
    const resolvedSteps = threadFlowLocations
      .map((entry) => resolveLocation(entry.location, resolvePath))
      .filter((entry): entry is ResolvedLocation => entry !== undefined)

    if (resolvedSteps.length === 0) {
      continue
    }

    // Keep the ENDS of a long flow, not its prefix. A taint path's meaning lives in
    // its first step (the source) and its last (the sink); cutting the tail would
    // hand the reviewer a path with no sink in it.
    const cut = resolvedSteps.length > MAX_STEPS_PER_FLOW
    const head = Math.ceil(MAX_STEPS_PER_FLOW / 2)
    const steps = cut
      ? [
          ...resolvedSteps.slice(0, head),
          ...resolvedSteps.slice(resolvedSteps.length - (MAX_STEPS_PER_FLOW - head))
        ]
      : resolvedSteps
    const label = normalizeMessageText(
      firstText(codeFlow.message?.text) ?? 'Reported data flow'
    ).slice(0, cut ? 80 : 120)

    flows.push({
      id: `${alertId}_flow${flowIndex}`,
      label: cut
        ? `${label} (${steps.length} of ${resolvedSteps.length} steps shown)`
        : label,
      steps: steps.map((step, stepIndex) => ({
        id: `${alertId}_flow${flowIndex}_step${stepIndex}`,
        location: codeLocationFrom(step),
        message: step.message ?? `Flow step ${stepIndex + 1}.`
      }))
    })
  }

  return flows
}

const relatedLocationsFor = (
  result: SarifResult,
  alertId: string,
  resolvePath: AnalyzerPathResolver
): AnalyzerAlert['relatedLocations'] =>
  (result.relatedLocations ?? [])
    .map((location) => resolveLocation(location, resolvePath))
    .filter((entry): entry is ResolvedLocation => entry !== undefined)
    .slice(0, MAX_RELATED_LOCATIONS_PER_ALERT)
    .map((entry, index) => ({
      id: `${alertId}_related${index}`,
      location: codeLocationFrom(entry),
      message: entry.message ?? 'Related location.'
    }))

const normalizeResult = (input: {
  readonly result: SarifResult
  readonly rules: readonly SarifReportingDescriptor[]
  readonly analyzer: AnalyzerIdentity
  readonly artifactPath: string
  readonly artifactContentHash: string
  readonly runIndex: number
  readonly resultIndex: number
  readonly resolvePath: AnalyzerPathResolver
  readonly redact: (value: string) => string
}): AnalyzerAlert | undefined => {
  const rule = ruleForResult(input.result, input.rules)
  const ruleId = firstText(input.result.ruleId, rule?.id)

  if (ruleId === undefined) {
    return undefined
  }

  const primary = resolveLocation(input.result.locations?.[0], input.resolvePath)

  if (primary === undefined) {
    return undefined
  }

  // Content-derived, so re-ingesting the same artifact yields the same ids and the
  // evidence set does not churn between runs. The artifact path is included so two
  // analyzers reporting the identical rule at the identical line stay distinct.
  const alertId = `alert_${sha256(
    `${input.artifactPath}|${input.runIndex}|${input.resultIndex}|${ruleId}|${primary.path}:${primary.startLine}`
  ).slice(0, 24)}`
  const messageText =
    firstText(
      input.result.message?.text,
      rule?.shortDescription?.text,
      rule?.fullDescription?.text
    ) ?? `Analyzer rule ${ruleId} reported a result with no message text.`
  const securitySeverity = securitySeverityFrom(
    input.result.properties?.['security-severity'] ??
      rule?.properties?.['security-severity']
  )
  const helpUri = absoluteUrlOrUndefined(rule?.helpUri)
  const ruleName = firstText(rule?.name)

  return AnalyzerAlertSchema.parse({
    id: alertId,
    artifact: {
      path: input.artifactPath,
      contentHash: input.artifactContentHash
    },
    analyzer: input.analyzer,
    ruleId: ruleId.slice(0, 200),
    ...(ruleName === undefined ? {} : { ruleName: ruleName.slice(0, 200) }),
    ...(helpUri === undefined ? {} : { helpUri }),
    cwe: collectCwe(rule?.properties, input.result.properties),
    // SARIF's own precedence: the result's level, else the rule's configured
    // default, else `warning`.
    level:
      input.result.level ?? rule?.defaultConfiguration?.level ?? 'warning',
    ...(securitySeverity === undefined ? {} : { securitySeverity }),
    // Redacted before it can reach a model or an artifact: analyzer messages quote
    // the code they matched, and a secrets rule quotes the secret.
    message: normalizeMessageText(input.redact(messageText)),
    location: codeLocationFrom(primary),
    relatedLocations: relatedLocationsFor(
      input.result,
      alertId,
      input.resolvePath
    ).map((related) => ({
      ...related,
      message: input.redact(related.message).slice(0, 300)
    })),
    dataFlow: dataFlowsFor(input.result, alertId, input.resolvePath).map(
      (flow) => ({
        ...flow,
        steps: flow.steps.map((step) => ({
          ...step,
          message: input.redact(step.message).slice(0, 300)
        }))
      })
    )
  })
}

/**
 * Normalize an already-parsed, schema-valid SARIF log into canonical alerts.
 *
 * One result per SARIF run is normalized in document order, so the alert list is
 * deterministic for a given artifact. Runs are flattened: which run inside an
 * artifact produced an alert is not a distinction a reviewer can act on, while the
 * producing tool — recorded per alert — is.
 */
export const normalizeSarifLog = (input: {
  readonly log: z.infer<typeof SarifLogSchema>
  readonly artifactPath: string
  readonly artifactContentHash: string
  readonly resolvePath: AnalyzerPathResolver
  readonly redact: (value: string) => string
}): SarifNormalizationResult => {
  const alerts: AnalyzerAlert[] = []
  let resultCount = 0
  let unusableCount = 0
  let analyzer: AnalyzerIdentity | undefined

  for (const [runIndex, run] of input.log.runs.entries()) {
    const runAnalyzer = analyzerIdentityFor(run)
    analyzer ??= runAnalyzer
    const rules = run.tool.driver.rules ?? []

    for (const [resultIndex, result] of (run.results ?? []).entries()) {
      resultCount += 1
      const alert = normalizeResult({
        result,
        rules,
        analyzer: runAnalyzer,
        artifactPath: input.artifactPath,
        artifactContentHash: input.artifactContentHash,
        runIndex,
        resultIndex,
        resolvePath: input.resolvePath,
        redact: input.redact
      })

      if (alert === undefined) {
        unusableCount += 1
        continue
      }

      alerts.push(alert)
    }
  }

  return {
    // An artifact with no run at all names no tool; the placeholder says so rather
    // than leaving provenance blank.
    analyzer: analyzer ?? { name: 'unnamed analyzer' },
    alerts,
    resultCount,
    unusableCount
  }
}
