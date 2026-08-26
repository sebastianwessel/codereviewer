import { describe, expect, it } from 'vitest'
import { checkProviderCredentials } from './provider-credentials.js'

describe('checkProviderCredentials', () => {
  it('reports an unconfigured provider rather than letting the review pass empty', () => {
    expect(checkProviderCredentials({})).toEqual({
      ready: false,
      missing: ['CODEREVIEWER_PROVIDER_ID', 'CODEREVIEWER_PROVIDER_MODEL']
    })
  })

  it('accepts a complete openai configuration', () => {
    expect(
      checkProviderCredentials({
        CODEREVIEWER_PROVIDER_ID: 'openai',
        CODEREVIEWER_PROVIDER_MODEL: 'a-model',
        OPENAI_API_KEY: 'secret-value'
      })
    ).toEqual({
      ready: true,
      providerId: 'openai',
      model: 'a-model',
      missing: []
    })
  })

  it('names the missing variable without ever reading its value', () => {
    const status = checkProviderCredentials({
      CODEREVIEWER_PROVIDER_ID: 'openai',
      CODEREVIEWER_PROVIDER_MODEL: 'a-model'
    })

    expect(status.ready).toBe(false)
    expect(status.missing).toEqual(['OPENAI_API_KEY'])
    expect(JSON.stringify(status)).not.toContain('secret')
  })

  it('treats an empty string as unset, which is what a missing secret expands to', () => {
    // On a fork pull request `${{ secrets.X }}` expands to the empty string. A
    // truthiness check on presence alone would call that configured.
    expect(
      checkProviderCredentials({
        CODEREVIEWER_PROVIDER_ID: 'openai',
        CODEREVIEWER_PROVIDER_MODEL: 'a-model',
        OPENAI_API_KEY: ''
      }).ready
    ).toBe(false)
  })

  it('requires a base URL for an openai-compatible endpoint', () => {
    expect(
      checkProviderCredentials({
        CODEREVIEWER_PROVIDER_ID: 'openai-compatible',
        CODEREVIEWER_PROVIDER_MODEL: 'a-model',
        OPENAI_API_KEY: 'k'
      }).missing
    ).toEqual(['CODEREVIEWER_PROVIDER_BASE_URL'])
  })

  it('accepts bedrock through OIDC without static access keys', () => {
    expect(
      checkProviderCredentials({
        CODEREVIEWER_PROVIDER_ID: 'bedrock',
        CODEREVIEWER_PROVIDER_MODEL: 'a-model',
        AWS_REGION: 'eu-central-1',
        AWS_ROLE_ARN: 'arn:aws:iam::1:role/r',
        AWS_WEB_IDENTITY_TOKEN_FILE: '/tmp/token'
      }).ready
    ).toBe(true)
  })

  it('falls back to static keys for bedrock when there is no web identity', () => {
    expect(
      checkProviderCredentials({
        CODEREVIEWER_PROVIDER_ID: 'bedrock',
        CODEREVIEWER_PROVIDER_MODEL: 'a-model',
        AWS_REGION: 'eu-central-1'
      }).missing
    ).toEqual(['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'])
  })

  it('rejects a provider id the engine does not implement', () => {
    expect(
      checkProviderCredentials({
        CODEREVIEWER_PROVIDER_ID: 'llamafile',
        CODEREVIEWER_PROVIDER_MODEL: 'a-model'
      })
    ).toEqual({
      ready: false,
      providerId: 'llamafile',
      missing: ['CODEREVIEWER_PROVIDER_ID']
    })
  })
})
