import { z } from 'zod'
import {
  FindingCategorySchema,
  RepositoryRelativePathSchema,
  SeveritySchema
} from '../../shared/contracts/index.js'

export const EvalSourceProfileSchema = z.enum([
  'project',
  'benchmark-semantic',
  'captured-pr'
])

export const EvalMatchModeSchema = z.enum([
  'path-line',
  'path-semantic',
  'semantic-only'
])

export type EvalMatchMode = z.infer<typeof EvalMatchModeSchema>

export const EvalLineRangeSchema = z
  .tuple([z.int().min(1), z.int().min(1)])
  .refine(([startLine, endLine]) => endLine >= startLine, {
    message: 'Line range end must be greater than or equal to start.'
  })

export const ExpectedFindingTierSchema = z.enum([
  'runtime-critical',
  'security',
  'logic',
  'nit'
])

// Spec-15 security mechanisms (OWASP/CWE aligned). A security expected finding
// MAY carry the mechanism it exercises so the eval can measure recall per
// mechanism. Purely a ground-truth categorisation of the committed fixtures; it
// never feeds any detector.
export const SecurityMechanismSchema = z.enum([
  'authorization',
  'injection',
  'ssrf',
  'xss',
  'deserialization',
  'secret-flow',
  'cryptography',
  'path-traversal',
  'unsafe-config',
  'concurrency-resource',
  'prompt-injection'
])

export type SecurityMechanism = z.infer<typeof SecurityMechanismSchema>

// Spec-15 context-depth: how far beyond the changed lines a reviewer must reason
// to catch the defect. `local` is the obvious, self-contained class; every other
// depth is a hard class. Used to split obvious-vs-hard security recall so aced
// trivial sinks never mask the hard-class gap.
export const SecurityContextDepthSchema = z.enum([
  'local',
  'cross-function',
  'callee',
  'caller',
  'implementation',
  'cross-file',
  'analyzer-path-dependent'
])

export type SecurityContextDepth = z.infer<typeof SecurityContextDepthSchema>

// The obvious class is exactly the `local` context depth; everything else is a
// hard class. Declared once so the runner and metrics never disagree.
export const isObviousSecurityContextDepth = (
  depth: SecurityContextDepth
): boolean => depth === 'local'

// Headline product tiers that the >80% recall goal is measured against. The
// `nit` tier (docs, naming, typo, UI, i18n, style, maintainability, tests,
// policy) is reported separately and intentionally excluded.
export const productRecallTiers = [
  'runtime-critical',
  'security',
  'logic'
] as const

// Effective match mode of an expected finding. Declared once here and reused by
// the matcher, the report assemblers, and the slice manifest so the derivation
// can never drift between the code that scores a fixture and the code that
// describes it.
export type ExpectedFindingMatchModeInput = {
  readonly path?: string | undefined
  readonly lineRange?: readonly [number, number] | undefined
  readonly matchMode?: EvalMatchMode | undefined
}

export const resolveExpectedFindingMatchMode = (
  expected: ExpectedFindingMatchModeInput
): EvalMatchMode =>
  expected.matchMode ??
  (expected.path === undefined
    ? 'semantic-only'
    : expected.lineRange === undefined
      ? 'path-semantic'
      : 'path-line')

export const ExpectedFindingSchema = z
  .strictObject({
    category: FindingCategorySchema,
    severity: SeveritySchema,
    path: RepositoryRelativePathSchema.optional(),
    lineRange: EvalLineRangeSchema.optional(),
    semanticSummary: z.string().min(1).max(500),
    matchMode: EvalMatchModeSchema.optional(),
    tier: ExpectedFindingTierSchema.optional(),
    // Spec-15 security labels. Both are optional and only meaningful on
    // security-category findings, which the measurement filters on.
    securityMechanism: SecurityMechanismSchema.optional(),
    contextDepth: SecurityContextDepthSchema.optional()
  })
  .superRefine((value, context) => {
    const matchMode = resolveExpectedFindingMatchMode(value)

    if (matchMode !== 'semantic-only' && value.path === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['path'],
        message: 'path is required for path-based expected findings'
      })
    }

    if (matchMode === 'semantic-only' && value.lineRange !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['lineRange'],
        message: 'lineRange requires a path-based expected finding'
      })
    }

    // The security labels categorise security ground truth; carrying them on a
    // non-security finding would silently pollute a per-mechanism denominator.
    if (
      (value.securityMechanism !== undefined ||
        value.contextDepth !== undefined) &&
      value.category !== 'security'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['securityMechanism'],
        message:
          'securityMechanism and contextDepth are only valid on security-category findings'
      })
    }
  })

export const ExpectedNoFindingZoneSchema = z.strictObject({
  path: RepositoryRelativePathSchema,
  lineRange: EvalLineRangeSchema.optional(),
  reason: z.string().min(1).max(500)
})

export const EvalCaseSchema = z.strictObject({
  id: z.string().min(1),
  language: z.string().min(1),
  repositoryFixture: RepositoryRelativePathSchema,
  baseRef: z.string().min(1).optional(),
  headRef: z.string().min(1).optional(),
  changedFiles: z.array(RepositoryRelativePathSchema),
  expectedFindings: z.array(ExpectedFindingSchema),
  expectedNoFindingZones: z.array(ExpectedNoFindingZoneSchema).default([]),
  tags: z.array(z.string().min(1)),
  sourceProfile: EvalSourceProfileSchema.optional(),
  diff: z.string().optional()
})

export const EvalCaseSetSchema = z.array(EvalCaseSchema)

const EvalSliceCaseRawSchema = z.strictObject({
  id: z.string().min(1),
  title: z.string().min(1).max(200).optional(),
  description: z.string().min(1).max(1000).optional(),
  source: z.string().min(1).max(100).optional(),
  sourceUrl: z.url().optional(),
  sourceProfile: EvalSourceProfileSchema.optional(),
  capturedAt: z.iso.date().optional(),
  prUrl: z.url().optional(),
  prTitle: z.string().min(1).max(300).optional(),
  sourceRepo: z.string().min(1).max(200).optional(),
  baseSha: z.string().min(1).optional(),
  headSha: z.string().min(1).optional(),
  upstreamOwner: z.string().min(1).max(200).optional(),
  upstreamRepo: z.string().min(1).max(200).optional(),
  hydratedSource: z.string().min(1).max(100).optional(),
  hydratedHeadRepository: z.string().min(1).max(200).optional(),
  hydratedHeadRef: z.string().min(1).optional(),
  diff: z.string().optional(),
  language: z.string().min(1),
  baseRef: z.string().min(1).optional(),
  headRef: z.string().min(1).optional(),
  changedFiles: z.array(RepositoryRelativePathSchema),
  expectedFindings: z.array(ExpectedFindingSchema),
  expectedNoFindingZones: z.array(ExpectedNoFindingZoneSchema).default([]),
  tags: z.array(z.string().min(1)).default([])
})

export type ExpectedFindingTier = z.infer<typeof ExpectedFindingTierSchema>

export const EvalSliceCaseSchema = EvalSliceCaseRawSchema.transform((value) => {
  const sourceProfile = value.sourceProfile ?? 'project'
  const tags = new Set([
    ...(value.source === undefined ? [] : [value.source]),
    sourceProfile,
    ...value.tags
  ])

  return {
    ...value,
    sourceProfile,
    expectedFindings: value.expectedFindings,
    expectedNoFindingZones: value.expectedNoFindingZones,
    tags: [...tags]
  }
})

export type EvalLineRange = z.infer<typeof EvalLineRangeSchema>
export type ExpectedFinding = z.infer<typeof ExpectedFindingSchema>
export type ExpectedNoFindingZone = z.infer<typeof ExpectedNoFindingZoneSchema>
export type EvalCase = z.infer<typeof EvalCaseSchema>

// Resolve the measurement tier for an expected finding. An explicit `tier`
// always wins; otherwise it is derived from category and severity so untiered
// fixtures still classify deterministically. Categories without a runtime,
// security, or logic risk (maintainability, test, policy) collapse to `nit`.
export const resolveExpectedFindingTier = (
  finding: Pick<ExpectedFinding, 'category' | 'severity' | 'tier'>
): ExpectedFindingTier => {
  if (finding.tier !== undefined) {
    return finding.tier
  }

  switch (finding.category) {
    case 'security':
      return 'security'
    case 'bug':
      return finding.severity === 'critical' || finding.severity === 'high'
        ? 'runtime-critical'
        : 'logic'
    case 'performance':
    case 'compatibility':
      return 'logic'
    case 'maintainability':
    case 'test':
    case 'policy':
      return 'nit'
  }
}

export const parseEvalCases = (input: unknown): readonly EvalCase[] => {
  const cases = EvalCaseSetSchema.parse(input)
  const seenIds = new Set<string>()

  for (const evalCase of cases) {
    if (seenIds.has(evalCase.id)) {
      throw new Error(`Duplicate eval case id "${evalCase.id}".`)
    }

    seenIds.add(evalCase.id)
  }

  return cases
}

export const parseEvalCasesJson = (jsonText: string): readonly EvalCase[] => {
  const parsed: unknown = JSON.parse(jsonText)

  return parseEvalCases(parsed)
}
