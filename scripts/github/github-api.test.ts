import { describe, expect, it } from 'vitest'
import { GithubApiError, createGithubApi, type FetchLike } from './github-api.js'

type Call = {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
}

const createFetch = (
  responses: readonly { status: number; body: string }[]
): { fetch: FetchLike; calls: Call[] } => {
  const calls: Call[] = []
  let index = 0
  const fetch: FetchLike = async (url, init) => {
    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers: init?.headers ?? {},
      ...(init?.body === undefined ? {} : { body: init.body })
    })
    const response = responses[index] ?? { status: 200, body: '[]' }
    index += 1

    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      text: async () => response.body
    }
  }

  return { fetch, calls }
}

const api = (fetch: FetchLike) =>
  createGithubApi({ token: 'super-secret-token', owner: 'acme', repo: 'widget', fetch })

describe('createGithubApi', () => {
  it('sends the token as a bearer credential and nothing else', async () => {
    const { fetch, calls } = createFetch([{ status: 200, body: '[]' }])

    await api(fetch).listIssueComments(42)

    expect(calls[0]?.url).toBe(
      'https://api.github.com/repos/acme/widget/issues/42/comments?per_page=100&page=1'
    )
    expect(calls[0]?.headers.authorization).toBe('Bearer super-secret-token')
    expect(calls[0]?.url).not.toContain('super-secret-token')
  })

  it('follows pagination until a short page', async () => {
    const full = JSON.stringify(
      Array.from({ length: 100 }, (_unused, index) => ({ id: index }))
    )
    const { fetch, calls } = createFetch([
      { status: 200, body: full },
      { status: 200, body: JSON.stringify([{ id: 100 }]) }
    ])

    expect(await api(fetch).listIssueComments(42)).toHaveLength(101)
    expect(calls).toHaveLength(2)
    expect(calls[1]?.url).toContain('page=2')
  })

  it('posts a review as a comment, never as a change request', async () => {
    const { fetch, calls } = createFetch([{ status: 200, body: '{}' }])

    await api(fetch).createReview({
      pullNumber: 42,
      commitId: 'abc',
      comments: [{ path: 'a.ts', body: 'x', line: 3, side: 'RIGHT' }]
    })

    const body = JSON.parse(calls[0]?.body ?? '{}') as { event: string }

    expect(body.event).toBe('COMMENT')
  })

  it('reports a failing request without leaking the token', async () => {
    const { fetch } = createFetch([
      { status: 403, body: 'Resource not accessible by integration' }
    ])

    await expect(api(fetch).createIssueComment(42, 'body')).rejects.toThrow(
      GithubApiError
    )
    await expect(
      api(createFetch([{ status: 403, body: 'no write access' }]).fetch)
        .createIssueComment(42, 'body')
        .catch((error: Error) => {
          expect(error.message).not.toContain('super-secret-token')
          throw error
        })
    ).rejects.toThrow(/403/u)
  })

  it('honours a GitHub Enterprise API base URL', async () => {
    const { fetch, calls } = createFetch([{ status: 200, body: '[]' }])

    await createGithubApi({
      token: 't',
      owner: 'acme',
      repo: 'widget',
      baseUrl: 'https://github.example.com/api/v3/',
      fetch
    }).listReviewComments(42)

    expect(calls[0]?.url.startsWith('https://github.example.com/api/v3/repos/')).toBe(
      true
    )
  })
})
