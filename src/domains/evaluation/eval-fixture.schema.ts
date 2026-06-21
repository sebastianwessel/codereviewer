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

export const EvalLineRangeSchema = z
  .tuple([z.int().min(1), z.int().min(1)])
  .refine(([startLine, endLine]) => endLine >= startLine, {
    message: 'Line range end must be greater than or equal to start.'
  })

export const ExpectedFindingSchema = z
  .strictObject({
    category: FindingCategorySchema,
    severity: SeveritySchema,
    path: RepositoryRelativePathSchema.optional(),
    lineRange: EvalLineRangeSchema.optional(),
    semanticSummary: z.string().min(1).max(500),
    matchMode: EvalMatchModeSchema.optional()
  })
  .superRefine((value, context) => {
    const matchMode =
      value.matchMode ??
      (value.path === undefined
        ? 'semantic-only'
        : value.lineRange === undefined
          ? 'path-semantic'
          : 'path-line')

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

const BenchmarkExpectedFindingSchema = z.strictObject({
  file: RepositoryRelativePathSchema.optional(),
  path: RepositoryRelativePathSchema.optional(),
  line: z.int().min(1).nullable().optional(),
  lineEnd: z.int().min(1).nullable().optional(),
  type: z.string().min(1).optional(),
  category: FindingCategorySchema.optional(),
  severity: SeveritySchema,
  description: z.string().min(1).max(500)
})

const categoryFromBenchmark = (
  expected: z.infer<typeof BenchmarkExpectedFindingSchema>
): z.infer<typeof FindingCategorySchema> => {
  if (expected.category !== undefined) {
    return expected.category
  }

  const parsed = FindingCategorySchema.safeParse(expected.type)

  return parsed.success ? parsed.data : 'bug'
}

const normalizeBenchmarkExpected = (
  expected: z.infer<typeof BenchmarkExpectedFindingSchema>
): z.infer<typeof ExpectedFindingSchema> => {
  const path = expected.path ?? expected.file
  const lineStart = expected.line ?? undefined
  const lineEnd = expected.lineEnd ?? lineStart
  const hasLineRange = path !== undefined && lineStart !== undefined

  return ExpectedFindingSchema.parse({
    category: categoryFromBenchmark(expected),
    severity: expected.severity,
    ...(path === undefined ? {} : { path }),
    ...(hasLineRange ? { lineRange: [lineStart, lineEnd] } : {}),
    semanticSummary: expected.description,
    matchMode:
      path === undefined
        ? 'semantic-only'
        : hasLineRange
          ? 'path-line'
          : 'path-semantic'
  })
}

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
  diff: z.string().optional(),
  language: z.string().min(1),
  baseRef: z.string().min(1).optional(),
  headRef: z.string().min(1).optional(),
  changedFiles: z.array(RepositoryRelativePathSchema),
  expectedFindings: z.array(ExpectedFindingSchema).optional(),
  expected: z.array(BenchmarkExpectedFindingSchema).optional(),
  expectedNoFindingZones: z.array(ExpectedNoFindingZoneSchema).default([]),
  tags: z.array(z.string().min(1)).default([])
})
  .superRefine((value, context) => {
    if (value.expectedFindings === undefined && value.expected === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['expectedFindings'],
        message: 'expectedFindings or expected is required'
      })
    }
  })

export const EvalSliceCaseSchema = EvalSliceCaseRawSchema.transform((value) => {
  const sourceProfile =
    value.sourceProfile ??
    (value.expectedFindings === undefined ? 'benchmark-semantic' : 'project')
  const expectedFindings =
    value.expectedFindings ??
    value.expected?.map(normalizeBenchmarkExpected) ??
    []
  const tags = new Set([
    ...(value.source === undefined ? [] : [value.source]),
    sourceProfile,
    ...value.tags
  ])

  return {
    ...value,
    sourceProfile,
    expectedFindings,
    expectedNoFindingZones: value.expectedNoFindingZones,
    tags: [...tags]
  }
})

export type EvalLineRange = z.infer<typeof EvalLineRangeSchema>
export type EvalSourceProfile = z.infer<typeof EvalSourceProfileSchema>
export type EvalMatchMode = z.infer<typeof EvalMatchModeSchema>
export type ExpectedFinding = z.infer<typeof ExpectedFindingSchema>
export type ExpectedNoFindingZone = z.infer<typeof ExpectedNoFindingZoneSchema>
export type EvalCase = z.infer<typeof EvalCaseSchema>
export type EvalSliceCase = z.infer<typeof EvalSliceCaseSchema>

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
