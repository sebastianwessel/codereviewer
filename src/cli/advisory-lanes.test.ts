import { describe, expect, test } from 'vitest'
import { runAdvisoryStagesForReview } from './advisory-lanes.js'
import { createRunContext } from '../domains/run-context/index.js'
import { CodeReviewerConfigSchema } from '../shared/contracts/index.js'
import type { Logger } from '../domains/observability/index.js'

const silentLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
} as unknown as Logger

const inputFor = (
  configOverrides: Record<string, unknown>,
  runGit: (args: readonly string[]) => Promise<string>
) => ({
  options: { cwd: '/repo' } as never,
  runContext: createRunContext({
    repositoryRoot: '/repo',
    config: CodeReviewerConfigSchema.parse(configOverrides),
    runGit: async (args) => await runGit(args),
    readChangedFile: async () => undefined
  }),
  environment: {},
  baseRef: 'main',
  headRef: 'HEAD',
  logger: silentLogger
})

describe('runAdvisoryStagesForReview', () => {
  // The flags are the operator's statement about which questions to ask. Being
  // invoked from `review` rather than from its own command must not turn a stage
  // on, and a stage that is off must not touch the repository at all.
  //
  // Both stages are ON by default since 2026-08-11, so the opt-out is now written
  // out. That makes this test sharper rather than weaker: what it pins is that an
  // operator who says `false` gets NO git subprocess, which is the guarantee the
  // in-process move could plausibly have broken.
  test('a disabled stage runs nothing and reaches no git', async () => {
    let gitCalls = 0
    const results = await runAdvisoryStagesForReview(
      inputFor(
        {
          changeImpact: { enabled: false },
          intentFulfilment: { enabled: false }
        },
        async () => {
          gitCalls += 1

          return ''
        }
      )
    )

    expect(results.impact).toBeUndefined()
    expect(results.intent).toBeUndefined()
    expect(results.warnings).toEqual([])
    expect(gitCalls).toBe(0)
  })

  // Specs 22 and 23 make non-blocking a REQUIREMENT. Running beside a stage that
  // can fail the command is exactly where that guarantee would be lost, so the
  // failure has to surface as a warning on the review the reader already has.
  test('a stage that throws yields a warning, not a thrown review', async () => {
    const results = await runAdvisoryStagesForReview(
      inputFor(
        {
          changeImpact: { enabled: true },
          // Off so exactly ONE stage can produce a warning and the assertion below
          // names the stage that failed rather than counting whatever ran.
          intentFulfilment: { enabled: false }
        },
        async () => {
          throw new Error('git exploded')
        }
      )
    )

    expect(results.impact).toBeUndefined()
    expect(results.warnings).toHaveLength(1)
    expect(results.warnings[0]).toContain('change-impact')
    expect(results.warnings[0]).toContain('produced no report')
  })

  // A scratch directory and a shallow CI clone both land here, and BOTH stages
  // land here at once — so on a default run this is the text a reader sees twice.
  // It must not read as a malfunction, and it must still be said: the reader
  // expected an impact report and is owed the reason there is none.
  test('an unresolvable merge base reads as no change set, not as a failure', async () => {
    const results = await runAdvisoryStagesForReview(
      inputFor(
        { changeImpact: { enabled: true }, intentFulfilment: { enabled: true } },
        // What git prints in a repository whose refs share no history: exit 0,
        // no commit id. Intake turns that into `merge_base_unavailable`.
        async () => ''
      )
    )

    expect(results.impact).toBeUndefined()
    expect(results.intent).toBeUndefined()
    expect(results.warnings).toHaveLength(2)

    for (const warning of results.warnings) {
      expect(warning).toContain('no change set to compare')
      expect(warning).toContain('merge base')
      // The failure vocabulary belongs to the other path, and so does intake's
      // "fetch enough history and retry" remediation, which is advice for a
      // command that stopped — this one did not.
      expect(warning).not.toContain('could not complete')
      expect(warning).not.toContain('retry')
    }
  })

  // The OTHER ordinary code, and the one the merge-base test does not reach.
  // Removing `no_reviewable_change` from the ordinary set broke no test until this
  // one existed, so the widening past merge-base was unpinned: a refactor could
  // have dropped it back into failure wording silently.
  //
  // Reaching it needs a merge base that RESOLVES and a diff that is empty — the
  // refs the wrong way round, or a head already contained in the base — which is
  // exactly the shape a person hits on a re-run of an already-merged branch.
  test('an empty diff over a resolvable merge base also reads as no change set', async () => {
    const results = await runAdvisoryStagesForReview(
      inputFor(
        { changeImpact: { enabled: true }, intentFulfilment: { enabled: true } },
        async (args) =>
          args.includes('merge-base') ? 'a'.repeat(40) : ''
      )
    )

    expect(results.warnings).toHaveLength(2)

    for (const warning of results.warnings) {
      expect(warning).toContain('no change set to compare')
      expect(warning).toContain('differ by no files')
      expect(warning).not.toContain('could not complete')
      // Intake's own remediation is advice for a command that STOPPED. This one
      // carried on and produced a review; repeating it would misdescribe the run.
      expect(warning).not.toContain('Refused rather than reported')
    }
  })

  // The narrowness is the point: `repository` also covers timeouts and unknown
  // refs, and softening those would hide a real fault behind an ordinary phrase.
  test('a repository failure that is not an empty change set keeps failure wording', async () => {
    const results = await runAdvisoryStagesForReview(
      inputFor(
        { changeImpact: { enabled: true }, intentFulfilment: { enabled: false } },
        async () => {
          throw new Error('git process timed out')
        }
      )
    )

    expect(results.warnings).toHaveLength(1)
    expect(results.warnings[0]).toContain('could not complete')
    expect(results.warnings[0]).not.toContain('no change set to compare')
  })

  // One failing stage must not take the other down with it.
  test('the second stage still runs after the first one fails', async () => {
    let gitCalls = 0
    const results = await runAdvisoryStagesForReview(
      inputFor(
        { changeImpact: { enabled: true }, intentFulfilment: { enabled: true } },
        async () => {
          gitCalls += 1

          throw new Error('git exploded')
        }
      )
    )

    expect(results.warnings).toHaveLength(2)
    expect(results.warnings[0]).toContain('change-impact')
    expect(results.warnings[1]).toContain('intent-fulfilment')
    // Both stages reached git independently: the memo does not replay a failure.
    expect(gitCalls).toBeGreaterThanOrEqual(2)
  })
})
