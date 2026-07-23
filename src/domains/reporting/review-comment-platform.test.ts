import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  detectPlatformTarget,
  readOriginRemoteUrl,
  remoteHostFromUrl
} from './review-comment-platform.js'

describe('review-comment platform detection', () => {
  test('explicit config overrides every other signal', () => {
    expect(
      detectPlatformTarget({
        configured: 'bitbucket',
        env: { GITHUB_ACTIONS: 'true' },
        originRemoteUrl: 'https://gitlab.com/acme/repo.git'
      })
    ).toEqual({ platform: 'bitbucket', source: 'config' })
  })

  test('CI env wins over the git remote host', () => {
    expect(
      detectPlatformTarget({
        configured: 'auto',
        env: { GITLAB_CI: 'true' },
        originRemoteUrl: 'git@github.com:acme/repo.git'
      })
    ).toEqual({ platform: 'gitlab', source: 'ci-env' })
  })

  test('detects each CI environment in precedence order', () => {
    expect(
      detectPlatformTarget({ configured: 'auto', env: { GITHUB_ACTIONS: 'true' } })
    ).toEqual({ platform: 'github', source: 'ci-env' })
    expect(
      detectPlatformTarget({ configured: 'auto', env: { GITLAB_CI: 'true' } })
    ).toEqual({ platform: 'gitlab', source: 'ci-env' })
    expect(
      detectPlatformTarget({
        configured: 'auto',
        env: { BITBUCKET_PIPELINE_UUID: '{uuid}' }
      })
    ).toEqual({ platform: 'bitbucket', source: 'ci-env' })
    expect(
      detectPlatformTarget({
        configured: 'auto',
        env: { BITBUCKET_WORKSPACE: 'acme' }
      })
    ).toEqual({ platform: 'bitbucket', source: 'ci-env' })
  })

  test('a false or empty CI flag is not a signal', () => {
    expect(
      detectPlatformTarget({
        configured: 'auto',
        env: { GITHUB_ACTIONS: 'false', GITLAB_CI: '' },
        originRemoteUrl: 'https://bitbucket.org/acme/repo.git'
      })
    ).toEqual({ platform: 'bitbucket', source: 'remote' })
  })

  test('falls back to the remote host when no CI env is present', () => {
    expect(
      detectPlatformTarget({
        configured: 'auto',
        env: {},
        originRemoteUrl: 'https://github.com/acme/repo.git'
      })
    ).toEqual({ platform: 'github', source: 'remote' })
    expect(
      detectPlatformTarget({
        configured: 'auto',
        originRemoteUrl: 'git@gitlab.example.com:acme/repo.git'
      })
    ).toEqual({ platform: 'gitlab', source: 'remote' })
  })

  test('resolves generic when nothing matches', () => {
    expect(
      detectPlatformTarget({
        configured: 'auto',
        env: {},
        originRemoteUrl: 'https://git.example.com/acme/repo.git'
      })
    ).toEqual({ platform: 'generic', source: 'default' })
    expect(detectPlatformTarget({ configured: 'auto' })).toEqual({
      platform: 'generic',
      source: 'default'
    })
  })

  test('parses hosts from https, ssh, and scp-like remotes', () => {
    expect(remoteHostFromUrl('https://github.com/acme/repo.git')).toBe(
      'github.com'
    )
    expect(remoteHostFromUrl('git@github.com:acme/repo.git')).toBe('github.com')
    expect(remoteHostFromUrl('ssh://git@gitlab.com:22/acme/repo.git')).toBe(
      'gitlab.com'
    )
    expect(
      remoteHostFromUrl('https://user:token@bitbucket.org/acme/repo.git')
    ).toBe('bitbucket.org')
    expect(remoteHostFromUrl('   ')).toBeUndefined()
    expect(remoteHostFromUrl('not a url')).toBeUndefined()
  })

  test('readOriginRemoteUrl returns undefined outside a git repository', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'codereviewer-remote-'))

    await expect(readOriginRemoteUrl(directory)).resolves.toBeUndefined()
  })
})
