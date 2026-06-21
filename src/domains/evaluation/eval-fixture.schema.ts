import { z } from 'zod'
import {
  FindingCategorySchema,
  RepositoryRelativePathSchema,
  SeveritySchema
} from '../../shared/contracts/index.js'

export const EvalLineRangeSchema = z
  .tuple([z.int().min(1), z.int().min(1)])
  .refine(([startLine, endLine]) => endLine >= startLine, {
    message: 'Line range end must be greater than or equal to start.'
  })

export const ExpectedFindingSchema = z.strictObject({
  category: FindingCategorySchema,
  severity: SeveritySchema,
  path: RepositoryRelativePathSchema,
  lineRange: EvalLineRangeSchema.optional(),
  semanticSummary: z.string().min(1).max(500)
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
  tags: z.array(z.string().min(1))
})

export const EvalCaseSetSchema = z.array(EvalCaseSchema)

export const EvalSliceCaseSchema = z.strictObject({
  id: z.string().min(1),
  title: z.string().min(1).max(200).optional(),
  description: z.string().min(1).max(1000).optional(),
  source: z.string().min(1).max(100).optional(),
  sourceUrl: z.url().optional(),
  capturedAt: z.iso.date().optional(),
  language: z.string().min(1),
  baseRef: z.string().min(1).optional(),
  headRef: z.string().min(1).optional(),
  changedFiles: z.array(RepositoryRelativePathSchema),
  expectedFindings: z.array(ExpectedFindingSchema),
  expectedNoFindingZones: z.array(ExpectedNoFindingZoneSchema).default([]),
  tags: z.array(z.string().min(1)).default([])
})

export type EvalLineRange = z.infer<typeof EvalLineRangeSchema>
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
