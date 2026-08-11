import { currentConfiguredExactSecrets } from './configured-secrets.js'

const redactionMarker = '[REDACTED]'

type SecretPattern = {
  readonly pattern: RegExp
  readonly replace: (match: string, ...groups: string[]) => string
}

// Replace the whole match with the marker.
const replaceWhole = (): string => redactionMarker

// Preserve a non-secret prefix (e.g. `Authorization: Bearer `, a URL scheme)
// captured as group 1 and redact the remainder.
const replacePrefix = (_match: string, prefix: string): string =>
  typeof prefix === 'string' && prefix.length > 0
    ? `${prefix}${redactionMarker}`
    : redactionMarker

// Built-in patterns cover the spec-mandated minimum (auth headers, OpenAI `sk-`
// keys, GitHub PAT formats, GitLab tokens, AWS access key IDs, user-configured
// exact secrets) plus additional high-confidence enterprise credential formats.
// The list is a security floor, not a complete classifier; configured exact
// secrets remain the escape hatch for org-specific token shapes.
const builtInSecretPatterns: readonly SecretPattern[] = [
  // Bearer/Basic authorization headers.
  {
    pattern: /(Authorization\s*:\s*(?:Bearer|Basic)\s+)[^\r\n]+/giu,
    replace: replacePrefix
  },
  // Credentials embedded in a URL userinfo component (scheme://user:pass@host).
  // The scheme body and both userinfo segments are length-bounded so the pattern
  // stays effectively linear: an unbounded scheme body would backtrack
  // quadratically over a long run of scheme-class characters in untrusted source.
  {
    pattern: /([a-z][a-z0-9+.-]{0,31}:\/\/)[^\s:/@]{1,256}:[^\s/@]{1,256}@/giu,
    replace: (_match, scheme: string) => `${scheme}${redactionMarker}@`
  },
  // PEM-encoded private key blocks.
  {
    pattern:
      /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z]+ )?PRIVATE KEY-----/gu,
    replace: replaceWhole
  },
  // JSON Web Tokens.
  {
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/gu,
    replace: replaceWhole
  },
  // OpenAI-style keys (sk-, sk-proj-, ...).
  { pattern: /sk-[A-Za-z0-9_-]{16,}/gu, replace: replaceWhole },
  // GitHub PAT prefixes (ghp_, gho_, ghu_, ghs_, ghr_) and OAuth tokens.
  { pattern: /gh[opusr]_[A-Za-z0-9_]{20,}/gu, replace: replaceWhole },
  // GitHub fine-grained PATs.
  { pattern: /github_pat_[A-Za-z0-9_]{20,}/gu, replace: replaceWhole },
  // GitLab personal access tokens.
  { pattern: /glpat-[A-Za-z0-9_-]{16,}/gu, replace: replaceWhole },
  // Slack token prefixes.
  { pattern: /xox[abprs]-[A-Za-z0-9-]{10,}/gu, replace: replaceWhole },
  // Google API keys.
  { pattern: /\bAIza[0-9A-Za-z_-]{35}\b/gu, replace: replaceWhole },
  // AWS access key IDs.
  { pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu, replace: replaceWhole },
  // AWS secret access keys when paired with a recognizable key name.
  {
    pattern:
      /((?:aws[_-]?)?secret[_-]?access[_-]?key\s*[=:]\s*["']?)[A-Za-z0-9/+]{40}/giu,
    replace: replacePrefix
  }
] as const

export type Redactor = {
  readonly redact: (value: string) => string
}

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')

const createExactSecretPatterns = (
  exactSecrets: readonly string[]
): readonly RegExp[] =>
  exactSecrets
    .filter((secret) => secret.length > 0)
    .map((secret) => new RegExp(escapeRegExp(secret), 'gu'))

// Every redactor gets the run's configured secrets. There is deliberately no
// per-call way to add more: an operator naming a secret names it for the run, and
// a seam that builds its own redactor is not opting out of the security floor.
// One option used to exist, reachable only through `normalizeError`, and no
// production caller ever passed it — a second unreachable path to the same
// capability is not a second capability.
export const createRedactor = (): Redactor => {
  const exactSecretPatterns = createExactSecretPatterns(
    currentConfiguredExactSecrets()
  )

  return {
    redact: (value) => {
      let redactedValue = value

      for (const pattern of exactSecretPatterns) {
        redactedValue = redactedValue.replace(pattern, redactionMarker)
      }

      for (const { pattern, replace } of builtInSecretPatterns) {
        redactedValue = redactedValue.replace(pattern, replace)
      }

      return redactedValue
    }
  }
}

// The shared redactor behind `redactText`, rebuilt when — and only when — the
// configured secrets change. It cannot simply be built once at module load: this
// module is imported long before configuration is read, so a redactor frozen
// there would compile the empty policy and hold it for the whole process, which
// is a quieter version of the unreachable capability this exists to fix.
// Rebuilding per call instead would recompile every pattern for every string
// redacted, and redaction runs over whole files.
let defaultRedactorSecrets = currentConfiguredExactSecrets()
let defaultRedactor = createRedactor()

export const redactText = (value: string): string => {
  const configuredSecrets = currentConfiguredExactSecrets()

  if (configuredSecrets !== defaultRedactorSecrets) {
    defaultRedactorSecrets = configuredSecrets
    defaultRedactor = createRedactor()
  }

  return defaultRedactor.redact(value)
}
