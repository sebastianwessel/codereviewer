import type { RunSummary } from '../../shared/contracts/index.js'

export const renderRunSummaryJson = (summary: RunSummary): string =>
  `${JSON.stringify(summary, null, 2)}\n`

