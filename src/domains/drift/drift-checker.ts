import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { resolveExistingPathInsideRoot } from '../../platform/path-service.js'
import {
  DriftCategorySchema,
  type CodeReviewerConfig,
  type DriftCategory
} from '../../shared/contracts/index.js'

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

export const DriftCheckResultSchema = z.strictObject({
  passed: z.boolean(),
  warningCount: z.int().min(0),
  errorCount: z.int().min(0),
  findings: z.array(DriftFindingSchema)
})

export type DriftGate = z.infer<typeof DriftGateSchema>
export type DriftFinding = z.infer<typeof DriftFindingSchema>
export type DriftCheckResult = z.infer<typeof DriftCheckResultSchema>

type TextFile = {
  readonly path: string
  readonly content: string
}

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

const pathExists = async (
  repositoryRoot: string,
  repositoryRelativePath: string
): Promise<boolean> => {
  try {
    await stat(
      await resolveExistingPathInsideRoot(repositoryRoot, repositoryRelativePath)
    )
    return true
  } catch {
    return false
  }
}

const collectTextFiles = async (
  repositoryRoot: string,
  requestedPath: string
): Promise<readonly TextFile[]> => {
  if (!(await pathExists(repositoryRoot, requestedPath))) {
    return []
  }

  const resolved = await resolveExistingPathInsideRoot(
    repositoryRoot,
    requestedPath
  )
  const fileStat = await stat(resolved)

  if (fileStat.isFile()) {
    return [
      {
        path: requestedPath,
        content: await readFile(resolved, 'utf8')
      }
    ]
  }

  // Sort directory entries so traversal order (and therefore the serialized
  // findings order) is stable across platforms and filesystems.
  const entries = (await readdir(resolved, { withFileTypes: true })).sort(
    (left, right) => left.name.localeCompare(right.name)
  )
  const nested = await Promise.all(
    entries.map((entry) =>
      collectTextFiles(
        repositoryRoot,
        path.posix.join(requestedPath, entry.name)
      )
    )
  )

  return nested.flat().filter((file) => /\.(md|json|ya?ml)$/iu.test(file.path))
}

const collectScanFiles = async (
  repositoryRoot: string
): Promise<readonly TextFile[]> =>
  (await Promise.all(scanRoots.map((root) => collectTextFiles(repositoryRoot, root)))).flat()

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
    const contentForLegacyArtifactScan = file.content

    if (/\bspec\//u.test(file.content)) {
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

    if (
      new RegExp(`\\${obsoleteArtifactRoot}`, 'u').test(
        contentForLegacyArtifactScan
      )
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

// Implemented CLI command inventory. Documentation referencing a command
// outside this set describes behavior the implementation does not provide.
const implementedCliCommands = new Set([
  'config',
  'review',
  'eval',
  'drift'
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

const checkGeneratedSchemaDrift = async (
  repositoryRoot: string,
  config: CodeReviewerConfig
): Promise<readonly DriftFinding[]> => {
  if (!config.drift.includeGenerated) {
    return []
  }

  const [generated, specsSchema] = await Promise.all([
    resolveExistingPathInsideRoot(repositoryRoot, generatedSchemaPath)
      .then((resolvedPath) => readFile(resolvedPath, 'utf8'))
      .catch(() => undefined),
    resolveExistingPathInsideRoot(repositoryRoot, specsConfigSchemaPath)
      .then((resolvedPath) => readFile(resolvedPath, 'utf8'))
      .catch(() => undefined)
  ])

  if (generated === undefined || specsSchema === undefined || generated === specsSchema) {
    return []
  }

  return [
    createFinding(config, {
      category: 'generated-artifact-drift',
      path: specsConfigSchemaPath,
      message: 'Generated config schema copies differ.',
      evidence: `${generatedSchemaPath} != ${specsConfigSchemaPath}`,
      recommendation: 'Run npm run generate:schemas and commit both outputs.'
    })
  ]
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
      findings: []
    })
  }

  const files = await collectScanFiles(input.repositoryRoot)
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
    ...(await checkGeneratedSchemaDrift(input.repositoryRoot, input.config))
  ]
  const errorCount = findings.filter((finding) => finding.gate === 'error').length
  const warningCount = findings.length - errorCount
  const sortedFindings = [...findings].sort(
    (left, right) =>
      left.path.localeCompare(right.path) || left.id.localeCompare(right.id)
  )

  return DriftCheckResultSchema.parse({
    passed: errorCount === 0,
    warningCount,
    errorCount,
    findings: sortedFindings
  })
}
