import { describe, expect, test } from 'vitest'
import { compileEligibilityConfig, evaluatePathEligibility } from './eligibility.js'

describe('context retrieval eligibility', () => {
  test('allows an ordinary source path by default', () => {
    const compiled = compileEligibilityConfig()

    expect(evaluatePathEligibility('src/app.ts', compiled)).toEqual({
      eligible: true
    })
  })

  test('always rejects dotfiles such as .env, regardless of configuration', () => {
    const compiled = compileEligibilityConfig({
      include: ['**/*'],
      exclude: []
    })

    expect(evaluatePathEligibility('.env', compiled)).toMatchObject({
      eligible: false,
      reason: expect.stringContaining('dotfile')
    })
    expect(evaluatePathEligibility('config/.env.local', compiled)).toMatchObject({
      eligible: false,
      reason: expect.stringContaining('dotfile')
    })
  })

  test('always rejects node_modules, .git, dist, and .codereviewer paths', () => {
    const compiled = compileEligibilityConfig({ include: ['**/*'], exclude: [] })

    for (const portablePath of [
      'node_modules/pkg/index.js',
      '.git/config',
      'dist/bundle.js',
      '.codereviewer/runs/latest.json'
    ]) {
      expect(evaluatePathEligibility(portablePath, compiled)).toMatchObject({
        eligible: false
      })
    }
  })

  test('rejects paths matching a configured exclude glob', () => {
    const compiled = compileEligibilityConfig({
      include: ['**/*'],
      exclude: ['secrets/**']
    })

    expect(evaluatePathEligibility('secrets/token.txt', compiled)).toMatchObject({
      eligible: false,
      reason: expect.stringContaining('paths.exclude')
    })
    expect(evaluatePathEligibility('src/app.ts', compiled)).toEqual({
      eligible: true
    })
  })

  test('rejects paths not matched by a configured include glob', () => {
    const compiled = compileEligibilityConfig({
      include: ['lib/**'],
      exclude: []
    })

    expect(evaluatePathEligibility('src/app.ts', compiled)).toMatchObject({
      eligible: false,
      reason: expect.stringContaining('paths.include')
    })
    expect(evaluatePathEligibility('lib/app.ts', compiled)).toEqual({
      eligible: true
    })
  })

  test('applies the default exclude set when no configuration is supplied', () => {
    const compiled = compileEligibilityConfig()

    expect(evaluatePathEligibility('coverage/report.html', compiled)).toMatchObject({
      eligible: false
    })
    expect(evaluatePathEligibility('package-lock.json', compiled)).toMatchObject({
      eligible: false
    })
  })

  test('rejects a directory no include pattern can match a file beneath', () => {
    const compiled = compileEligibilityConfig({ include: ['src/**/*'] })

    // The relaxation is bounded: `docs` cannot hold a file matching `src/**/*`,
    // so nothing about it is traversable and the refusal is unchanged.
    expect(
      evaluatePathEligibility('docs', compiled, 'directory')
    ).toMatchObject({
      eligible: false,
      reason: expect.stringContaining('paths.include')
    })
  })

  test('rejects the hard-floor directories regardless of segment casing', () => {
    const compiled = compileEligibilityConfig()

    // On a case-insensitive filesystem `NODE_MODULES`/`Dist` resolve to the real
    // excluded directories, so the case-folded hard floor must reject them.
    expect(
      evaluatePathEligibility('NODE_MODULES/pkg/index.js', compiled)
    ).toMatchObject({ eligible: false })
    expect(evaluatePathEligibility('Dist/bundle.js', compiled)).toMatchObject({
      eligible: false
    })
  })
})

// `paths.include` scopes FILES (spec 04). A directory it does not name is still
// traversable when an included file could live beneath it, because otherwise an
// include list naming a subtree leaves no directory a traversal can start from —
// which refused every `list` and every `grep` while single-file `read` worked.
describe('directory eligibility under a file-scoped include list', () => {
  test('the repository root is traversable under a subtree include list', () => {
    const compiled = compileEligibilityConfig({ include: ['src/**/*'] })

    expect(evaluatePathEligibility('.', compiled, 'directory')).toEqual({
      eligible: true
    })
  })

  test('the subtree root itself is traversable', () => {
    const compiled = compileEligibilityConfig({ include: ['src/**/*'] })

    expect(evaluatePathEligibility('src', compiled, 'directory')).toEqual({
      eligible: true
    })
    expect(
      evaluatePathEligibility('src/domains', compiled, 'directory')
    ).toEqual({ eligible: true })
  })

  test('a wildcard in the middle of a pattern is traversed, not prefix-matched', () => {
    const compiled = compileEligibilityConfig({
      include: ['packages/*/src/**/*']
    })

    // A literal-prefix shortcut would stop at `packages` and refuse everything
    // below it, so each level of the pattern is checked.
    for (const directoryPath of [
      '.',
      'packages',
      'packages/a',
      'packages/a/src',
      'packages/a/src/nested'
    ]) {
      expect(
        evaluatePathEligibility(directoryPath, compiled, 'directory')
      ).toEqual({ eligible: true })
    }

    // `packages/a/lib` holds no path matching the pattern, so it stays refused.
    expect(
      evaluatePathEligibility('packages/a/lib', compiled, 'directory')
    ).toMatchObject({ eligible: false })
  })

  test('the relaxation is for directories only: a file still faces the include list', () => {
    const compiled = compileEligibilityConfig({ include: ['src/**/*.ts'] })

    // `notes.md` would pass the ancestor test — a file matching `src/**/*.ts`
    // could live under a directory of that name — so asking as a FILE is the
    // only thing standing between the include list and an unscoped read.
    expect(evaluatePathEligibility('notes.md', compiled, 'file')).toMatchObject({
      eligible: false
    })
    expect(evaluatePathEligibility('src/app.js', compiled, 'file')).toMatchObject(
      { eligible: false }
    )
    expect(evaluatePathEligibility('src/app.ts', compiled, 'file')).toEqual({
      eligible: true
    })
  })

  test('defaults to the strict file rule when no kind is given', () => {
    const compiled = compileEligibilityConfig({ include: ['src/**/*'] })

    // A caller that has not thought about directories must not widen the gate by
    // omission, so the argument-free call keeps the pre-existing answer.
    expect(evaluatePathEligibility('src', compiled)).toMatchObject({
      eligible: false
    })
  })

  test('the hard floor and paths.exclude still prune a traversable directory', () => {
    const compiled = compileEligibilityConfig({
      include: ['**/*'],
      exclude: ['secrets/**']
    })

    // Both layers are evaluated before the include layer, so widening the
    // include layer cannot reach a directory either of them rejects.
    for (const directoryPath of ['node_modules', '.git', 'dist', 'secrets']) {
      expect(
        evaluatePathEligibility(directoryPath, compiled, 'directory')
      ).toMatchObject({ eligible: false })
    }
  })

  test('a file under an excluded pattern stays refused inside a traversable directory', () => {
    const compiled = compileEligibilityConfig({
      include: ['src/**/*'],
      exclude: ['src/generated/**']
    })

    expect(evaluatePathEligibility('src', compiled, 'directory')).toEqual({
      eligible: true
    })
    expect(
      evaluatePathEligibility('src/generated/api.ts', compiled, 'file')
    ).toMatchObject({
      eligible: false,
      reason: expect.stringContaining('paths.exclude')
    })
  })
})
