// Platform detection for review comments (spec 13). Detection reads environment
// variables and the git `origin` remote only. It performs NO network request and
// calls NO platform API, so it never compromises platform neutrality.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type {
  PlatformTarget,
  ReviewCommentPlatform
} from '../../shared/contracts/index.js'

const execFileAsync = promisify(execFile)

export type PlatformDetectionSource = 'config' | 'ci-env' | 'remote' | 'default'

export type ResolvedPlatform = {
  readonly platform: PlatformTarget
  readonly source: PlatformDetectionSource
}

export type PlatformDetectionInput = {
  readonly configured: ReviewCommentPlatform
  readonly env?: Readonly<Record<string, string | undefined>> | undefined
  readonly originRemoteUrl?: string | undefined
}

// A CI signal is the variable being present with a meaningful value. GitHub and
// GitLab set their flags to "true"; Bitbucket sets an id/workspace string. An
// empty or explicitly false value is not a signal.
const isCiSignal = (value: string | undefined): boolean =>
  value !== undefined && value !== '' && value !== 'false' && value !== '0'

const platformFromCiEnv = (
  env: Readonly<Record<string, string | undefined>>
): PlatformTarget | undefined => {
  if (isCiSignal(env.GITHUB_ACTIONS)) {
    return 'github'
  }

  if (isCiSignal(env.GITLAB_CI)) {
    return 'gitlab'
  }

  if (
    isCiSignal(env.BITBUCKET_PIPELINE_UUID) ||
    isCiSignal(env.BITBUCKET_WORKSPACE)
  ) {
    return 'bitbucket'
  }

  return undefined
}

// Extract the host from a git remote URL. Handles https(+credentials), ssh://,
// and scp-like `git@host:path` forms. Returns the lowercased host or undefined.
export const remoteHostFromUrl = (url: string): string | undefined => {
  const trimmed = url.trim()

  if (trimmed === '') {
    return undefined
  }

  const scpLike = /^[^/@]+@([^/:]+):/u.exec(trimmed)

  if (scpLike !== null) {
    return scpLike[1]!.toLowerCase()
  }

  try {
    const { hostname } = new URL(trimmed)

    return hostname === '' ? undefined : hostname.toLowerCase()
  } catch {
    return undefined
  }
}

const platformFromRemoteHost = (
  host: string
): PlatformTarget | undefined => {
  if (host === 'github.com') {
    return 'github'
  }

  // gitlab.com plus self-managed hosts published under a `gitlab.` subdomain.
  if (host === 'gitlab.com' || host.startsWith('gitlab.')) {
    return 'gitlab'
  }

  if (host === 'bitbucket.org') {
    return 'bitbucket'
  }

  return undefined
}

const platformFromRemote = (
  originRemoteUrl: string | undefined
): PlatformTarget | undefined => {
  if (originRemoteUrl === undefined) {
    return undefined
  }

  const host = remoteHostFromUrl(originRemoteUrl)

  return host === undefined ? undefined : platformFromRemoteHost(host)
}

// Resolve the target platform in first-match precedence: explicit config, then a
// CI environment signal, then the origin remote host, then `generic`.
export const detectPlatformTarget = (
  input: PlatformDetectionInput
): ResolvedPlatform => {
  if (input.configured !== 'auto') {
    return { platform: input.configured, source: 'config' }
  }

  const env = input.env ?? {}
  const ciPlatform = platformFromCiEnv(env)

  if (ciPlatform !== undefined) {
    return { platform: ciPlatform, source: 'ci-env' }
  }

  const remotePlatform = platformFromRemote(input.originRemoteUrl)

  if (remotePlatform !== undefined) {
    return { platform: remotePlatform, source: 'remote' }
  }

  return { platform: 'generic', source: 'default' }
}

// Read the `origin` remote URL with a read-only `git config` lookup. Returns
// undefined when there is no origin remote or git is unavailable; a missing
// remote resolves to `generic`, which is normal and not an error.
export const readOriginRemoteUrl = async (
  cwd: string
): Promise<string | undefined> => {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['config', '--get', 'remote.origin.url'],
      { cwd }
    )
    const url = stdout.trim()

    return url === '' ? undefined : url
  } catch {
    return undefined
  }
}
