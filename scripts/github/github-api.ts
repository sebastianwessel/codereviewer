// The only module in this integration that performs network IO.
//
// It is deliberately a thin, dependency-free wrapper over `fetch` rather than a
// client library: the integration needs five endpoints, and adding a dependency
// to a repository whose own rule is "keep provider SDKs out of the base
// dependency set" to call five endpoints would be hard to justify.
//
// The token never leaves this module and is never rendered into an error. A
// failed request reports the method, the path and the status — enough to debug a
// permissions problem, and nothing a log scraper can use.
import type { IssueComment } from './summary-comment.js'
import type { InlineComment } from './inline-review.js'

export type FetchLike = (
  input: string,
  init?: {
    readonly method?: string
    readonly headers?: Record<string, string>
    readonly body?: string
  }
) => Promise<{
  readonly ok: boolean
  readonly status: number
  text: () => Promise<string>
}>

export class GithubApiError extends Error {
  readonly status: number

  constructor(input: {
    readonly method: string
    readonly path: string
    readonly status: number
    readonly detail: string
  }) {
    super(
      `GitHub API ${input.method} ${input.path} failed with ${input.status}: ${input.detail}`
    )
    this.name = 'GithubApiError'
    this.status = input.status
  }
}

export type ReviewCommentSummary = {
  readonly id: number
  readonly body?: string | null
}

export type GithubApi = {
  listIssueComments: (pullNumber: number) => Promise<readonly IssueComment[]>
  createIssueComment: (pullNumber: number, body: string) => Promise<void>
  updateIssueComment: (commentId: number, body: string) => Promise<void>
  listReviewComments: (
    pullNumber: number
  ) => Promise<readonly ReviewCommentSummary[]>
  createReview: (input: {
    readonly pullNumber: number
    readonly commitId: string
    readonly comments: readonly InlineComment[]
  }) => Promise<void>
}

// GitHub caps `per_page` at 100. Ten pages is 1 000 comments, far beyond any
// pull request this is useful on, and it bounds the loop so a paging bug cannot
// spin forever.
const MAX_PAGES = 10
const PER_PAGE = 100

export const createGithubApi = (input: {
  readonly token: string
  readonly owner: string
  readonly repo: string
  readonly baseUrl?: string
  readonly fetch?: FetchLike
}): GithubApi => {
  const baseUrl = (input.baseUrl ?? 'https://api.github.com').replace(/\/+$/u, '')
  const doFetch: FetchLike = input.fetch ?? (globalThis.fetch as unknown as FetchLike)
  const repositoryPath = `/repos/${input.owner}/${input.repo}`

  const request = async (
    method: string,
    path: string,
    body?: unknown
  ): Promise<unknown> => {
    const response = await doFetch(`${baseUrl}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${input.token}`,
        'content-type': 'application/json',
        'user-agent': 'codereviewer-github-integration',
        'x-github-api-version': '2022-11-28'
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
    const text = await response.text()

    if (!response.ok) {
      throw new GithubApiError({
        method,
        path,
        status: response.status,
        // Bounded: an HTML error page from a proxy would otherwise become the
        // whole job log.
        detail: text.slice(0, 500)
      })
    }

    if (text.length === 0) {
      return undefined
    }

    try {
      return JSON.parse(text) as unknown
    } catch {
      return undefined
    }
  }

  const listPaged = async (path: string): Promise<readonly unknown[]> => {
    const items: unknown[] = []

    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const separator = path.includes('?') ? '&' : '?'
      const parsed = await request(
        'GET',
        `${path}${separator}per_page=${PER_PAGE}&page=${page}`
      )

      if (!Array.isArray(parsed) || parsed.length === 0) {
        break
      }

      items.push(...parsed)

      if (parsed.length < PER_PAGE) {
        break
      }
    }

    return items
  }

  return {
    listIssueComments: async (pullNumber) =>
      (await listPaged(
        `${repositoryPath}/issues/${pullNumber}/comments`
      )) as readonly IssueComment[],
    createIssueComment: async (pullNumber, body) => {
      await request('POST', `${repositoryPath}/issues/${pullNumber}/comments`, {
        body
      })
    },
    updateIssueComment: async (commentId, body) => {
      await request('PATCH', `${repositoryPath}/issues/comments/${commentId}`, {
        body
      })
    },
    listReviewComments: async (pullNumber) =>
      (await listPaged(
        `${repositoryPath}/pulls/${pullNumber}/comments`
      )) as readonly ReviewCommentSummary[],
    createReview: async ({ pullNumber, commitId, comments }) => {
      await request('POST', `${repositoryPath}/pulls/${pullNumber}/reviews`, {
        commit_id: commitId,
        // COMMENT, never REQUEST_CHANGES. Blocking a merge is the quality gate's
        // job through the job's exit code and a required status check, which is
        // a deterministic decision a human configured. A review verdict posted
        // by a model-backed tool would be a second, softer gate that nobody
        // agreed to and that a maintainer cannot dismiss without dismissing the
        // findings with it.
        event: 'COMMENT',
        comments
      })
    }
  }
}
