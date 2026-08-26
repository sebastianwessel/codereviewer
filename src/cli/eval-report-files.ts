// Reading an eval report back off disk. Two readers rather than one because the
// two commands that read reports ask different questions of them, and the
// contract each validates against is the difference.
import { readFile } from 'node:fs/promises'
import {
  parseEvalComparisonReport,
  parseEvalRecallView,
  type EvalComparisonReport,
  type EvalRecallView
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

// Recall analysis reads through its own tolerant view, for the reason comparison
// does. It USED to validate against the producer contract, on the argument that a
// report failing it "was not written by a compatible build" -- which is true and
// beside the point: recall is computed from four fields that have never changed,
// and holding an archive to today's whole contract made a hundred finished runs
// unreadable the day the case result gained a field. Absence of the four fields it
// does need is still a hard failure.
export const readEvalRecallView = async (
  repositoryRoot: string,
  reportPath: string
): Promise<EvalRecallView> =>
  parseEvalRecallView(await readEvalReportJson(repositoryRoot, reportPath))

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
