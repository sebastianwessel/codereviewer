// Reading an eval report back off disk. Two readers rather than one because the
// two commands that read reports ask different questions of them, and the
// contract each validates against is the difference.
import { readFile } from 'node:fs/promises'
import {
  EvalReportSchema,
  parseEvalComparisonReport,
  type EvalComparisonReport,
  type EvalReport
} from '../domains/evaluation/index.js'
import { resolveExistingPathInsideRoot } from '../platform/path-service.js'

const readEvalReportJson = async (
  repositoryRoot: string,
  reportPath: string
): Promise<unknown> =>
  JSON.parse(
    await readFile(
      await resolveExistingPathInsideRoot(repositoryRoot, reportPath),
      'utf8'
    )
  )

// The recall report renders one run's own numbers, so it validates against the
// PRODUCER contract: a report that does not satisfy it was not written by a
// compatible build and cannot be rendered field-for-field.
export const readEvalReport = async (
  repositoryRoot: string,
  reportPath: string
): Promise<EvalReport> =>
  EvalReportSchema.parse(await readEvalReportJson(repositoryRoot, reportPath))

// Comparison reads through the tolerant comparison view instead. Its whole job
// is to span engine changes, and an engine change is what adds a field to the
// report -- validating an archived report against today's producer contract
// fails on the fields that did not exist yet. The view keeps absence as absence:
// a counter the older run never recorded renders "unknown", never 0.
export const readEvalComparisonReport = async (
  repositoryRoot: string,
  reportPath: string
): Promise<EvalComparisonReport> =>
  parseEvalComparisonReport(await readEvalReportJson(repositoryRoot, reportPath))
