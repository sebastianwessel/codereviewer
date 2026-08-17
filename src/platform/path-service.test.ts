import { mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  normalizeFileSystemPath,
  resolveExistingPathInsideRoot,
  resolveWritePathInsideRoot,
  resolvePathInsideRoot,
  toPortablePath,
  toPortableRelativePath
} from './path-service.js'

describe('path service', () => {
  test('normalizes POSIX filesystem paths', () => {
    expect(
      normalizeFileSystemPath('/repo/src/../src/index.ts', { flavor: 'posix' })
    ).toBe('/repo/src/index.ts')
  })

  test('normalizes Windows filesystem paths', () => {
    expect(
      normalizeFileSystemPath('C:\\repo\\src\\..\\src\\index.ts', {
        flavor: 'win32'
      })
    ).toBe('C:\\repo\\src\\index.ts')
  })

  test('converts Windows filesystem paths to portable artifact paths', () => {
    expect(
      toPortablePath('C:\\repo\\src\\..\\src\\index.ts', { flavor: 'win32' })
    ).toBe('C:/repo/src/index.ts')
  })

  // The regression the shared `toPortableRelativePath` exists to prevent. It is
  // asserted on the win32 flavor because that is the only flavor on which the two
  // implementations it replaced disagreed: `path.relative` returns `skills\nested`
  // there, and the skill index used to split that on `/`, find nothing, and emit the
  // backslash unchanged — while the slice manifest split on `path.sep` and produced
  // `skills/nested` into a sha256. On POSIX the two were byte-identical, which is
  // exactly why nothing caught it.
  test('converts a Windows relative path to a portable one', () => {
    expect(
      toPortableRelativePath('C:\\repo', 'C:\\repo\\skills\\nested', {
        flavor: 'win32'
      })
    ).toBe('skills/nested')
  })

  test('converts a POSIX relative path to a portable one', () => {
    expect(
      toPortableRelativePath('/repo', '/repo/skills/nested', { flavor: 'posix' })
    ).toBe('skills/nested')
  })

  // A POSIX file name may legally contain a backslash, and this helper derives its
  // input from the filesystem rather than receiving it as data — so the backslash is
  // part of the NAME here, not a separator. This is the case that would move if this
  // ever got routed through `normalizeRepositoryRelativePath`, which reads `\` as a
  // separator on every platform by design.
  test('keeps a backslash in a POSIX file name as part of the name', () => {
    expect(
      toPortableRelativePath('/repo', '/repo/odd\\name.txt', { flavor: 'posix' })
    ).toBe('odd\\name.txt')
  })

  test('rejects empty path values', () => {
    expect(() => normalizeFileSystemPath('   ')).toThrow(TypeError)
  })

  test('resolves safe POSIX paths inside a root', () => {
    expect(
      resolvePathInsideRoot('/repo', 'src/../src/index.ts', {
        flavor: 'posix'
      })
    ).toBe('/repo/src/index.ts')
  })

  test('rejects POSIX path traversal outside a root', () => {
    expect(() =>
      resolvePathInsideRoot('/repo', '../outside.ts', { flavor: 'posix' })
    ).toThrow(TypeError)
  })

  test('rejects unsafe Windows absolute paths', () => {
    expect(() =>
      resolvePathInsideRoot('C:\\repo', 'D:\\outside\\index.ts', {
        flavor: 'win32'
      })
    ).toThrow(TypeError)
  })

  test('rejects Windows UNC paths', () => {
    expect(() =>
      resolvePathInsideRoot('C:\\repo', '\\\\server\\share\\index.ts', {
        flavor: 'win32'
      })
    ).toThrow(TypeError)
  })

  test('rejects path values containing NUL bytes', () => {
    expect(() => normalizeFileSystemPath('src/index.ts\u0000')).toThrow(
      TypeError
    )
  })

  test('rejects write paths whose existing parent escapes root through symlink', async () => {
    const root = path.join(tmpdir(), `codereviewer-path-${crypto.randomUUID()}`)
    const outside = path.join(tmpdir(), `codereviewer-outside-${crypto.randomUUID()}`)

    try {
      await mkdir(path.join(root, '.codereviewer'), { recursive: true })
      await mkdir(outside, { recursive: true })
      await writeFile(path.join(outside, 'keep.txt'), 'outside')
      await symlink(outside, path.join(root, '.codereviewer', 'runs'))

      await expect(
        resolveWritePathInsideRoot(root, '.codereviewer/runs/report.json')
      ).rejects.toThrow(TypeError)
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })

  test('rejects read paths whose existing target escapes root through symlink', async () => {
    const root = path.join(tmpdir(), `codereviewer-path-${crypto.randomUUID()}`)
    const outside = path.join(tmpdir(), `codereviewer-outside-${crypto.randomUUID()}`)

    try {
      await mkdir(root, { recursive: true })
      await mkdir(outside, { recursive: true })
      await writeFile(path.join(outside, 'secret.txt'), 'outside')
      await symlink(path.join(outside, 'secret.txt'), path.join(root, 'input.txt'))

      await expect(
        resolveExistingPathInsideRoot(root, 'input.txt')
      ).rejects.toThrow(TypeError)
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })

  test('rejects write paths whose existing target escapes root through symlink', async () => {
    const root = path.join(tmpdir(), `codereviewer-path-${crypto.randomUUID()}`)
    const outside = path.join(tmpdir(), `codereviewer-outside-${crypto.randomUUID()}`)

    try {
      await mkdir(path.join(root, '.codereviewer', 'runs'), { recursive: true })
      await mkdir(outside, { recursive: true })
      await writeFile(path.join(outside, 'report.json'), 'outside')
      await symlink(
        path.join(outside, 'report.json'),
        path.join(root, '.codereviewer', 'runs', 'report.json')
      )

      await expect(
        resolveWritePathInsideRoot(root, '.codereviewer/runs/report.json')
      ).rejects.toThrow(TypeError)
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })
})
