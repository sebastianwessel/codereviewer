// Reads one configured analyzer artifact from the repository.
//
// Every step here can only fail loudly. The artifact is untrusted input whose
// absence, truncation, or corruption would otherwise be reported as "no security
// issues", so there is no branch in this module that returns an empty result.
//
// Containment is enforced by the repository path service, never by inspecting the
// configured string: `resolveExistingPathInsideRoot` refuses a path that escapes the
// root AND a symlink whose real target is outside it, which a `..`-check on the
// configured value would not catch.

import { readFile, stat } from 'node:fs/promises'
import {
  isFileNotFoundError,
  isZodError
} from '../../shared/errors/error-normalizer.js'
import { resolveExistingPathInsideRoot } from '../../platform/path-service.js'
import { sha256 } from '../../shared/hash/hash.js'
import { normalizeRepositoryRelativePath } from '../../platform/repository-path.js'
import { analyzerArtifactError } from './errors.js'
import { SarifLogSchema, type SarifLog } from './sarif/sarif.schema.js'

// Hard ceiling on results in one artifact, independent of its byte size. An
// artifact carrying more than this is a whole-repository scan rather than a
// change-scoped one; normalizing it would spend the run's time producing alerts
// that changed-side attribution is about to discard. Code-side, not configurable:
// raising it cannot help a review and can only cost a run.
export const MAX_ANALYZER_RESULTS_PER_ARTIFACT = 10_000

export type ReadAnalyzerArtifactResult = {
  readonly portablePath: string
  readonly bytes: number
  // Hash of the artifact's exact bytes. Provenance for an untrusted input: it says
  // which document made a claim, and whether it is the document a previous run read.
  readonly contentHash: string
  readonly log: SarifLog
}

const describeZodIssues = (error: unknown): string => {
  if (!isZodError(error)) {
    return 'the document does not match the SARIF 2.1.0 shape this engine reads'
  }

  return error.issues
    .slice(0, 5)
    .map((issue) => {
      const at =
        issue.path === undefined || issue.path.length === 0
          ? '(root)'
          : issue.path.join('.')

      return `${at}: ${issue.message ?? 'invalid value'}`
    })
    .join('; ')
}

/**
 * Resolve, size-check, parse and schema-validate one SARIF artifact.
 *
 * Throws a structured `config`-category error (exit 2) when the artifact is
 * missing, unreadable, larger than `maxArtifactBytes`, not JSON, not SARIF 2.1.0,
 * or carries more results than this engine will normalize.
 */
export const readSarifArtifact = async (input: {
  readonly repositoryRoot: string
  readonly artifactPath: string
  readonly maxArtifactBytes: number
}): Promise<ReadAnalyzerArtifactResult> => {
  const portablePath = normalizeRepositoryRelativePath(input.artifactPath)
  let absolutePath: string

  try {
    absolutePath = await resolveExistingPathInsideRoot(
      input.repositoryRoot,
      portablePath
    )
  } catch (error) {
    throw analyzerArtifactError({
      code: 'analyzer_artifact_unreadable',
      message: isFileNotFoundError(error)
        ? `Analyzer artifact "${portablePath}" does not exist. security.signals is enabled, so a configured artifact that is not there fails the run rather than reporting no security signals.`
        : `Analyzer artifact "${portablePath}" does not resolve inside the repository. Configure a repository-relative path to a file within the repository.`,
      details: { path: portablePath }
    })
  }

  // Size is checked BEFORE the file is read, so an oversized artifact is never
  // materialized in memory to discover that it was oversized.
  const stats = await stat(absolutePath)

  if (!stats.isFile()) {
    throw analyzerArtifactError({
      code: 'analyzer_artifact_unreadable',
      message: `Analyzer artifact "${portablePath}" is not a regular file.`,
      details: { path: portablePath }
    })
  }

  if (stats.size > input.maxArtifactBytes) {
    throw analyzerArtifactError({
      code: 'analyzer_artifact_too_large',
      message: `Analyzer artifact "${portablePath}" is ${stats.size} bytes, above the security.signals.maxArtifactBytes limit of ${input.maxArtifactBytes}. Narrow the analyzer's scope or raise the limit deliberately; the artifact is NOT read partially.`,
      details: {
        path: portablePath,
        bytes: stats.size,
        maxArtifactBytes: input.maxArtifactBytes
      }
    })
  }

  const raw = await readFile(absolutePath, 'utf8')
  let parsed: unknown

  try {
    parsed = JSON.parse(raw) as unknown
  } catch (error) {
    throw analyzerArtifactError({
      code: 'analyzer_artifact_invalid',
      message: `Analyzer artifact "${portablePath}" is not valid JSON: ${
        error instanceof Error ? error.message : 'parse failed'
      }`,
      details: { path: portablePath }
    })
  }

  const result = SarifLogSchema.safeParse(parsed)

  if (!result.success) {
    throw analyzerArtifactError({
      code: 'analyzer_artifact_invalid',
      message: `Analyzer artifact "${portablePath}" is not a SARIF 2.1.0 document this engine can read — ${describeZodIssues(result.error)}`,
      details: { path: portablePath }
    })
  }

  const resultCount = result.data.runs.reduce(
    (total, run) => total + (run.results?.length ?? 0),
    0
  )

  if (resultCount > MAX_ANALYZER_RESULTS_PER_ARTIFACT) {
    throw analyzerArtifactError({
      code: 'analyzer_artifact_too_large',
      message: `Analyzer artifact "${portablePath}" carries ${resultCount} results, above the ${MAX_ANALYZER_RESULTS_PER_ARTIFACT} this engine normalizes. Scope the analyzer to the change under review rather than the whole repository.`,
      details: { path: portablePath, resultCount }
    })
  }

  return {
    portablePath,
    bytes: stats.size,
    contentHash: sha256(raw),
    log: result.data
  }
}
