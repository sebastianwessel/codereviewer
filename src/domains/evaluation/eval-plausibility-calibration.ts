import type { Logger } from '@purista/harness'
import { z } from 'zod'
import { normalizeError } from '../../shared/errors/error-normalizer.js'
import {
  EVAL_PLAUSIBILITY_JUDGE_STAGE,
  prepareEvalPlausibilitySource,
  type EvalPlausibilityJudge
} from './eval-plausibility-judge.js'

// Minimum plausibility-judge agreement below which a run marks its adjusted
// precision untrustworthy. It reuses the same default as the semantic-match
// judge: adjusted precision is only as trustworthy as the judge that produced it.
export const DEFAULT_MINIMUM_PLAUSIBILITY_AGREEMENT = 0.9

export const EvalPlausibilityCalibrationPairSchema = z.strictObject({
  id: z.string().min(1),
  // `hard` pairs are the ones that discriminate a working judge from one that
  // rubber-stamps every finding: a real defect described obliquely, or a
  // confident finding that actually misreads the shown code.
  kind: z.enum(['clear-genuine', 'clear-spurious', 'hard']),
  findingTitle: z.string().min(1),
  findingDescription: z.string().min(1),
  severity: z.string().min(1),
  category: z.string().min(1),
  path: z.string().min(1),
  line: z.int().min(1),
  // Sample new-side file content the judge reads to decide whether the finding
  // is genuinely present. Committed, non-secret, and human-decidable.
  code: z.string().min(1),
  isGenuine: z.boolean()
})

export type EvalPlausibilityCalibrationPair = z.infer<
  typeof EvalPlausibilityCalibrationPairSchema
>

// Human-labeled calibration pairs. Each entry is a finding plus the code it
// claims to describe, which is exactly what the plausibility judge receives.
export const evalPlausibilityCalibrationSet: readonly EvalPlausibilityCalibrationPair[] =
  z.array(EvalPlausibilityCalibrationPairSchema).min(1).parse([
    {
      id: 'missing-await-genuine',
      kind: 'clear-genuine',
      findingTitle: 'Promise is not awaited before the value is used',
      findingDescription:
        'saveUser returns a promise, but the code reads user.id on the returned promise without awaiting it, so id is always undefined.',
      severity: 'high',
      category: 'bug',
      path: 'src/user-service.ts',
      line: 3,
      code: [
        'export const registerUser = (input: UserInput) => {',
        '  const user = saveUser(input)',
        '  return { id: user.id, ok: true }',
        '}'
      ].join('\n'),
      isGenuine: true
    },
    {
      id: 'sql-injection-genuine',
      kind: 'clear-genuine',
      findingTitle: 'SQL query built by string concatenation of user input',
      findingDescription:
        'The user-supplied name is concatenated directly into the SQL string, allowing SQL injection.',
      severity: 'critical',
      category: 'security',
      path: 'src/repo.ts',
      line: 2,
      code: [
        'export const findByName = (name: string) => {',
        "  const query = \"SELECT * FROM users WHERE name = '\" + name + \"'\"",
        '  return db.execute(query)',
        '}'
      ].join('\n'),
      isGenuine: true
    },
    {
      id: 'off-by-one-genuine',
      kind: 'clear-genuine',
      findingTitle: 'Loop skips the last element of the array',
      findingDescription:
        'The loop condition uses < items.length - 1, so the final element is never processed.',
      severity: 'medium',
      category: 'bug',
      path: 'src/batch.ts',
      line: 2,
      code: [
        'export const total = (items: number[]) => {',
        '  let sum = 0',
        '  for (let i = 0; i < items.length - 1; i += 1) {',
        '    sum += items[i]',
        '  }',
        '  return sum',
        '}'
      ].join('\n'),
      isGenuine: true
    },
    {
      id: 'unclosed-resource-genuine',
      kind: 'clear-genuine',
      findingTitle: 'File handle is never closed',
      findingDescription:
        'openSync returns a descriptor that is read from but never closed, leaking a file descriptor on every call.',
      severity: 'medium',
      category: 'bug',
      path: 'src/config.ts',
      line: 2,
      code: [
        'export const readConfig = (path: string) => {',
        '  const fd = openSync(path, "r")',
        '  const text = readFileSync(fd, "utf8")',
        '  return JSON.parse(text)',
        '}'
      ].join('\n'),
      isGenuine: true
    },
    {
      id: 'missing-null-check-genuine',
      kind: 'clear-genuine',
      findingTitle: 'Missing guard dereferences a possibly-null result',
      findingDescription:
        'find can return undefined, but the code immediately reads .email off the result without a guard, throwing when no match exists.',
      severity: 'high',
      category: 'bug',
      path: 'src/lookup.ts',
      line: 3,
      code: [
        'export const emailFor = (id: string, users: User[]) => {',
        '  const match = users.find((user) => user.id === id)',
        '  return match.email.toLowerCase()',
        '}'
      ].join('\n'),
      isGenuine: true
    },
    {
      id: 'style-preference-spurious',
      kind: 'clear-spurious',
      findingTitle: 'Prefer arrow function over function declaration',
      findingDescription:
        'This helper is written as a function declaration; converting it to an arrow function would be more consistent with the rest of the file.',
      severity: 'low',
      category: 'style',
      path: 'src/util.ts',
      line: 1,
      code: [
        'export function clamp(value: number, min: number, max: number) {',
        '  return Math.min(max, Math.max(min, value))',
        '}'
      ].join('\n'),
      isGenuine: false
    },
    {
      id: 'misread-await-spurious',
      kind: 'clear-spurious',
      findingTitle: 'Promise is not awaited before its value is used',
      findingDescription:
        'loadUser returns a promise that is used without awaiting, so the id is undefined.',
      severity: 'high',
      category: 'bug',
      path: 'src/account.ts',
      line: 3,
      code: [
        'export const accountId = async (token: string) => {',
        '  const user = await loadUser(token)',
        '  return user.id',
        '}'
      ].join('\n'),
      isGenuine: false
    },
    {
      id: 'imagined-injection-spurious',
      kind: 'clear-spurious',
      findingTitle: 'SQL injection via unparameterized query',
      findingDescription:
        'The user name is used to build a SQL query and is not parameterized, allowing SQL injection.',
      severity: 'critical',
      category: 'security',
      path: 'src/users.ts',
      line: 2,
      code: [
        'export const findByName = (name: string) => {',
        '  return db.query("SELECT * FROM users WHERE name = $1", [name])',
        '}'
      ].join('\n'),
      isGenuine: false
    },
    {
      id: 'unreachable-catch-hard-genuine',
      kind: 'hard',
      findingTitle: 'Error is swallowed and an empty array is returned',
      findingDescription:
        'The catch block returns an empty array, so a provider failure is indistinguishable from a successful empty result.',
      severity: 'medium',
      category: 'bug',
      path: 'src/list.ts',
      line: 4,
      code: [
        'export const listItems = async () => {',
        '  try {',
        '    return await provider.fetchAll()',
        '  } catch {',
        '    return []',
        '  }',
        '}'
      ].join('\n'),
      isGenuine: true
    },
    {
      id: 'constant-time-hard-spurious',
      kind: 'hard',
      findingTitle: 'Non-constant-time comparison of secrets leaks timing',
      findingDescription:
        'The HMAC is compared with a plain equality operator, which leaks the signature byte by byte through timing.',
      severity: 'high',
      category: 'security',
      path: 'src/webhook.ts',
      line: 3,
      code: [
        'import { timingSafeEqual } from "node:crypto"',
        'export const verify = (a: Buffer, b: Buffer) => {',
        '  return a.length === b.length && timingSafeEqual(a, b)',
        '}'
      ].join('\n'),
      isGenuine: false
    },
    {
      id: 'race-condition-hard-genuine',
      kind: 'hard',
      findingTitle: 'Check-then-act race on the cache map',
      findingDescription:
        'Between the has() check and the set(), a concurrent caller can insert the same key, so the expensive build runs twice and one result is discarded.',
      severity: 'medium',
      category: 'bug',
      path: 'src/cache.ts',
      line: 3,
      code: [
        'export const getOrBuild = async (key: string) => {',
        '  if (!cache.has(key)) {',
        '    cache.set(key, await build(key))',
        '  }',
        '  return cache.get(key)',
        '}'
      ].join('\n'),
      isGenuine: true
    }
  ])

export type EvalPlausibilityCalibrationResult = {
  // Fraction of scored calibration pairs whose judge decision matched the human
  // label. Omitted when no pair could be scored.
  readonly plausibilityJudgeAgreement?: number
  readonly plausibilityJudgeAgreementPairCount: number
  readonly plausibilityJudgeTrustworthy: boolean
}

const AGREEMENT_PRECISION = 1_000_000

// Score the plausibility judge against the committed calibration set. A pair the
// judge could not decide leaves the denominator, exactly like the semantic-match
// calibration: a provider failure must not be reported as judge disagreement.
// The failure is surfaced two ways: the reported pair count drops below the
// committed pair count (and trustworthiness goes false when nothing scored), and
// the normalized error code is logged as a no-content warning.
export const scorePlausibilityCalibration = async (
  input: {
    readonly judge: EvalPlausibilityJudge
    readonly minimumAgreement?: number
    readonly pairs?: readonly EvalPlausibilityCalibrationPair[]
    readonly logger?: Logger | undefined
  }
): Promise<EvalPlausibilityCalibrationResult> => {
  const minimumAgreement =
    input.minimumAgreement ?? DEFAULT_MINIMUM_PLAUSIBILITY_AGREEMENT
  const pairs = input.pairs ?? evalPlausibilityCalibrationSet
  let scoredPairCount = 0
  let agreementCount = 0

  for (const pair of pairs) {
    try {
      const judged = await input.judge({
        findingTitle: pair.findingTitle,
        findingDescription: pair.findingDescription,
        severity: pair.severity,
        category: pair.category,
        path: pair.path,
        line: pair.line,
        fileContent: prepareEvalPlausibilitySource({
          content: pair.code,
          line: pair.line
        }).text
      })
      scoredPairCount += 1
      if (judged.plausible === pair.isGenuine) {
        agreementCount += 1
      }
    } catch (error) {
      const normalized = normalizeError(error, {
        source: 'provider',
        operation: 'eval_plausibility_calibration'
      })
      // No-content: the pair id and the error code only. Never the pair text.
      input.logger?.warn?.(
        'Plausibility calibration pair could not be scored; it leaves the agreement denominator.',
        {
          pair_id: pair.id,
          stage: EVAL_PLAUSIBILITY_JUDGE_STAGE,
          error_code: normalized.code
        }
      )
    }
  }

  if (scoredPairCount === 0) {
    // A judge exists but could not be measured at all. Nothing proves it is
    // reliable, so the run must not claim its adjusted precision is trustworthy.
    return {
      plausibilityJudgeAgreementPairCount: 0,
      plausibilityJudgeTrustworthy: false
    }
  }

  const plausibilityJudgeAgreement =
    Math.round((agreementCount / scoredPairCount) * AGREEMENT_PRECISION) /
    AGREEMENT_PRECISION

  return {
    plausibilityJudgeAgreement,
    plausibilityJudgeAgreementPairCount: scoredPairCount,
    plausibilityJudgeTrustworthy: plausibilityJudgeAgreement >= minimumAgreement
  }
}
