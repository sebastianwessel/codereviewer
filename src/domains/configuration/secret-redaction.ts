import type { CodeReviewerConfig } from '../../shared/contracts/index.js'
import { createStructuredError } from '../../shared/errors/error-normalizer.js'
import { setConfiguredExactSecrets } from '../../shared/redaction/configured-secrets.js'

// Resolves `security.redaction.secretEnvVars` against the environment and hands
// the values to the process redaction policy.
//
// This is the ONLY place a secret value crosses from the environment into the
// redactor, and it is deliberately the place where configuration and environment
// are both already in hand (`loadCodeReviewerConfig`). Every entry point — each
// CLI command, and a library consumer calling the loader directly — passes
// through there, so no caller can reach a review with the policy unapplied.

// Shortest value accepted for an exact-secret pattern.
//
// A pattern is a literal substring replacement applied to every artifact, so a
// short value is not a weak redaction, it is a destructive one: `DEBUG=1` named
// by mistake would turn every `1` in every report into `[REDACTED]`. Eight
// characters is below every credential format in the built-in floor and above
// anything that could only be a flag or a version, so it separates a plausible
// secret from a mistake without judging the secret's strength.
const minimumSecretLength = 8

const resolveSecretValue = (
  environmentVariable: string,
  environment: Readonly<Record<string, string | undefined>>
): string => {
  // Trimmed because a value read from a file or a here-doc carries a trailing
  // newline that is an artifact of how it was set, not part of the secret;
  // redacting the trimmed core still removes the untrimmed occurrence.
  const value = environment[environmentVariable]?.trim() ?? ''

  if (value.length === 0) {
    throw createStructuredError({
      code: 'redaction_secret_env_unset',
      message: `security.redaction.secretEnvVars names "${environmentVariable}", but that environment variable is unset or empty. Set it, or remove the name: a run cannot promise to redact a value it was never given.`,
      category: 'config',
      details: { environmentVariable }
    })
  }

  if (value.length < minimumSecretLength) {
    throw createStructuredError({
      code: 'redaction_secret_env_too_short',
      message: `security.redaction.secretEnvVars names "${environmentVariable}", whose value is shorter than ${minimumSecretLength} characters. A value that short is redacted everywhere it occurs and would corrupt the output rather than protect it.`,
      category: 'config',
      details: { environmentVariable, minimumSecretLength }
    })
  }

  return value
}

/**
 * Applies the configured exact secrets for this process.
 *
 * Always called, including when nothing is configured: an empty list is the
 * ground state, and setting it is what keeps a previous configuration from
 * outliving the config that named it.
 *
 * Throws a structured `config` error (exit 2) when a named variable is unset,
 * empty, or too short. Neither message nor details ever carry the value.
 */
export const applyConfiguredSecretRedaction = (input: {
  readonly config: CodeReviewerConfig
  readonly environment: Readonly<Record<string, string | undefined>>
}): void => {
  setConfiguredExactSecrets(
    input.config.security.redaction.secretEnvVars.map((environmentVariable) =>
      resolveSecretValue(environmentVariable, input.environment)
    )
  )
}
