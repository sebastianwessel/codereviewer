import { z } from 'zod'
import { normalizeError } from '../../shared/errors/error-normalizer.js'
import {
  EVAL_SEMANTIC_JUDGE_STAGE,
  type EvalJudgeProviderIssue,
  type EvalSemanticJudge
} from './eval-matcher.js'

// Minimum judge agreement below which a run declares its own quality metrics
// untrustworthy. The judge is the sole semantic authority for every quality
// metric, so the bar is deliberately high: one disagreement in ten labeled
// pairs already means roughly one in ten scored findings may be wrong.
export const DEFAULT_MINIMUM_JUDGE_AGREEMENT = 0.9

export const EvalJudgeCalibrationPairSchema = z.strictObject({
  id: z.string().min(1),
  // `near-miss` pairs are the ones that actually discriminate a working judge
  // from a vocabulary matcher: high lexical overlap with an opposite label, or
  // low lexical overlap with a matching label.
  kind: z.enum(['clear-match', 'clear-non-match', 'near-miss']),
  expectedSummary: z.string().min(1),
  findingTitle: z.string().min(1),
  findingDescription: z.string().min(1),
  expectedMatch: z.boolean()
})

export type EvalJudgeCalibrationPair = z.infer<
  typeof EvalJudgeCalibrationPairSchema
>

// Human-labeled calibration pairs. Every entry is a review-summary pair a human
// can decide without seeing source code, which is exactly what the judge gets.
export const evalJudgeCalibrationSet: readonly EvalJudgeCalibrationPair[] =
  z.array(EvalJudgeCalibrationPairSchema).min(1).parse([
    {
      id: 'discount-percentage-as-absolute',
      kind: 'near-miss',
      expectedSummary: 'percentage discount subtracted as absolute amount',
      findingTitle: 'Percentage discount computed as absolute subtraction',
      findingDescription:
        'The discount percentage is subtracted from the order total as if it were a currency amount, so a 10 percent discount removes 10 units instead of a tenth of the total.',
      expectedMatch: true
    },
    {
      id: 'query-builder-injection-vs-null-check',
      kind: 'near-miss',
      expectedSummary: 'SQL injection in the user query builder',
      findingTitle: 'User query builder missing null check',
      findingDescription:
        'The user query builder dereferences the supplied filter object without checking whether it is null, which throws for callers that omit the filter.',
      expectedMatch: false
    },
    {
      id: 'loop-memory-exhaustion-vs-offset',
      kind: 'near-miss',
      expectedSummary: 'unbounded loop causes memory exhaustion',
      findingTitle: 'Loop causes incorrect memory offset',
      findingDescription:
        'The loop advances the buffer offset by the wrong stride, so each iteration reads from a memory location that does not belong to the current record.',
      expectedMatch: false
    },
    {
      id: 'retry-swallows-provider-error',
      kind: 'near-miss',
      expectedSummary:
        'retry loop swallows the provider error and returns an empty result',
      findingTitle: 'Provider failures are silently converted to empty responses',
      findingDescription:
        'The retry helper catches the provider error, leaves the loop, and hands callers an empty list, so a failed call is indistinguishable from a successful empty one.',
      expectedMatch: true
    },
    {
      id: 'timeout-scope-vs-config-key',
      kind: 'near-miss',
      expectedSummary:
        'timeout is applied to the whole request instead of to each attempt',
      findingTitle: 'Request timeout is read from the wrong configuration key',
      findingDescription:
        'The request timeout is read from the connection timeout key, so the configured request timeout value is ignored entirely.',
      expectedMatch: false
    },
    {
      id: 'webhook-signature-timing',
      kind: 'near-miss',
      expectedSummary:
        'webhook signature is compared with a non-constant-time equality',
      findingTitle: 'Signature comparison is vulnerable to timing attacks',
      findingDescription:
        'The webhook handler compares the computed HMAC with a plain equality operator instead of a constant-time comparison, which leaks the signature byte by byte.',
      expectedMatch: true
    },
    {
      id: 'admin-delete-authorization',
      kind: 'clear-match',
      expectedSummary:
        'authorization check missing on the admin delete endpoint',
      findingTitle: 'Admin delete endpoint does not verify permissions',
      findingDescription:
        'The delete handler runs without checking that the caller holds the admin role, so any authenticated user can delete records.',
      expectedMatch: true
    },
    {
      id: 'config-file-handle-leak',
      kind: 'clear-match',
      expectedSummary: 'file handle is never closed after reading the config',
      findingTitle: 'Config reader leaks the opened file descriptor',
      findingDescription:
        'The reader opens the configuration file and returns without closing the descriptor, so descriptors accumulate on every reload.',
      expectedMatch: true
    },
    {
      id: 'batch-off-by-one',
      kind: 'clear-match',
      expectedSummary: 'off-by-one skips the last element of the batch',
      findingTitle: 'Batch loop stops one element early',
      findingDescription:
        'The loop bound stops before the final index, so the last element of every batch is never processed.',
      expectedMatch: true
    },
    {
      id: 'cache-race-vs-ttl-constant',
      kind: 'clear-non-match',
      expectedSummary:
        'race condition when two workers update the same cache entry',
      findingTitle: 'Cache entry uses an outdated TTL constant',
      findingDescription:
        'The cache TTL constant was not updated after the configuration change, so entries stay valid far longer than intended.',
      expectedMatch: false
    },
    {
      id: 'orders-pagination-vs-currency',
      kind: 'clear-non-match',
      expectedSummary: 'missing pagination on the orders endpoint',
      findingTitle: 'Orders endpoint returns an incorrect currency code',
      findingDescription:
        'The orders endpoint reports the account default currency instead of the currency stored on the order.',
      expectedMatch: false
    },
    {
      id: 'password-logging-vs-logger-order',
      kind: 'clear-non-match',
      expectedSummary: 'password is written to the log in plain text',
      findingTitle: 'Logger is created before configuration is loaded',
      findingDescription:
        'The logger is constructed before the configuration is loaded, so the configured log level is ignored for the first messages.',
      expectedMatch: false
    }
  ])

export type EvalJudgeCalibrationResult = {
  // Fraction of scored calibration pairs whose judge decision matched the human
  // label. Omitted when no pair could be scored.
  readonly judgeAgreement?: number
  readonly judgeAgreementPairCount: number
  readonly judgeTrustworthy: boolean
  readonly judgeProviderIssues: readonly EvalJudgeProviderIssue[]
}

const AGREEMENT_PRECISION = 1_000_000

// Score the judge against the committed calibration set. A pair the judge could
// not decide is excluded from the denominator, exactly like an inconclusive
// match: a provider failure must not be reported as judge disagreement.
export const scoreJudgeCalibration = async (
  input: {
    readonly judge: EvalSemanticJudge
    readonly minimumAgreement?: number
    readonly pairs?: readonly EvalJudgeCalibrationPair[]
  }
): Promise<EvalJudgeCalibrationResult> => {
  const minimumAgreement =
    input.minimumAgreement ?? DEFAULT_MINIMUM_JUDGE_AGREEMENT
  const pairs = input.pairs ?? evalJudgeCalibrationSet
  const judgeProviderIssues: EvalJudgeProviderIssue[] = []
  let scoredPairCount = 0
  let agreementCount = 0

  for (const pair of pairs) {
    try {
      const judged = await input.judge({
        expectedSummary: pair.expectedSummary,
        findingTitle: pair.findingTitle,
        findingDescription: pair.findingDescription
      })
      scoredPairCount += 1
      if (judged.match === pair.expectedMatch) {
        agreementCount += 1
      }
    } catch (error) {
      const normalized = normalizeError(error, {
        source: 'provider',
        operation: 'eval_judge_calibration'
      })
      judgeProviderIssues.push({
        code: normalized.code,
        stage: EVAL_SEMANTIC_JUDGE_STAGE,
        recovered: false,
        message: normalized.message
      })
    }
  }

  if (scoredPairCount === 0) {
    // A judge exists but could not be measured at all. Nothing proves it is
    // reliable, so the run must not claim its metrics are trustworthy.
    return {
      judgeAgreementPairCount: 0,
      judgeTrustworthy: false,
      judgeProviderIssues
    }
  }

  const judgeAgreement =
    Math.round((agreementCount / scoredPairCount) * AGREEMENT_PRECISION) /
    AGREEMENT_PRECISION

  return {
    judgeAgreement,
    judgeAgreementPairCount: scoredPairCount,
    judgeTrustworthy: judgeAgreement >= minimumAgreement,
    judgeProviderIssues
  }
}
