import { afterEach, describe, expect, test } from 'vitest'
import { setConfiguredExactSecrets } from './configured-secrets.js'
import { createRedactor, redactText } from './redactor.js'

describe('redactor', () => {
  test('redacts approved built-in token formats', () => {
    const input = [
      'Authorization: Bearer bearer-token-value',
      'Authorization: Basic dXNlcjpwYXNz',
      'openai=sk-proj-abcdefghijklmnopqrstuvwxyz123456',
      'github=ghp_abcdefghijklmnopqrstuvwxyz1234567890',
      'gitlab=glpat-abcdefghijklmnopqrstuvwxyz',
      'aws=AKIAIOSFODNN7EXAMPLE'
    ].join('\n')

    const redacted = redactText(input)

    expect(redacted).not.toContain('bearer-token-value')
    expect(redacted).not.toContain('dXNlcjpwYXNz')
    expect(redacted).not.toContain('sk-proj-abcdefghijklmnopqrstuvwxyz123456')
    expect(redacted).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz1234567890')
    expect(redacted).not.toContain('glpat-abcdefghijklmnopqrstuvwxyz')
    expect(redacted).not.toContain('AKIAIOSFODNN7EXAMPLE')
    expect(redacted).toContain('[REDACTED]')
  })

  test('redacts additional enterprise credential formats', () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['github_pat=github_pat_11ABCDEFG0abcdefghij_KLMNOPqrstuvWX', 'github_pat_'],
      [
        'jwt=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N',
        'eyJzdWIi'
      ],
      [`google=AIza${'a'.repeat(35)}`, `AIza${'a'.repeat(35)}`],
      ['slack=xoxb-1234567890-abcdefghijklmnop', 'xoxb-'],
      ['aws_secret_access_key=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', 'wJalrXUtnFEMI']
    ]

    for (const [input, secretFragment] of cases) {
      const redacted = redactText(input)
      expect(redacted).not.toContain(secretFragment)
      expect(redacted).toContain('[REDACTED]')
    }
  })

  test('redacts credentials embedded in URLs but keeps the scheme', () => {
    const redacted = redactText('db=postgres://admin:S3cretP4ss@db.internal:5432/app')

    expect(redacted).not.toContain('S3cretP4ss')
    expect(redacted).not.toContain('admin:')
    expect(redacted).toContain('postgres://[REDACTED]@')
  })

  test('stays linear on a long URL-like line without backtracking (ReDoS guard)', () => {
    // A long `http://` line that never reaches a terminating `@` would trigger
    // catastrophic backtracking with unbounded quantifiers. With bounded
    // quantifiers it returns promptly.
    const input = `// "http://${'a'.repeat(200_000)}:x"`
    const start = process.hrtime.bigint()
    const redacted = redactText(input)
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000

    expect(typeof redacted).toBe('string')
    expect(elapsedMs).toBeLessThan(1000)
  })

  test('redacts PEM private key blocks', () => {
    const pem = [
      '-----BEGIN RSA PRIVATE KEY-----',
      'MIIEdummyKeyMaterialAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      '-----END RSA PRIVATE KEY-----'
    ].join('\n')

    const redacted = redactText(pem)

    expect(redacted).not.toContain('dummyKeyMaterial')
    expect(redacted).toContain('[REDACTED]')
  })

  // The configured secrets are process state (see `configured-secrets.ts`), so
  // every seam gets them without being handed options — which is the only reason
  // the capability is reachable at all, since no seam that redacts takes any.
  describe('the configured exact secrets', () => {
    afterEach(() => {
      setConfiguredExactSecrets([])
    })

    test('reach a redactor built with no options, and the shared one', () => {
      setConfiguredExactSecrets(['ACME-INTERNAL-9d41f0c2b7'])

      expect(createRedactor().redact('token=ACME-INTERNAL-9d41f0c2b7')).toBe(
        'token=[REDACTED]'
      )
      expect(redactText('token=ACME-INTERNAL-9d41f0c2b7')).toBe(
        'token=[REDACTED]'
      )
    })

    test('replace the previous list rather than accumulating', () => {
      setConfiguredExactSecrets(['first-secret-value'])
      expect(redactText('first-secret-value')).toBe('[REDACTED]')

      // The shared redactor caches its compiled patterns; a policy change has to
      // invalidate that cache, or the first configuration read would hold for the
      // whole process.
      setConfiguredExactSecrets(['second-secret-value'])
      expect(redactText('first-secret-value')).toBe('first-secret-value')
      expect(redactText('second-secret-value')).toBe('[REDACTED]')
    })

    test('apply alongside the built-in patterns, not instead of them', () => {
      setConfiguredExactSecrets(['configured-secret-value'])

      expect(
        createRedactor().redact(
          'a=configured-secret-value\nAuthorization: Bearer abc'
        )
      ).toBe('a=[REDACTED]\nAuthorization: Bearer [REDACTED]')
    })
  })
})
