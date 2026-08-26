import { describe, expect, it } from 'vitest'
import { parsePullRequestEvent } from './pull-request-context.js'

const event = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    action: 'synchronize',
    pull_request: {
      number: 42,
      title: 'Add a guard',
      body: 'Because the endpoint was open.',
      draft: false,
      html_url: 'https://github.com/acme/widget/pull/42',
      head: {
        sha: 'a'.repeat(40),
        ref: 'feat/guard',
        repo: { full_name: 'acme/widget' }
      },
      base: { ref: 'main' },
      ...overrides
    }
  })

describe('parsePullRequestEvent', () => {
  it('reduces the payload to the neutral context', () => {
    expect(
      parsePullRequestEvent({
        eventPayload: event(),
        repository: 'acme/widget'
      })
    ).toEqual({
      owner: 'acme',
      repo: 'widget',
      number: 42,
      title: 'Add a guard',
      body: 'Because the endpoint was open.',
      url: 'https://github.com/acme/widget/pull/42',
      headSha: 'a'.repeat(40),
      headRef: 'feat/guard',
      baseRef: 'main',
      draft: false,
      fromFork: false
    })
  })

  it('treats a head repository in a different account as a fork', () => {
    const context = parsePullRequestEvent({
      eventPayload: event({
        head: {
          sha: 'b'.repeat(40),
          ref: 'patch',
          repo: { full_name: 'someone-else/widget' }
        }
      }),
      repository: 'acme/widget'
    })

    expect(context.fromFork).toBe(true)
  })

  it('treats a deleted head repository as a fork rather than trusting it', () => {
    const context = parsePullRequestEvent({
      eventPayload: event({
        head: { sha: 'c'.repeat(40), ref: 'gone', repo: null }
      }),
      repository: 'acme/widget'
    })

    expect(context.fromFork).toBe(true)
  })

  it('compares repository names case-insensitively', () => {
    const context = parsePullRequestEvent({
      eventPayload: event({
        head: {
          sha: 'd'.repeat(40),
          ref: 'branch',
          repo: { full_name: 'Acme/Widget' }
        }
      }),
      repository: 'acme/widget'
    })

    expect(context.fromFork).toBe(false)
  })

  it('accepts a null title and body', () => {
    const context = parsePullRequestEvent({
      eventPayload: event({ title: null, body: null }),
      repository: 'acme/widget'
    })

    expect(context.title).toBe('')
    expect(context.body).toBe('')
  })

  it('rejects a payload that is not a pull_request event', () => {
    expect(() =>
      parsePullRequestEvent({
        eventPayload: JSON.stringify({ push: {} }),
        repository: 'acme/widget'
      })
    ).toThrow(/pull_request/u)
  })

  it('rejects a malformed repository name', () => {
    expect(() =>
      parsePullRequestEvent({ eventPayload: event(), repository: 'widget' })
    ).toThrow(/owner\/repo/u)
  })

  it('rejects a payload that is not JSON', () => {
    expect(() =>
      parsePullRequestEvent({ eventPayload: 'not json', repository: 'a/b' })
    ).toThrow(/valid JSON/u)
  })
})
