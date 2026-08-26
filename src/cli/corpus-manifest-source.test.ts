// The two ordinary mistakes an operator makes with `--manifest`, and the default
// path that is not a mistake at all.
//
// These are here because the failures used to be unusable: an absolute path gave
// "Path value must be relative to the root." — naming no flag, no file, and never
// saying what "the root" is — and a mistyped relative path gave a raw
// `ENOENT ... realpath '<absolute host path>'` under `repository_error`, a
// category that means the repository UNDER REVIEW is broken, for a typo in a CLI
// argument.

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { readCorpusManifest } from './corpus-manifest-source.js'

// `createStructuredError` returns a plain StructuredError object, NOT an Error
// subclass, so `instanceof Error` is false here and reading the message through
// it silently yields ''. A first version of this test did exactly that and
// asserted against an empty string.
const messageOf = (value: unknown): string =>
  typeof value === 'object' && value !== null && 'message' in value
    ? String((value as { readonly message: unknown }).message)
    : ''

let root = ''

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'codereviewer-manifest-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const readAt = (manifestPath: string, isDefaultPath = false) =>
  readCorpusManifest({
    cwd: root,
    manifestPath,
    commandName: 'impact',
    isDefaultPath
  })

describe('readCorpusManifest', () => {
  test('reads a manifest that exists', async () => {
    await mkdir(path.join(root, 'eval'), { recursive: true })
    await writeFile(path.join(root, 'eval', 'manifest.json'), '{"cases":[]}')

    expect(await readAt('eval/manifest.json')).toBe('{"cases":[]}')
  })

  test('a missing manifest names the path and the flag, not errno', async () => {
    await expect(readAt('eval/typo.json')).rejects.toMatchObject({
      code: 'config_error',
      details: { cause: 'missing' }
    })

    const message = messageOf(
      await readAt('eval/typo.json').catch((value: unknown) => value)
    )

    expect(message).toContain('eval/typo.json')
    expect(message).toContain('--manifest')
    // The remedy, not the syscall. `realpath` leaking an absolute host path into
    // a CLI message is what this replaced.
    expect(message).not.toContain('ENOENT')
    expect(message).not.toContain('realpath')
  })

  test('a path outside the repository says so rather than "relative to the root"', async () => {
    await expect(readAt('/etc/hosts')).rejects.toMatchObject({
      code: 'config_error',
      details: { cause: 'outside_repository' }
    })

    const message = messageOf(
      await readAt('/etc/hosts').catch((value: unknown) => value)
    )

    expect(message).toContain('/etc/hosts')
    expect(message).toContain('repository-relative')
    // The old text. It named neither the value nor what "the root" was.
    expect(message).not.toBe('Path value must be relative to the root.')
  })

  test('the DEFAULT path points at hydration, not at a flag nobody passed', async () => {
    // A caller who never passed `--manifest` has not mistyped anything, so
    // telling them to check the flag sends them to fix something they did not
    // set. The corpus simply is not hydrated yet.
    const message = messageOf(
      await readAt('eval/corpora/impact/manifest.json', true).catch(
        (value: unknown) => value
      )
    )

    expect(message).toContain('hydrate')
    expect(message).toContain('eval:impact-corpus:hydrate')
  })
})
