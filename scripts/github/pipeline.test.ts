import { describe, expect, it } from 'vitest'
import { runPipeline, type PipelineDependencies } from './pipeline.js'
import type { PullRequestContext } from './pull-request-context.js'
import type { GithubApi } from './github-api.js'
import type { StageResult } from './stage-outcomes.js'
import { summaryCommentMarker } from './summary-comment.js'
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
    existingReviewComments?: readonly { body: string }[]
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
    listReviewComments: async () => overrides.existingReviewComments ?? [],
    createReview: async ({ commitId, comments }) => {
      calls.reviews.push({ commitId, count: comments.length })
    },
    ...overrides
  }

  return { api, calls }
}

const stageResults = (
  results: Partial<Record<string, StageResult>>
): ((args: readonly string[]) => Promise<StageResult>) => {
  const defaults: Record<string, StageResult> = {
    review: {
      exitCode: 0,
      stdout: JSON.stringify({
        runId: 'run_abc123',
        qualityGatePassed: true,
        artifactDir: ARTIFACT_DIR
      }),
      stderr: ''
    },
    intent: { exitCode: 0, stdout: JSON.stringify(intentReportFixture), stderr: '' },
    impact: { exitCode: 0, stdout: JSON.stringify(impactReportFixture), stderr: '' }
  }

  return async (args) => {
    const key = args[0] === 'review' ? 'review' : (args[0] as string)

    return results[key] ?? (defaults[key] as StageResult)
  }
}

const createDependencies = (
  overrides: Partial<PipelineDependencies> = {},
  stages: Partial<Record<string, StageResult>> = {}
): {
  dependencies: PipelineDependencies
  written: { fileName: string; content: string }[]
  stageArgs: string[][]
} => {
  const written: { fileName: string; content: string }[] = []
  const stageArgs: string[][] = []
  const run = stageResults(stages)
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
      return run(args)
    },
    readArtifact: async (artifactPath) => {
      if (artifactPath === `${ARTIFACT_DIR}/report.json`) {
        return JSON.stringify(reviewReportFixture)
      }

      if (artifactPath === `${ARTIFACT_DIR}/review-comments.github.json`) {
        return JSON.stringify(renderedGithubCommentsFixture)
      }

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

  it('runs all three stages against the pull request’s base branch', async () => {
    const { api } = createFakeApi()
    const { dependencies, stageArgs } = createDependencies({ api })

    await runPipeline(dependencies)

    expect(stageArgs.map((args) => args.slice(0, 2))).toEqual([
      ['review', '--base-ref'],
      ['intent', 'check'],
      ['impact', 'check']
    ])
    for (const args of stageArgs) {
      expect(args).toContain('origin/main')
      expect(args).toContain('--config')
    }
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
        review: {
          exitCode: 4,
          stdout: '',
          stderr: '{"code":"provider_error","message":"429 rate limit"}'
        }
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
        review: {
          exitCode: 1,
          stdout: JSON.stringify({
            runId: 'run_abc123',
            qualityGatePassed: false,
            artifactDir: ARTIFACT_DIR
          }),
          stderr: ''
        }
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
        review: {
          exitCode: 5,
          stdout: '',
          stderr: `{"code":"reporting_error","message":"render failed","artifactDir":"${ARTIFACT_DIR}"}`
        }
      }
    )
    const result = await runPipeline(dependencies)

    expect(result.exitCode).toBe(1)
    expect(calls.created[0]).toContain('Session check removed from the admin route')
  })

  it('keeps the job green when every advisory stage failed', async () => {
    const { api } = createFakeApi()
    const failed: StageResult = {
      exitCode: 3,
      stdout: '',
      stderr: '{"code":"repository_error","message":"no merge base"}'
    }
    const { dependencies } = createDependencies(
      { api },
      { intent: failed, impact: failed }
    )
    const result = await runPipeline(dependencies)

    expect(result.exitCode).toBe(0)
    expect(result.commentBody).toContain('no merge base')
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
