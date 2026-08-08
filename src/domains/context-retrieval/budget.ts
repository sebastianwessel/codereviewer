import { z } from 'zod'

export const ContextRetrievalBudgetSchema = z.strictObject({
  maxReads: z.int().min(0).default(4),
  usedReads: z.int().min(0).default(0),
  maxSearches: z.int().min(0).default(2),
  usedSearches: z.int().min(0).default(0),
  // A RUNAWAY GUARD against materialising a pathological file, NOT a context
  // ration (spec 28). Sized against memory, far beyond any plausible source file.
  // The previous value was chosen defensively, cut files mid-read, and caused three
  // measurements to record cross-file retrieval as harmful when they were measuring
  // the cap. The reviewer narrows a read by LINE RANGE instead; when a real limit
  // binds, the provider says so and the read budget is reduced on retry.
  maxBytesPerRead: z.int().min(1).default(4_000_000),
  maxMatches: z.int().min(1).default(20),
  // Caps how many directory levels a recursive `grep` traversal descends from
  // each requested search root. Depth 0 is the requested root directory
  // itself, so a directory whose depth exceeds this value is not descended
  // into. Bounds traversal cost independently of `maxMatches`, which only
  // bounds match count once a (potentially huge) directory is being scanned.
  maxDepth: z.int().min(0).default(6)
})

export type ContextRetrievalBudget = z.infer<typeof ContextRetrievalBudgetSchema>
