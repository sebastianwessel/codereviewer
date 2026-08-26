import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { setConfiguredExactSecrets } from '../../shared/redaction/configured-secrets.js'
import { redactText } from '../../shared/redaction/redactor.js'
import { createContextRetriever } from '../context-retrieval/index.js'
import { loadCodeReviewerConfig } from './config-loader.js'

// Spec 07's minimum redaction pattern list ends with "user-configured exact
// secret values". The redactor has accepted them since it was written; nothing
// could supply them, so the last line of the security floor was unreachable in
// production. These tests drive the real path — a configuration file, a real
// environment, and a seam that redacts — because the unit test the capability
// already had passed for years while no operator could reach it.
describe('configured exact-secret redaction', () => {
  let repositoryRoot: string

  beforeEach(async () => {
    repositoryRoot = await mkdtemp(path.join(tmpdir(), 'secret-redaction-'))
    await mkdir(path.join(repositoryRoot, '.codereviewer'), { recursive: true })
    await mkdir(path.join(repositoryRoot, 'src'), { recursive: true })
  })

  afterEach(async () => {
    // The policy is process state; leaving one test's secrets in place would
    // silently redact another's fixtures.
    setConfiguredExactSecrets([])
    await rm(repositoryRoot, { recursive: true, force: true })
  })

  const writeConfig = async (config: unknown): Promise<void> => {
    await writeFile(
      path.join(repositoryRoot, '.codereviewer', 'config.json'),
      JSON.stringify(config),
      'utf8'
    )
  }

  test('redacts a configured secret at the mediated read seam', async () => {
    // An org-specific credential shape no built-in pattern recognises.
    const secret = 'ACME-INTERNAL-9d41f0c2b7'

    await writeConfig({
      security: { redaction: { secretEnvVars: ['ACME_DEPLOY_TOKEN'] } }
    })
    await writeFile(
      path.join(repositoryRoot, 'src', 'app.ts'),
      `export const deployToken = '${secret}'\n`,
      'utf8'
    )

    await loadCodeReviewerConfig({
      repositoryRoot,
      environment: { ACME_DEPLOY_TOKEN: secret },
      loadDotEnv: false
    })

    // The mediated reader every agent tool and every context stage goes through.
    const result = await createContextRetriever({
      repositoryRoot
    }).readRepositoryFile({ path: 'src/app.ts' })

    expect(result.content).not.toContain(secret)
    expect(result.content).toContain('[REDACTED]')
    // The seam's own evidence record says redaction happened, so the run's audit
    // trail carries the fact and not just the redacted bytes.
    expect(result.evidence.redactionApplied).toBe(true)
    // And the shared default redactor, which reporting and error normalization
    // use without constructing anything.
    expect(redactText(`token=${secret}`)).toBe('token=[REDACTED]')
  })

  test('fails the run when a named variable is unset instead of redacting nothing', async () => {
    await writeConfig({
      security: { redaction: { secretEnvVars: ['ACME_DEPLOY_TOKEN'] } }
    })

    await expect(
      loadCodeReviewerConfig({
        repositoryRoot,
        environment: {},
        loadDotEnv: false
      })
    ).rejects.toMatchObject({
      code: 'redaction_secret_env_unset',
      category: 'config'
    })
  })

  test('rejects a value too short to redact without mangling every artifact', async () => {
    await writeConfig({
      security: { redaction: { secretEnvVars: ['ACME_DEPLOY_TOKEN'] } }
    })

    const rejection = loadCodeReviewerConfig({
      repositoryRoot,
      environment: { ACME_DEPLOY_TOKEN: 'dev' },
      loadDotEnv: false
    })

    await expect(rejection).rejects.toMatchObject({
      code: 'redaction_secret_env_too_short',
      category: 'config'
    })
    // The variable is named; its value never is.
    await expect(rejection).rejects.toMatchObject({
      message: expect.not.stringContaining('dev') as unknown as string
    })
  })

  test('leaves redaction exactly as it was when nothing is configured', async () => {
    const secret = 'ACME-INTERNAL-9d41f0c2b7'
    setConfiguredExactSecrets([secret])
    await writeConfig({})

    await loadCodeReviewerConfig({
      repositoryRoot,
      environment: { ACME_DEPLOY_TOKEN: secret },
      loadDotEnv: false
    })

    // An absent list is not "keep whatever was configured before": it is the
    // built-in floor and nothing else, which is what every run did before this
    // key existed.
    expect(redactText(`token=${secret}`)).toBe(`token=${secret}`)
    expect(redactText('Authorization: Bearer abc')).toBe(
      'Authorization: Bearer [REDACTED]'
    )
  })
})
