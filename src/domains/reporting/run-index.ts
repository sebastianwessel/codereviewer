import { z } from 'zod'

export const RunIndexEntrySchema = z.strictObject({
  runId: z.string().min(1),
  startedAt: z.string().min(1),
  completedAt: z.string().min(1).optional(),
  status: z.enum(['completed', 'failed']),
  reportPath: z.string().min(1).optional()
})

export const RunIndexSchema = z.strictObject({
  runs: z.array(RunIndexEntrySchema)
})

export type RunIndexEntry = z.infer<typeof RunIndexEntrySchema>
export type RunIndex = z.infer<typeof RunIndexSchema>

export const runIndexFileName = 'index.json'
export const maxRunIndexEntries = 50

export const emptyRunIndex: RunIndex = { runs: [] }

/**
 * Parses an existing index, falling back to an empty one when the file is
 * missing or unreadable. Artifact bookkeeping must never fail a review that
 * otherwise succeeded, so a corrupt index is replaced rather than surfaced.
 */
export const parseRunIndex = (content: string | undefined): RunIndex => {
  if (content === undefined) {
    return emptyRunIndex
  }

  try {
    const parsed = RunIndexSchema.safeParse(JSON.parse(content))

    return parsed.success ? parsed.data : emptyRunIndex
  } catch {
    return emptyRunIndex
  }
}

/**
 * Places an entry at the head of the index, replacing any earlier entry for the
 * same run, and drops the oldest entries beyond the cap. Dropping only trims
 * the index; the run directories themselves are left on disk.
 */
export const upsertRunIndexEntry = (
  index: RunIndex,
  entry: RunIndexEntry
): RunIndex => ({
  runs: [
    entry,
    ...index.runs.filter((existing) => existing.runId !== entry.runId)
  ].slice(0, maxRunIndexEntries)
})

export const latestRunWithReport = (
  index: RunIndex
): RunIndexEntry | undefined =>
  index.runs.find((entry) => entry.reportPath !== undefined)

export const renderRunIndexJson = (index: RunIndex): string =>
  `${JSON.stringify(RunIndexSchema.parse(index), undefined, 2)}\n`
