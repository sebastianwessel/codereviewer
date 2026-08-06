// Orchestration for analyzer-artifact ingestion (spec 15, Mechanism 2).
//
// The stages, in order: read and validate the artifact, normalize it into canonical
// alerts, attribute those alerts to the change, bound what survives, and turn the
// survivors into evidence. Every stage that loses something reports the count.
//
// THIS ENGINE NEVER RUNS AN ANALYZER. It reads artifacts a pipeline already
// produced, and adds no analyzer package to the dependency set (INV-PROV-001).

import type {
  EvidenceRecord,
  SecuritySignalsConfig
} from '../../shared/contracts/index.js'
import { RepositoryRelativePathSchema } from '../../shared/contracts/index.js'
import { normalizeRepositoryRelativePath } from '../../platform/repository-path.js'
// Deep import, deliberately: `evaluatePathEligibility` is this repository's single
// definition of the eligible path universe, INCLUDING the hard floor that no
// configuration can widen (dotfiles, dependency and build directories). A second,
// weaker copy of a security floor is a worse outcome than reaching for the real one.
import {
  compileEligibilityConfig,
  evaluatePathEligibility
} from '../context-retrieval/index.js'
import { readSarifArtifact } from './artifact-reader.js'
import { analyzerEvidenceForAlerts } from './analyzer-evidence.js'
import {
  attributeAlertsToChange,
  rankAttributedAlerts,
  type ChangedLineRange
} from './changed-side-attribution.js'
import {
  AnalyzerArtifactMetricSchema,
  type AnalyzerArtifactMetric,
  type AttributedAnalyzerAlert
} from './contracts.js'
import { normalizeSarifLog } from './sarif/sarif-normalizer.js'

export type AnalyzerIngestionResult = {
  readonly alerts: readonly AttributedAnalyzerAlert[]
  readonly evidence: readonly EvidenceRecord[]
  readonly metrics: readonly AnalyzerArtifactMetric[]
  // Non-fatal disclosures surfaced in the run report. Every one of them names
  // something that is NOT in the review, because a shorter list of alerts is
  // otherwise indistinguishable from a cleaner repository.
  readonly warnings: readonly string[]
}

/**
 * Build the resolver that maps an artifact-supplied URI to a repository-relative
 * path this run may reference.
 *
 * Returns `undefined` — which the normalizer counts as unusable — for a URI that
 * escapes the repository, is absolute, points outside the eligible path universe,
 * or cannot be decoded. A location this engine cannot vouch for is never shown to a
 * model and never written into evidence.
 */
export const createAnalyzerPathResolver = (input: {
  readonly paths: {
    readonly include?: readonly string[]
    readonly exclude?: readonly string[]
  }
}): ((uri: string) => string | undefined) => {
  const eligibility = compileEligibilityConfig(input.paths)

  return (uri: string): string | undefined => {
    let candidate = uri

    try {
      candidate = decodeURIComponent(uri)
    } catch {
      // A malformed percent-escape is a malformed path. Fall through with the raw
      // value: it either validates as written or is rejected below.
      candidate = uri
    }

    // A URI with a scheme (`file:`, `http:`, ...) names something this engine cannot
    // place inside the repository. Rejected rather than guessed at.
    if (/^[a-z][a-z0-9+.-]*:/iu.test(candidate)) {
      return undefined
    }

    let portablePath: string

    try {
      portablePath = RepositoryRelativePathSchema.parse(
        normalizeRepositoryRelativePath(candidate)
      )
    } catch {
      return undefined
    }

    return evaluatePathEligibility(portablePath, eligibility).eligible
      ? portablePath
      : undefined
  }
}

/**
 * Ingest every configured analyzer artifact.
 *
 * Throws (exit 2) when an artifact is missing, oversized, or malformed: with
 * `security.signals` enabled, an artifact that cannot be read must never be
 * reported as a repository with no security signals.
 */
export const ingestAnalyzerArtifacts = async (input: {
  readonly repositoryRoot: string
  readonly signals: SecuritySignalsConfig
  readonly paths: {
    readonly include?: readonly string[]
    readonly exclude?: readonly string[]
  }
  readonly changedRanges: readonly ChangedLineRange[]
  readonly redact: (value: string) => string
}): Promise<AnalyzerIngestionResult> => {
  const resolvePath = createAnalyzerPathResolver({ paths: input.paths })
  const metrics: AnalyzerArtifactMetric[] = []
  const warnings: string[] = []
  const attributed: AttributedAnalyzerAlert[] = []

  for (const artifact of input.signals.artifacts) {
    const { portablePath, bytes, contentHash, log } = await readSarifArtifact({
      repositoryRoot: input.repositoryRoot,
      artifactPath: artifact.path,
      maxArtifactBytes: input.signals.maxArtifactBytes
    })
    const normalized = normalizeSarifLog({
      log,
      artifactPath: portablePath,
      artifactContentHash: contentHash,
      resolvePath,
      redact: input.redact
    })
    const attribution = attributeAlertsToChange({
      alerts: normalized.alerts,
      changedRanges: input.changedRanges
    })

    attributed.push(...attribution.attributed)
    metrics.push(
      AnalyzerArtifactMetricSchema.parse({
        path: portablePath,
        analyzer: normalized.analyzer.name,
        ...(normalized.analyzer.version === undefined
          ? {}
          : { analyzerVersion: normalized.analyzer.version }),
        bytes,
        resultCount: normalized.resultCount,
        unusableCount: normalized.unusableCount,
        attributedCount: attribution.attributed.length,
        preExistingCount: attribution.preExistingCount
      })
    )

    if (normalized.resultCount === 0) {
      warnings.push(
        `Analyzer artifact "${portablePath}" contains no results. It parsed correctly, so this is an empty scan, not a clean repository — check that the analyzer ran over the code under review.`
      )
    }

    if (normalized.unusableCount > 0) {
      warnings.push(
        `Analyzer artifact "${portablePath}": ${normalized.unusableCount} of ${normalized.resultCount} results could not be used and are not in the review (no rule id, no line-level location, or a location outside the repository's eligible paths).`
      )
    }

    if (attribution.preExistingCount > 0) {
      warnings.push(
        `Analyzer artifact "${portablePath}": ${attribution.preExistingCount} results have no changed-side cause and are NOT reported. This engine does not attribute pre-existing repository debt to a change; run the analyzer's own report to see them.`
      )
    }
  }

  if (input.signals.artifacts.length > 0 && input.changedRanges.length === 0) {
    warnings.push(
      'security.signals is enabled but this run has no changed line ranges, so no analyzer result can be tied to a change and none is reported. Analyzer ingestion applies to diff-based reviews.'
    )
  }

  const ranked = rankAttributedAlerts(attributed)
  const kept = ranked.slice(0, input.signals.maxAlerts)

  if (ranked.length > kept.length) {
    warnings.push(
      `${ranked.length} analyzer results were attributed to this change but security.signals.maxAlerts is ${input.signals.maxAlerts}; the ${kept.length} highest-severity are in the review and ${
        ranked.length - kept.length
      } are not.`
    )
  }

  return {
    alerts: kept,
    evidence: analyzerEvidenceForAlerts(kept),
    metrics,
    warnings
  }
}
