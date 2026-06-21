import { mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  normalizeFileSystemPath,
  resolveExistingPathInsideRoot,
  resolveWritePathInsideRoot,
  resolvePathInsideRoot,
  toPortablePath
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
      await mkdir(path.join(root, '.review'), { recursive: true })
      await mkdir(outside, { recursive: true })
      await writeFile(path.join(outside, 'keep.txt'), 'outside')
      await symlink(outside, path.join(root, '.review', 'runs'))

      await expect(
        resolveWritePathInsideRoot(root, '.review/runs/report.json')
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
      await mkdir(path.join(root, '.review', 'runs'), { recursive: true })
      await mkdir(outside, { recursive: true })
      await writeFile(path.join(outside, 'report.json'), 'outside')
      await symlink(
        path.join(outside, 'report.json'),
        path.join(root, '.review', 'runs', 'report.json')
      )

      await expect(
        resolveWritePathInsideRoot(root, '.review/runs/report.json')
      ).rejects.toThrow(TypeError)
    } finally {
      await rm(root, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })
})
