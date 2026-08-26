// Pre-flight check for the provider configuration, run before anything is
// spawned.
//
// The failure this exists to prevent is the quiet one. Without a provider the
// engine still runs, still writes a report, and still exits 0 — it simply has no
// model lane, so it finds nothing. A workflow wired as a required check would
// then report a green tick for every pull request, forever, and the first person
// to notice would be whoever shipped the defect it never looked for.
//
// So a missing provider is treated as a configuration error and fails the job,
// with the names of the variables to set. It never prints, hashes, or otherwise
// derives anything from a secret's VALUE — only whether the name is set to a
// non-empty string.

export type ProviderCredentialStatus = {
  readonly ready: boolean
  readonly providerId?: string
  readonly model?: string
  /** Environment variable names that must be set. Names only, never values. */
  readonly missing: readonly string[]
}

const isSet = (
  environment: Readonly<Record<string, string | undefined>>,
  name: string
): boolean => {
  const value = environment[name]

  return value !== undefined && value.trim().length > 0
}

// Credential variables per provider id, mirroring
// docs/06-reference/environment.md. `bedrock` accepts either static keys or the
// OIDC web-identity pair, because a workflow using OpenID Connect (which is the
// recommended shape) sets neither access key.
const requiredCredentials = (
  providerId: string,
  environment: Readonly<Record<string, string | undefined>>
): readonly string[] => {
  switch (providerId) {
    case 'openai':
      return ['OPENAI_API_KEY']
    case 'openai-compatible':
      return ['OPENAI_API_KEY', 'CODEREVIEWER_PROVIDER_BASE_URL']
    case 'azure':
      return ['AZURE_AI_ENDPOINT', 'AZURE_AI_API_KEY']
    case 'bedrock': {
      const hasWebIdentity =
        isSet(environment, 'AWS_ROLE_ARN') &&
        isSet(environment, 'AWS_WEB_IDENTITY_TOKEN_FILE')

      return hasWebIdentity
        ? ['AWS_REGION']
        : ['AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY']
    }
    default:
      return []
  }
}

const knownProviderIds = new Set([
  'openai',
  'openai-compatible',
  'bedrock',
  'azure'
])

export const checkProviderCredentials = (
  environment: Readonly<Record<string, string | undefined>>
): ProviderCredentialStatus => {
  const providerId = environment.CODEREVIEWER_PROVIDER_ID?.trim() ?? ''
  const model = environment.CODEREVIEWER_PROVIDER_MODEL?.trim() ?? ''

  if (providerId.length === 0) {
    return {
      ready: false,
      missing: ['CODEREVIEWER_PROVIDER_ID', 'CODEREVIEWER_PROVIDER_MODEL']
    }
  }

  if (!knownProviderIds.has(providerId)) {
    return {
      ready: false,
      providerId,
      missing: ['CODEREVIEWER_PROVIDER_ID']
    }
  }

  const missing = [
    ...(model.length === 0 ? ['CODEREVIEWER_PROVIDER_MODEL'] : []),
    ...requiredCredentials(providerId, environment).filter(
      (name) => !isSet(environment, name)
    )
  ]

  return {
    ready: missing.length === 0,
    providerId,
    ...(model.length === 0 ? {} : { model }),
    missing
  }
}
