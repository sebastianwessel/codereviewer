import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { createClaimsFileProvider } from './claims-file-provider.js'
import { MAX_CLAIMS_PER_PROVIDER } from './contracts.js'

const gatherInput = (repositoryRoot: string) => ({ repositoryRoot })

const validClaim = (index: number) => ({
  id: `claim_${index.toString(16).padStart(8, '0')}`,
  kind: 'analyzer',
  title: `Analyzer finding ${index}`,
  detail: 'A detailed description of the analyzer finding under test.',
  source: 'analyzer:codeql',
  question: 'Is this analyzer finding an actual issue reachable at runtime?'
})

describe('claims-file provider', () => {
  test('reads and redacts claims from a valid claims file', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codereviewer-claims-'))

    try {
      await mkdir(path.join(root, '.codereviewer'), { recursive: true })
      await writeFile(
        path.join(root, '.codereviewer', 'claims.json'),
        JSON.stringify([
          {
            ...validClaim(1),
            detail: 'Leaked token sk-abcdef0123456789abcdef0123 found in config.'
          }
        ])
      )

      const provider = createClaimsFileProvider({
        type: 'claims-file',
        path: '.codereviewer/claims.json'
      })

      const claims = await provider.gather(gatherInput(root))
      expect(claims).toHaveLength(1)
      expect(claims[0]).toMatchObject({ id: 'claim_00000001', kind: 'analyzer' })
      expect(claims[0]?.detail).toContain('[REDACTED]')
      expect(claims[0]?.detail).not.toContain('sk-abcdef')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('yields no claims when the claims file is missing', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codereviewer-claims-'))

    try {
      const provider = createClaimsFileProvider({
        type: 'claims-file',
        path: '.codereviewer/claims.json'
      })

      expect(await provider.gather(gatherInput(root))).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('skips an individual entry that fails claim validation but keeps the rest', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codereviewer-claims-'))

    try {
      await writeFile(
        path.join(root, 'claims.json'),
        JSON.stringify([validClaim(1), { id: 'not-a-claim-id', kind: 'analyzer' }, validClaim(2)])
      )

      const provider = createClaimsFileProvider({ type: 'claims-file', path: 'claims.json' })
      const claims = await provider.gather(gatherInput(root))

      expect(claims.map((claim) => claim.id)).toEqual(['claim_00000001', 'claim_00000002'])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('a claims file that is not valid JSON is a genuine failure and throws', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codereviewer-claims-'))

    try {
      await writeFile(path.join(root, 'claims.json'), 'not json')

      const provider = createClaimsFileProvider({ type: 'claims-file', path: 'claims.json' })
      await expect(provider.gather(gatherInput(root))).rejects.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('bounds the number of claims read from a single file', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codereviewer-claims-'))

    try {
      const claims = Array.from({ length: MAX_CLAIMS_PER_PROVIDER + 10 }, (_, index) =>
        validClaim(index)
      )
      await writeFile(path.join(root, 'claims.json'), JSON.stringify(claims))

      const provider = createClaimsFileProvider({ type: 'claims-file', path: 'claims.json' })
      const result = await provider.gather(gatherInput(root))

      expect(result).toHaveLength(MAX_CLAIMS_PER_PROVIDER)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
