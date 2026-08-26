import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { resolveExistingPathInsideRoot } from '../../platform/path-service.js'
import {
  DriftCategorySchema,
  type CodeReviewerConfig,
  type DriftCategory
} from '../../shared/contracts/index.js'
import { isFileNotFoundError } from '../../shared/errors/error-normalizer.js'
import {
  collectTextFiles,
  pathExists,
  type TextFile
} from './markdown-sources.js'

export const DriftGateSchema = z.enum(['warning', 'error'])

export const DriftFindingSchema = z.strictObject({
  id: z.string().min(1),
  category: DriftCategorySchema,
  gate: DriftGateSchema,
  path: z.string().min(1),
  message: z.string().min(1),
  evidence: z.string().min(1),
  recommendation: z.string().min(1)
})

/**
 * What the generated-artifact comparison was actually able to do.
 *
 * IT IS A SEPARATE FIELD BECAUSE `passed` CANNOT CARRY IT. This is the check that
 * compares the two committed copies of the generated config schema, and
 * `generated-artifact-drift` is one of only two categories that fail a build by
 * default — so it is the one check whose silence is expensive. It used to fold
 * every non-comparison into `passed: true`: a deleted, renamed or unreadable copy
 * produced zero findings and a green result, and in a consumer's repository, where
 * neither copy exists at all, the check was permanently inert and permanently
 * green with nothing saying so.
 *
 * Absence is now reported instead of assumed. `absent` is not a failure — a
 * consumer repository legitimately has neither copy — but it is a different fact
 * from `compared`, and a caller that wants to know whether anything was checked
 * can now find out without inferring it from an empty findings list.
 */
export const GeneratedArtifactStatusSchema = z.enum([
  /** Drift checking, or generated-artifact checking, is switched off. */
  'not-checked',
  /** Neither copy exists. Nothing to compare, and nothing is claimed. */
  'absent',
  /** Exactly one copy exists. Reported as a finding. */
  'incomplete',
  /** A copy exists but could not be read. Reported as a finding. */
  'unreadable',
  /** Both copies were read and compared. Any difference is a finding. */
  'compared'
])

/**
 * How much of the repository the content scan actually read.
 *
 * THE SIBLING OF `generatedArtifactStatus` ABOVE, AND IT EXISTS FOR THE SAME
 * REASON: `passed` cannot carry it. Every content check — links, stale paths,
 * ambiguity, CLI-command drift — runs over the file list `collectScanCoverage`
 * gathers from `README.md`, `docs/` and `specs/`, and an absent root contributes
 * zero files rather than an error. So in a repository holding none of them the
 * whole documentation half of the gate ran over an empty list, found nothing,
 * and returned `passed: true, warningCount: 0, errorCount: 0` and exit 0 — a
 * permanently green gate, indistinguishable from a genuinely clean repository.
 *
 * Absence is reported instead of assumed. `absent` is not a failure — nothing
 * obliges a consumer repository to have `docs/` or `specs/`, and failing here
 * would break every consumer that does not — but it is a different fact from
 * `scanned`, and a caller that wants to know whether anything was read can now
 * find out without inferring it from an empty findings list.
 */
export const ScanCoverageStatusSchema = z.enum([
  /** Drift checking is switched off. Nothing was read, and nothing is claimed. */
  'not-checked',
  /** No scan root exists. Every content check ran over an empty file list. */
  'absent',
  /** Some scan roots exist and some do not. Only part of the gate had input. */
  'partial',
  /** Every scan root exists and was read. */
  'scanned'
])

export const DriftCheckResultSchema = z.strictObject({
  passed: z.boolean(),
  warningCount: z.int().min(0),
  errorCount: z.int().min(0),
  generatedArtifactStatus: GeneratedArtifactStatusSchema,
  scanCoverageStatus: ScanCoverageStatusSchema,
  // How many files the content checks actually read. Zero alongside
  // `passed: true` is the shape this field exists to make visible.
  scannedFileCount: z.int().min(0),
  // Which roots were not there, so `partial` and `absent` are actionable rather
  // than merely honest. Ordered as `scanRoots` is, for a stable serialization.
  absentScanRoots: z.array(z.string().min(1)),
  findings: z.array(DriftFindingSchema)
})

export type DriftGate = z.infer<typeof DriftGateSchema>
export type DriftFinding = z.infer<typeof DriftFindingSchema>
export type GeneratedArtifactStatus = z.infer<
  typeof GeneratedArtifactStatusSchema
>
export type ScanCoverageStatus = z.infer<typeof ScanCoverageStatusSchema>
export type DriftCheckResult = z.infer<typeof DriftCheckResultSchema>

const scanRoots = ['README.md', 'docs', 'specs'] as const
const generatedSchemaPath = 'schema/codereviewer-config.schema.json'
const specsConfigSchemaPath = 'specs/03-contracts/config.schema.json'

const ambiguityPattern =
  /\b(best possible|secure as possible|state of the art|where possible|as needed|if needed|should be robust|clean code)\b/iu

const localMarkdownLinkPattern = /\[[^\]]+\]\((?!https?:\/\/|#)([^)]+)\)/giu

const gateFor = (
  config: CodeReviewerConfig,
  category: DriftCategory
): DriftGate => config.drift.failOn.includes(category) ? 'error' : 'warning'

const findingId = (
  category: DriftCategory,
  filePath: string,
  evidence: string
): string =>
  `drift_${Buffer.from(`${category}:${filePath}:${evidence}`).toString('hex').slice(0, 24)}`

const createFinding = (
  config: CodeReviewerConfig,
  input: Omit<DriftFinding, 'id' | 'gate'>
): DriftFinding =>
  DriftFindingSchema.parse({
    ...input,
    id: findingId(input.category, input.path, input.evidence),
    gate: gateFor(config, input.category)
  })

type ScanCoverage = {
  readonly status: ScanCoverageStatus
  readonly files: readonly TextFile[]
  readonly absentRoots: readonly string[]
}

const scanCoverageStatusFor = (absentRootCount: number): ScanCoverageStatus => {
  if (absentRootCount === 0) {
    return 'scanned'
  }

  if (absentRootCount === scanRoots.length) {
    return 'absent'
  }

  return 'partial'
}

const collectScanCoverage = async (
  repositoryRoot: string
): Promise<ScanCoverage> => {
  const perRoot = await Promise.all(
    scanRoots.map(async (root) => ({
      root,
      // Existence is ASKED, not inferred from the file list. `collectTextFiles`
      // returns `[]` both for a root that is not there and for one that holds no
      // scannable file, and those are different facts: the first means the gate
      // had no input, the second means it had input and there was nothing to
      // read. Collapsing them would reintroduce the silence in a new place.
      present: await pathExists(repositoryRoot, root),
      files: await collectTextFiles(repositoryRoot, root)
    }))
  )
  const absentRoots = perRoot
    .filter((entry) => !entry.present)
    .map((entry) => entry.root)

  return {
    status: scanCoverageStatusFor(absentRoots.length),
    files: perRoot.flatMap((entry) => entry.files),
    absentRoots
  }
}

const checkMarkdownLinks = async (
  repositoryRoot: string,
  config: CodeReviewerConfig,
  files: readonly TextFile[]
): Promise<readonly DriftFinding[]> => {
  const findings: DriftFinding[] = []

  for (const file of files.filter((candidate) => candidate.path.endsWith('.md'))) {
    for (const match of file.content.matchAll(localMarkdownLinkPattern)) {
      const target = match[1]?.split('#')[0]

      if (target === undefined || target.length === 0) {
        continue
      }

      const targetPath = path.posix.normalize(
        path.posix.join(path.posix.dirname(file.path), target)
      )

      if (!(await pathExists(repositoryRoot, targetPath))) {
        findings.push(
          createFinding(config, {
            category: 'documentation-drift',
            path: file.path,
            message: 'Markdown link target does not exist.',
            evidence: target,
            recommendation: 'Update or remove the stale local documentation link.'
          })
        )
      }
    }
  }

  return findings
}

const checkStalePathReferences = (
  config: CodeReviewerConfig,
  files: readonly TextFile[]
): readonly DriftFinding[] =>
  files.flatMap((file) => {
    const findings: DriftFinding[] = []

    // `\b` also matches after a slash, which made prose like
    // "documentation/spec/implementation" read as a stale spec root. Require
    // that `spec/` does not continue a word or an existing path segment.
    if (/(?<![\w/])spec\//u.test(file.content)) {
      findings.push(
        createFinding(config, {
          category: 'spec-drift',
          path: file.path,
          message: 'Stale spec root reference found.',
          evidence: 'spec/',
          recommendation: 'Use specs/ as the canonical spec root.'
        })
      )
    }

    const obsoleteArtifactRoot = `.${'review'}`

    // The obsolete root is a DIRECTORY, and that is what distinguishes it from the
    // many legitimate `.review` spellings in prose. Both boundaries are needed:
    //
    // - trailing, so an identifier that merely begins with "review" (for example
    //   `reporting.reviewComments`) is not read as the old artifact directory;
    // - leading, so a PROPERTY ACCESS is not either. `CodeReviewerConfigSchema.review`
    //   is a schema field this repository still has, and it was being reported as a
    //   stale artifact path — an `error`-gated finding that failed `drift check`
    //   outright and kept the whole gate out of CI.
    //
    // A directory root is never preceded by an identifier character: a real stale
    // path reads `.review/…`, `` `.review` `` or "the .review directory", where the
    // preceding character is a separator, quote or space. So the lookbehind costs no
    // detection.
    if (
      new RegExp(
        `(?<![A-Za-z0-9_])\\${obsoleteArtifactRoot}(?![A-Za-z])`,
        'u'
      ).test(file.content)
    ) {
      findings.push(
        createFinding(config, {
          category: 'security-drift',
          path: file.path,
          message: 'Stale artifact/config path reference found.',
          evidence: obsoleteArtifactRoot,
          recommendation: 'Use .codereviewer paths only.'
        })
      )
    }

    return findings
  })

const checkAmbiguity = (
  config: CodeReviewerConfig,
  files: readonly TextFile[]
): readonly DriftFinding[] =>
  files.flatMap((file) => {
    const match = ambiguityPattern.exec(file.content)

    return match?.[0] === undefined
      ? []
      : [
          createFinding(config, {
            category: 'ambiguity',
            path: file.path,
            message: 'Ambiguous implementation language found.',
            evidence: match[0],
            recommendation:
              'Replace subjective wording with measurable acceptance criteria.'
          })
        ]
  })

// Implemented CLI command inventory. Documentation referencing a command outside
// this set describes behavior the implementation does not provide.
//
// This is a hand-maintained mirror of the CLI's dispatch, because a domain must not
// import from the CLI layer. That makes it a second source of truth, and it drifted:
// `intent` was missing long after `intent check` shipped, so every spec that
// documented the command correctly was reported as documenting a command that does
// not exist. `src/cli/drift-checker-cli-inventory.test.ts` now pins this set against the
// CLI's real dispatch so the mirror cannot silently fall behind again.
export const implementedCliCommands = new Set([
  'config',
  'review',
  'baseline',
  'eval',
  'drift',
  'impact',
  'intent'
])
const cliCommandPattern =
  /(?:`|^|\n)\s*(?:npx\s+tsx\s+src\/cli\/main\.ts|codereviewer)\s+([a-z][a-z-]*)/gu

const checkImplementationDrift = (
  config: CodeReviewerConfig,
  files: readonly TextFile[]
): readonly DriftFinding[] =>
  files
    .filter((file) => file.path.endsWith('.md'))
    .flatMap((file) => {
      const findings: DriftFinding[] = []
      const unknownCommands = new Set<string>()
      const staleProviderRetryPatterns = [
        'queue-owned retries',
        'queue owns bounded retries'
      ] as const

      for (const match of file.content.matchAll(cliCommandPattern)) {
        const command = match[1]

        if (command !== undefined && !implementedCliCommands.has(command)) {
          unknownCommands.add(command)
        }
      }

      for (const command of unknownCommands) {
        findings.push(
          createFinding(config, {
            category: 'implementation-drift',
            path: file.path,
            message: 'Documented CLI command is not implemented.',
            evidence: `codereviewer ${command}`,
            recommendation:
              'Implement the command or correct the documentation to match the CLI.'
          })
        )
      }

      const lowerContent = file.content.toLowerCase()

      for (const staleRetryClaim of staleProviderRetryPatterns) {
        if (!lowerContent.includes(staleRetryClaim)) {
          continue
        }

        findings.push(
          createFinding(config, {
            category: 'implementation-drift',
            path: file.path,
            message: 'Stale provider retry ownership claim found.',
            evidence: staleRetryClaim,
            recommendation:
              'Document provider-call retries as owned by the Harness model retry policy, not the workflow task queue.'
          })
        )
      }

      return findings
    })

// One committed copy of the generated config schema, as it was found on disk.
//
// The three states are kept apart because they mean different things and only one
// of them is benign. Collapsing them — which is what a `.catch(() => undefined)`
// does — makes "the file is not there", "the file is there but I could not read
// it" and "I read it" indistinguishable to the caller.
type SchemaCopy =
  | { readonly state: 'present'; readonly content: string }
  | { readonly state: 'missing' }
  | { readonly state: 'unreadable'; readonly reason: string }

const readSchemaCopy = async (
  repositoryRoot: string,
  relativePath: string
): Promise<SchemaCopy> => {
  try {
    const resolvedPath = await resolveExistingPathInsideRoot(
      repositoryRoot,
      relativePath
    )

    return { state: 'present', content: await readFile(resolvedPath, 'utf8') }
  } catch (error) {
    // A path that does not exist is reported by `realpath` and by `readFile` alike
    // as ENOENT. EVERY OTHER FAILURE IS SOMETHING ELSE — a permission error, a
    // directory where a file was expected, a path escaping the repository root —
    // and must not be read as "the file is legitimately absent".
    if (isFileNotFoundError(error)) {
      return { state: 'missing' }
    }

    return {
      state: 'unreadable',
      reason: error instanceof Error ? error.message : String(error)
    }
  }
}

const checkGeneratedSchemaDrift = async (
  repositoryRoot: string,
  config: CodeReviewerConfig
): Promise<{
  readonly status: GeneratedArtifactStatus
  readonly findings: readonly DriftFinding[]
}> => {
  if (!config.drift.includeGenerated) {
    return { status: 'not-checked', findings: [] }
  }

  const [generated, specsSchema] = await Promise.all([
    readSchemaCopy(repositoryRoot, generatedSchemaPath),
    readSchemaCopy(repositoryRoot, specsConfigSchemaPath)
  ])

  const unreadableFinding = (
    relativePath: string,
    reason: string
  ): DriftFinding =>
    createFinding(config, {
      category: 'generated-artifact-drift',
      path: relativePath,
      message: 'Generated config schema copy could not be read.',
      evidence: `${relativePath}: ${reason}`,
      recommendation:
        'Restore read access to the generated schema copy, then run npm run generate:schemas.'
    })

  // A copy that exists and cannot be read is the worst case for this check: the
  // comparison is impossible and the reason is NOT "nothing is there". Reported
  // first, and reported as a finding, because a silent pass here is exactly how a
  // stale generated artifact reaches a release.
  if (generated.state === 'unreadable' || specsSchema.state === 'unreadable') {
    return {
      status: 'unreadable',
      findings: [
        ...(generated.state === 'unreadable'
          ? [unreadableFinding(generatedSchemaPath, generated.reason)]
          : []),
        ...(specsSchema.state === 'unreadable'
          ? [unreadableFinding(specsConfigSchemaPath, specsSchema.reason)]
          : [])
      ]
    }
  }

  // Neither copy exists. That is the normal shape of a repository that consumes
  // this tool rather than generating the schema, so it is NOT a finding — but it
  // is reported as its own status rather than folded into `passed`, because
  // "nothing was compared" and "the copies agree" are not the same statement.
  if (generated.state === 'missing' && specsSchema.state === 'missing') {
    return { status: 'absent', findings: [] }
  }

  // Exactly one copy. The repository does generate this artifact and half of it
  // has gone — a deletion, a rename, or a generator that wrote one output.
  if (generated.state === 'missing' || specsSchema.state === 'missing') {
    const missingPath =
      generated.state === 'missing' ? generatedSchemaPath : specsConfigSchemaPath

    return {
      status: 'incomplete',
      findings: [
        createFinding(config, {
          category: 'generated-artifact-drift',
          path: missingPath,
          message: 'Generated config schema copy is missing.',
          evidence: `${missingPath} is absent while its counterpart is present`,
          recommendation:
            'Run npm run generate:schemas and commit both outputs, or remove both copies.'
        })
      ]
    }
  }

  return {
    status: 'compared',
    findings:
      generated.content === specsSchema.content
        ? []
        : [
            createFinding(config, {
              category: 'generated-artifact-drift',
              path: specsConfigSchemaPath,
              message: 'Generated config schema copies differ.',
              evidence: `${generatedSchemaPath} != ${specsConfigSchemaPath}`,
              recommendation:
                'Run npm run generate:schemas and commit both outputs.'
            })
          ]
  }
}

export const runDriftCheck = async (
  input: {
    readonly repositoryRoot: string
    readonly config: CodeReviewerConfig
  }
): Promise<DriftCheckResult> => {
  if (!input.config.drift.enabled) {
    return DriftCheckResultSchema.parse({
      passed: true,
      warningCount: 0,
      errorCount: 0,
      generatedArtifactStatus: 'not-checked',
      scanCoverageStatus: 'not-checked',
      scannedFileCount: 0,
      absentScanRoots: [],
      findings: []
    })
  }

  const scan = await collectScanCoverage(input.repositoryRoot)
  const files = scan.files
  const generatedArtifact = await checkGeneratedSchemaDrift(
    input.repositoryRoot,
    input.config
  )
  const findings = [
    ...(input.config.drift.includeDocs
      ? await checkMarkdownLinks(input.repositoryRoot, input.config, files)
      : []),
    ...(input.config.drift.includeSpecs
      ? checkStalePathReferences(input.config, files)
      : []),
    ...(input.config.drift.includeDocs
      ? checkImplementationDrift(input.config, files)
      : []),
    ...checkAmbiguity(input.config, files),
    ...generatedArtifact.findings
  ]
  const errorCount = findings.filter((finding) => finding.gate === 'error').length
  const warningCount = findings.length - errorCount
  const sortedFindings = [...findings].sort(
    (left, right) =>
      left.path.localeCompare(right.path) || left.id.localeCompare(right.id)
  )

  // `passed` stays a statement about findings alone, exactly as it does for
  // `generatedArtifactStatus`: an absent scan root is not a drift finding, and
  // failing on it would break every consumer repository that has no `specs/`.
  // What changes is that "nothing was scanned" is now on the result instead of
  // hiding behind a zero count.
  return DriftCheckResultSchema.parse({
    passed: errorCount === 0,
    warningCount,
    errorCount,
    generatedArtifactStatus: generatedArtifact.status,
    scanCoverageStatus: scan.status,
    scannedFileCount: files.length,
    absentScanRoots: scan.absentRoots,
    findings: sortedFindings
  })
}
