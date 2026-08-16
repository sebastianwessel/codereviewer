import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  REVIEW_COMMENT_PLATFORM,
  runPipeline,
  type PipelineDependencies
} from './pipeline.js'
import type { PullRequestContext } from './pull-request-context.js'
import type { GithubApi } from './github-api.js'
import type { StageResult } from './stage-outcomes.js'
import { summaryCommentMarker } from './summary-comment.js'
import { findingCommentMarker } from './inline-review.js'
import {
  impactReportFixture,
  intentReportFixture,
  renderedGithubCommentsFixture,
  reviewReportFixture
} from './fixtures.js'

const context: PullRequestContext = {
  owner: 'acme',
  repo: 'widget',
  number: 42,
  title: 'Add a session guard',
  body: 'The admin route was reachable without a session.',
  url: 'https://github.com/acme/widget/pull/42',
  headSha: 'a'.repeat(40),
  headRef: 'feat/guard',
  baseRef: 'main',
  draft: false,
  fromFork: false
}

const configuredEnvironment = {
  CODEREVIEWER_PROVIDER_ID: 'openai',
  CODEREVIEWER_PROVIDER_MODEL: 'a-model',
  OPENAI_API_KEY: 'not-a-real-key'
}

const ARTIFACT_DIR = '.codereviewer/runs/run_abc123'

type ApiCalls = {
  readonly created: string[]
  readonly updated: { id: number; body: string }[]
  readonly reviews: { commitId: string; count: number }[]
}

const createFakeApi = (
  overrides: Partial<GithubApi> & {
    existingComments?: readonly { id: number; body: string; user: { login: string; type: string } }[]
    // `id` is optional here and defaulted below: most tests only care about the
    // body a marker is parsed out of, and only the review-conversation tests
    // need a specific id to match a reply's `in_reply_to_id` against.
    existingReviewComments?: readonly { id?: number; body: string }[]
  } = {}
): { api: GithubApi; calls: ApiCalls } => {
  const calls: ApiCalls = { created: [], updated: [], reviews: [] }
  const api: GithubApi = {
    listIssueComments: async () => overrides.existingComments ?? [],
    createIssueComment: async (_pullNumber, body) => {
      calls.created.push(body)
    },
    updateIssueComment: async (id, body) => {
      calls.updated.push({ id, body })
    },
    listReviewComments: async () =>
      (overrides.existingReviewComments ?? []).map((comment, index) => ({
        id: comment.id ?? index + 1,
        body: comment.body
      })),
    createReview: async ({ commitId, comments }) => {
      calls.reviews.push({ commitId, count: comments.length })
    },
    ...overrides
  }

  return { api, calls }
}

const defaultReviewStageResult: StageResult = {
  exitCode: 0,
  stdout: JSON.stringify({
    runId: 'run_abc123',
    qualityGatePassed: true,
    artifactDir: ARTIFACT_DIR
  }),
  stderr: ''
}

const createDependencies = (
  overrides: Partial<PipelineDependencies> = {},
  reviewResult: StageResult = defaultReviewStageResult
): {
  dependencies: PipelineDependencies
  written: { fileName: string; content: string }[]
  stageArgs: string[][]
} => {
  const written: { fileName: string; content: string }[] = []
  const stageArgs: string[][] = []
  const dependencies: PipelineDependencies = {
    context,
    environment: configuredEnvironment,
    options: {
      markerKey: 'default',
      configPath: 'scripts/github/codereviewer.github.json',
      maxInlineComments: 25,
      commentAuthorLogin: 'github-actions[bot]'
    },
    runStage: async (args) => {
      stageArgs.push([...args])
      return reviewResult
    },
    readArtifact: async (artifactPath) => {
      if (artifactPath === `${ARTIFACT_DIR}/report.json`) {
        return JSON.stringify(reviewReportFixture)
      }

      if (artifactPath === `${ARTIFACT_DIR}/review-comments.github.json`) {
        return JSON.stringify(renderedGithubCommentsFixture)
      }

      // impact-report.json and intent-report.json are absent by default: the
      // ordinary case, matching both advisory lanes disabled. Tests that care
      // about a present report override `readArtifact` directly.
      return undefined
    },
    writeChangeIntent: async (fileName, content) => {
      written.push({ fileName, content })
    },
    log: () => {},
    ...overrides
  }

  return { dependencies, written, stageArgs }
}

describe('runPipeline: the ordinary path', () => {
  it('feeds the pull-request description in as change intent before reviewing', async () => {
    const { api } = createFakeApi()
    const { dependencies, written } = createDependencies({ api })

    await runPipeline(dependencies)

    expect(written).toHaveLength(1)
    expect(written[0]?.fileName).toBe('pull-request.md')
    expect(written[0]?.content).toContain(
      'The admin route was reachable without a session.'
    )
  })

  // The workflow used to spawn three subprocesses per push — one for `review`,
  // one each for the two advisory lanes. `review` now runs both lanes itself,
  // in-process (`src/cli/advisory-lanes.ts`), so a push must cost exactly one.
  it('spawns exactly one stage process per push, against the pull request’s base branch', async () => {
    const { api } = createFakeApi()
    const { dependencies, stageArgs } = createDependencies({ api })

    await runPipeline(dependencies)

    expect(stageArgs).toHaveLength(1)
    expect(stageArgs[0]?.slice(0, 2)).toEqual(['review', '--base-ref'])
    expect(stageArgs[0]).toContain('origin/main')
    expect(stageArgs[0]).toContain('--config')
  })

  // The review command's stdout reports the run's own artifact directory; the
  // impact and intent reports, when their lanes ran, land beside `report.json`
  // inside it rather than in a directory of their own.
  it('reads the impact and intent reports from the review run’s own artifact directory when present', async () => {
    const { api, calls } = createFakeApi()
    const { dependencies } = createDependencies({
      api,
      readArtifact: async (artifactPath) => {
        if (artifactPath === `${ARTIFACT_DIR}/report.json`) {
          return JSON.stringify(reviewReportFixture)
        }
        if (artifactPath === `${ARTIFACT_DIR}/review-comments.github.json`) {
          return JSON.stringify(renderedGithubCommentsFixture)
        }
        if (artifactPath === `${ARTIFACT_DIR}/impact-report.json`) {
          return JSON.stringify(impactReportFixture)
        }
        if (artifactPath === `${ARTIFACT_DIR}/intent-report.json`) {
          return JSON.stringify(intentReportFixture)
        }

        return undefined
      }
    })

    await runPipeline(dependencies)
    const body = [...calls.created, ...calls.updated.map((entry) => entry.body)].join('\n')

    expect(body).toContain('### Intent')
    expect(body).toContain('### Impact')
    expect(body).toContain('requireSession')
  })

  // The normal case: a lane that was never enabled writes no report file at
  // all, and the comment must read exactly like a stage that produced
  // nothing — no error, no "missing" note, just an absent section.
  it('renders cleanly when the impact and intent reports are absent, the ordinary case for a disabled lane', async () => {
    const { api, calls } = createFakeApi()
    const { dependencies } = createDependencies({ api })

    const result = await runPipeline(dependencies)
    const body = [...calls.created, ...calls.updated.map((entry) => entry.body)].join('\n')

    expect(result.exitCode).toBe(0)
    expect(body).not.toContain('### Intent')
    expect(body).not.toContain('### Impact')
  })

  it('creates the summary comment on the first run', async () => {
    const { api, calls } = createFakeApi()
    const { dependencies } = createDependencies({ api })
    const result = await runPipeline(dependencies)

    expect(calls.created).toHaveLength(1)
    expect(calls.updated).toHaveLength(0)
    expect(calls.created[0]).toContain(summaryCommentMarker('default'))
    expect(result.posted).toBe(true)
  })

  it('edits the same comment on a later push instead of adding another', async () => {
    const { api, calls } = createFakeApi({
      existingComments: [
        {
          id: 77,
          body: `${summaryCommentMarker('default')}\n## an earlier run`,
          user: { login: 'github-actions[bot]', type: 'Bot' }
        }
      ]
    })
    const { dependencies } = createDependencies({ api })

    await runPipeline(dependencies)

    expect(calls.created).toHaveLength(0)
    expect(calls.updated).toEqual([
      { id: 77, body: expect.stringContaining(summaryCommentMarker('default')) }
    ])
  })

  it('posts inline comments anchored on the head commit', async () => {
    const { api, calls } = createFakeApi()
    const { dependencies } = createDependencies({ api })
    const result = await runPipeline(dependencies)

    expect(calls.reviews).toEqual([{ commitId: context.headSha, count: 1 }])
    expect(result.inlineCommentCount).toBe(1)
  })

  it('does not repeat an inline comment already on the pull request', async () => {
    const { api, calls } = createFakeApi({
      existingReviewComments: [{ body: 'earlier\n\n<!-- codereviewer:finding:fp1 -->' }]
    })
    const { dependencies } = createDependencies({ api })
    const result = await runPipeline(dependencies)

    expect(calls.reviews).toHaveLength(0)
    expect(result.inlineCommentCount).toBe(0)
  })

  // The case this feature exists for: an earlier push was commented on, the author
  // fixed it, and this run has nothing to say. The comparison must still happen.
  it('reports a finding an earlier push carried that this run did not', async () => {
    const { api, calls } = createFakeApi({
      existingReviewComments: [
        { body: 'from an earlier push\n\n<!-- codereviewer:finding:gone-now -->' }
      ]
    })
    const { dependencies } = createDependencies({ api })

    await runPipeline(dependencies)

    const body = [...calls.created, ...calls.updated.map((entry) => entry.body)].join('\n')

    expect(body).toContain('No longer reported (1)')
    // Never presented as a repair — this cannot tell a fix from a miss.
    expect(body).toContain('not the same as fixed')
  })

  it('says nothing when every earlier finding is still reported', async () => {
    const { api, calls } = createFakeApi({
      existingReviewComments: [
        { body: 'from an earlier push\n\n<!-- codereviewer:finding:fp1 -->' }
      ]
    })
    const { dependencies } = createDependencies({ api })

    await runPipeline(dependencies)

    const body = [...calls.created, ...calls.updated.map((entry) => entry.body)].join('\n')

    expect(body).not.toContain('No longer reported')
  })

  it('exits 0 when the review passed', async () => {
    const { api } = createFakeApi()
    const { dependencies } = createDependencies({ api })

    expect((await runPipeline(dependencies)).exitCode).toBe(0)
  })
})

// Spec 30: a reply on a review comment nominates the finding that comment
// carries for re-adjudication. The re-run is the SAME `review` pipeline above,
// unchanged — these tests cover only what spec 30 adds: reading the nomination
// off the parent comment, reporting each outcome, and never letting the run
// block.
describe('runPipeline: review conversation (spec 30)', () => {
  it('reports a nominated finding that still reports as held', async () => {
    const { api, calls } = createFakeApi({
      existingReviewComments: [
        { id: 500, body: `earlier\n\n${findingCommentMarker('fp1')}` }
      ]
    })
    const { dependencies, stageArgs } = createDependencies({
      api,
      reviewConversation: { parentCommentId: 500 }
    })

    const result = await runPipeline(dependencies)
    const body = [...calls.created, ...calls.updated.map((entry) => entry.body)].join('\n')

    // The same one review stage runs — byte-identical to the push-triggered
    // path, which is what makes the re-adjudication trustworthy in the first
    // place.
    expect(stageArgs.map((args) => args[0])).toEqual(['review'])
    expect(body).toContain('Review conversation (1)')
    expect(body).toContain('fp1')
    expect(body).toContain('held')
    expect(body).toContain('Re-checked against the same evidence; it still holds.')
    expect(result.exitCode).toBe(0)
  })

  it('reports a nominated finding that did not come back, never as fixed or withdrawn', async () => {
    const { api, calls } = createFakeApi({
      existingReviewComments: [
        { id: 500, body: `earlier\n\n${findingCommentMarker('gone-now')}` }
      ]
    })
    const { dependencies } = createDependencies({
      api,
      reviewConversation: { parentCommentId: 500 }
    })

    const result = await runPipeline(dependencies)
    const body = [...calls.created, ...calls.updated.map((entry) => entry.body)].join('\n')

    expect(body).toContain('Review conversation (1)')
    expect(body).toContain('no longer reported')
    expect(body).toContain('not the same as fixed')
    expect(body).not.toMatch(/withdrawn|resolved|fixed\./iu)
    expect(result.exitCode).toBe(0)
  })

  it('does nothing when the reply targets a comment with no finding marker', async () => {
    const { api, calls } = createFakeApi({
      existingReviewComments: [{ id: 500, body: 'just a reply, no marker here' }]
    })
    const { dependencies, stageArgs } = createDependencies({
      api,
      reviewConversation: { parentCommentId: 500 }
    })

    const result = await runPipeline(dependencies)

    expect(stageArgs).toHaveLength(0)
    expect(calls.created).toHaveLength(0)
    expect(calls.updated).toHaveLength(0)
    expect(result.posted).toBe(false)
    expect(result.exitCode).toBe(0)
  })

  it('does nothing when the reply targets a comment id this run cannot find', async () => {
    const { api, calls } = createFakeApi({ existingReviewComments: [] })
    const { dependencies, stageArgs } = createDependencies({
      api,
      reviewConversation: { parentCommentId: 999 }
    })

    await runPipeline(dependencies)

    expect(stageArgs).toHaveLength(0)
    expect(calls.created).toHaveLength(0)
  })

  it('does nothing when this run has no access to look up the reply', async () => {
    // No `api` override: `dependencies.api` stays undefined, as it does for a
    // token-less run or a fork pull request.
    const { dependencies, stageArgs } = createDependencies({
      reviewConversation: { parentCommentId: 500 }
    })

    const result = await runPipeline(dependencies)

    expect(stageArgs).toHaveLength(0)
    expect(result.posted).toBe(false)
    expect(result.exitCode).toBe(0)
  })

  // The hard constraint: a re-adjudication cannot fail a gate the original
  // finding did not. Same failing-gate stage result as the ordinary-path test
  // above, which exits 1 — the only difference here is `reviewConversation`.
  it('never fails the job, even when the quality gate fails', async () => {
    const { api } = createFakeApi({
      existingReviewComments: [
        { id: 500, body: `earlier\n\n${findingCommentMarker('fp1')}` }
      ]
    })
    const { dependencies } = createDependencies(
      { api, reviewConversation: { parentCommentId: 500 } },
      {
        exitCode: 1,
        stdout: JSON.stringify({
          runId: 'run_abc123',
          qualityGatePassed: false,
          artifactDir: ARTIFACT_DIR
        }),
        stderr: ''
      }
    )

    expect((await runPipeline(dependencies)).exitCode).toBe(0)
  })

  it('never fails the job when no provider is configured either', async () => {
    const { api } = createFakeApi({
      existingReviewComments: [
        { id: 500, body: `earlier\n\n${findingCommentMarker('fp1')}` }
      ]
    })
    const { dependencies } = createDependencies({
      api,
      reviewConversation: { parentCommentId: 500 },
      environment: {}
    })

    expect((await runPipeline(dependencies)).exitCode).toBe(0)
  })
})

describe('runPipeline: failure modes', () => {
  it('skips a fork pull request with a clear message and no API call', async () => {
    const { api, calls } = createFakeApi()
    const { dependencies, written } = createDependencies({
      api,
      context: { ...context, fromFork: true }
    })
    const result = await runPipeline(dependencies)

    expect(result.exitCode).toBe(0)
    expect(result.posted).toBe(false)
    expect(calls.created).toHaveLength(0)
    expect(calls.reviews).toHaveLength(0)
    expect(written).toHaveLength(0)
    expect(result.commentBody).toContain('comes from a fork')
  })

  it('fails the job when no provider is configured, instead of passing empty', async () => {
    const { api, calls } = createFakeApi()
    const { dependencies, stageArgs } = createDependencies({
      api,
      environment: {}
    })
    const result = await runPipeline(dependencies)

    expect(result.exitCode).toBe(2)
    expect(stageArgs).toHaveLength(0)
    expect(calls.created[0]).toContain('CODEREVIEWER_PROVIDER_ID')
    expect(calls.created[0]).toContain('no usable model provider')
  })

  it('never writes a secret value into the comment', async () => {
    const { api, calls } = createFakeApi()
    const { dependencies } = createDependencies({
      api,
      environment: {
        CODEREVIEWER_PROVIDER_ID: 'openai',
        CODEREVIEWER_PROVIDER_MODEL: 'a-model'
      }
    })

    await runPipeline(dependencies)

    expect(calls.created[0]).not.toContain('not-a-real-key')
  })

  it('fails the job and explains itself when the provider errored', async () => {
    const { api, calls } = createFakeApi()
    const { dependencies } = createDependencies(
      { api },
      {
        exitCode: 4,
        stdout: '',
        stderr: '{"code":"provider_error","message":"429 rate limit"}'
      }
    )
    const result = await runPipeline(dependencies)

    expect(result.exitCode).toBe(1)
    expect(calls.created[0]).toContain('could not complete')
    expect(calls.created[0]).toContain('429 rate limit')
  })

  it('fails the job when the quality gate failed', async () => {
    const { api, calls } = createFakeApi()
    const { dependencies } = createDependencies(
      { api },
      {
        exitCode: 1,
        stdout: JSON.stringify({
          runId: 'run_abc123',
          qualityGatePassed: false,
          artifactDir: ARTIFACT_DIR
        }),
        stderr: ''
      }
    )
    const result = await runPipeline(dependencies)

    expect(result.exitCode).toBe(1)
    expect(calls.created[0]).toContain('quality gate failed')
  })

  it('still summarizes the report of a run that failed after writing it', async () => {
    const { api, calls } = createFakeApi()
    const { dependencies } = createDependencies(
      { api },
      {
        exitCode: 5,
        stdout: '',
        stderr: `{"code":"reporting_error","message":"render failed","artifactDir":"${ARTIFACT_DIR}"}`
      }
    )
    const result = await runPipeline(dependencies)

    expect(result.exitCode).toBe(1)
    expect(calls.created[0]).toContain('Session check removed from the admin route')
  })

  // An advisory lane that fails does not get its own exit code any more — it
  // never had its own process to fail with. `src/cli/advisory-lanes.ts` catches
  // the throw and leaves a warning on `report.json`'s `run.warnings` instead
  // (see `guardAdvisoryStage`), which is what this asserts arrives on the
  // comment: the job still passes, and the failure is still visible.
  it('keeps the job green and surfaces an advisory-lane failure as a warning from the review report', async () => {
    const { api, calls } = createFakeApi()
    const reportWithAdvisoryFailure = {
      ...reviewReportFixture,
      run: {
        ...reviewReportFixture.run,
        warnings: [
          ...reviewReportFixture.run.warnings,
          'The intent-fulfilment stage could not complete and produced no report for this run: no merge base'
        ]
      }
    }
    const { dependencies } = createDependencies({
      api,
      readArtifact: async (artifactPath) =>
        artifactPath === `${ARTIFACT_DIR}/report.json`
          ? JSON.stringify(reportWithAdvisoryFailure)
          : undefined
    })
    const result = await runPipeline(dependencies)

    expect(result.exitCode).toBe(0)
    expect(calls.created[0]).toContain('no merge base')
  })

  it('falls back to the summary comment when inline comments are rejected', async () => {
    const { api, calls } = createFakeApi({
      createReview: async () => {
        throw new Error('422 line must be part of the diff')
      }
    })
    const { dependencies } = createDependencies({ api })
    const result = await runPipeline(dependencies)

    expect(result.exitCode).toBe(0)
    expect(result.inlineCommentCount).toBe(0)
    expect(calls.created[0]).toContain('Inline comments could not be posted')
    expect(calls.created[0]).toContain('Session check removed from the admin route')
  })

  it('still produces a body when there is no token to post with', async () => {
    const { dependencies } = createDependencies()
    const result = await runPipeline(dependencies)

    expect(result.posted).toBe(false)
    expect(result.commentBody).toContain('Session check removed')
  })

  it('notes an empty pull-request description rather than inventing intent', async () => {
    const { api } = createFakeApi()
    const { dependencies, written } = createDependencies({
      api,
      context: { ...context, title: '', body: '' }
    })
    const result = await runPipeline(dependencies)

    expect(written).toHaveLength(0)
    expect(result.commentBody).toContain('no title or description')
  })
})

// The digest now THROWS on a report shape it cannot read, rather than returning
// `undefined` and letting the section render as nothing — which is how the Impact
// section stayed empty from 434473a until 2026-08-11. This pins what the reader
// gets when the engine and this digest disagree, because the failure mode being
// prevented is silence, and a silent failure is exactly what an untested error
// path decays back into.
describe('runPipeline: the engine and the digest disagree', () => {
  const unreadable = (artifactPath: string) => async (path: string) =>
    path === `${ARTIFACT_DIR}/${artifactPath}`
      ? JSON.stringify({ schemaVersion: '1.0', wrong: 'shape' })
      : path === `${ARTIFACT_DIR}/report.json`
        ? JSON.stringify(reviewReportFixture)
        : path === `${ARTIFACT_DIR}/review-comments.github.json`
          ? JSON.stringify(renderedGithubCommentsFixture)
          : undefined

  // The findings are the reason the comment exists. An advisory lane whose report
  // cannot be read must cost the reader that lane, never the review.
  it('keeps the findings and says which section is missing', async () => {
    const { api, calls } = createFakeApi()
    const { dependencies } = createDependencies({
      api,
      readArtifact: unreadable('impact-report.json')
    })

    const result = await runPipeline(dependencies)
    const body = calls.created.at(-1) ?? calls.updated.at(-1)?.body ?? ''

    expect(body).toContain('### Findings')
    expect(body).toContain('impact report')
    expect(body).toContain('could not be read')
    // Exit 2, not 0: a red check is the only part of this an operator sees
    // without opening the pull request. The review still posted.
    expect(result.exitCode).toBe(2)
  })

  // The review report is different in kind. Without it the headline read "no
  // threshold crossed, this search reported nothing" — a clearance issued over a
  // run that may have found plenty.
  it('refuses to headline a clearance it cannot support', async () => {
    const { api, calls } = createFakeApi()
    const { dependencies } = createDependencies({
      api,
      readArtifact: unreadable('report.json')
    })

    const result = await runPipeline(dependencies)
    const body = calls.created.at(-1) ?? calls.updated.at(-1)?.body ?? ''

    expect(body).toContain('could not complete')
    expect(body).not.toContain('this search reported nothing')
    expect(result.exitCode).toBe(2)
  })
})

// The pipeline reads the rendered review comments of ONE platform, and it knows
// which one only because the shipped config pins it. Nothing linked the two: the
// producer derives the file name from the run's configured platform, so a config
// that stopped pinning `github` would leave this pipeline reading a file no run
// wrote — and `?? ''` turns that into "no inline comments", posted as a success.
// The name now comes from the producer's derivation; this is the other half, the
// assumption that derivation is called with.
describe('the shipped GitHub config', () => {
  it('pins the platform whose comments the pipeline reads back', async () => {
    const configPath = fileURLToPath(
      new URL('./codereviewer.github.json', import.meta.url)
    )
    const config = JSON.parse(await readFile(configPath, 'utf8')) as {
      readonly reporting?: {
        readonly reviewComments?: { readonly platform?: string }
      }
    }

    expect(config.reporting?.reviewComments?.platform).toBe(
      REVIEW_COMMENT_PLATFORM
    )
  })
})
