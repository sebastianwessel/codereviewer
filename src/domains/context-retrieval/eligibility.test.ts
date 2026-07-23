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
