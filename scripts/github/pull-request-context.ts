// The GitHub `pull_request` event payload, reduced to the neutral shape the rest
// of this integration uses.
//
// This is an external boundary in the strongest sense: the title and body are
// written by whoever opened the pull request, and the payload itself arrives as
// a file on disk whose path the runner supplies. It is therefore parsed with a
// schema rather than indexed into, and every field this module exposes is either
// a GitHub-controlled scalar (numbers, refs, SHAs, repository names) or is
// sanitized at the point where it is used.
//
// Nothing here reads instructions out of the payload. The title and body reach a
// model as change-intent context (spec 11), which is bounded, redacted and
// framed as untrusted by the engine, and they reach a comment body through
// `sanitize.ts`. They never reach a shell, a path, or a control-flow decision.
import { z } from 'zod'

const RepositoryReferenceSchema = z.object({
  full_name: z.string().min(1)
})

const PullRequestEventSchema = z.object({
  pull_request: z.object({
    number: z.number().int().min(1),
    title: z.string().nullish(),
    body: z.string().nullish(),
    draft: z.boolean().nullish(),
    html_url: z.string().nullish(),
    head: z.object({
      sha: z.string().min(1),
      ref: z.string().min(1),
      // Null when the head repository has been deleted. Treated exactly like a
      // fork: we cannot trust it and we cannot check it out.
      repo: RepositoryReferenceSchema.nullish()
    }),
    base: z.object({
      ref: z.string().min(1)
    })
  })
})

export type PullRequestContext = {
  readonly owner: string
  readonly repo: string
  readonly number: number
  readonly title: string
  readonly body: string
  readonly url: string
  readonly headSha: string
  readonly headRef: string
  readonly baseRef: string
  readonly draft: boolean
  /**
   * True when the head branch does not live in the repository the workflow runs
   * for. On a `pull_request` event from a fork GitHub withholds secrets and
   * downgrades `GITHUB_TOKEN` to read-only, so neither the provider call nor the
   * comment write can succeed; the pipeline reports that plainly instead of
   * failing opaquely halfway through.
   */
  readonly fromFork: boolean
}

const splitRepository = (
  repository: string
): { readonly owner: string; readonly repo: string } => {
  const [owner, repo, ...rest] = repository.split('/')

  if (
    owner === undefined ||
    owner.length === 0 ||
    repo === undefined ||
    repo.length === 0 ||
    rest.length > 0
  ) {
    throw new TypeError(
      `GITHUB_REPOSITORY must be "owner/repo", received "${repository}".`
    )
  }

  return { owner, repo }
}

export const parsePullRequestEvent = (input: {
  readonly eventPayload: string
  readonly repository: string
}): PullRequestContext => {
  const { owner, repo } = splitRepository(input.repository)

  let payload: unknown

  try {
    payload = JSON.parse(input.eventPayload)
  } catch {
    throw new TypeError('The GitHub event payload is not valid JSON.')
  }

  const parsed = PullRequestEventSchema.safeParse(payload)

  if (!parsed.success) {
    throw new TypeError(
      'The GitHub event payload is not a pull_request event. This workflow only supports pull_request triggers.'
    )
  }

  const pullRequest = parsed.data.pull_request
  const headRepository = pullRequest.head.repo?.full_name

  return {
    owner,
    repo,
    number: pullRequest.number,
    title: pullRequest.title ?? '',
    body: pullRequest.body ?? '',
    url: pullRequest.html_url ?? '',
    headSha: pullRequest.head.sha,
    headRef: pullRequest.head.ref,
    baseRef: pullRequest.base.ref,
    draft: pullRequest.draft ?? false,
    fromFork:
      headRepository === undefined ||
      headRepository.toLowerCase() !== input.repository.toLowerCase()
  }
}
