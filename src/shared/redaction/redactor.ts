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
  //
  // The look-behind is the difference between a credential and a coincidence, and
  // it was MEASURED: without it this pattern fired 76 times over this repository's
  // tracked files plus its installed dependencies (5,253 files, 52.3 MB) — every
  // one of them the tail of an ordinary hyphenated identifier that happens to
  // contain `sk-`, such as `task-context-source-chunk`, `mask-box-image-source`,
  // or `...-disk-counters-explained`. That was harmless while redaction only
  // touched logs and reports. Since the reviewed diff and every changed file's
  // content are redacted before they reach a packet, each match now replaces real
  // source with `[REDACTED]` in the text the model reviews.
  //
  // WHAT THIS TRADES, stated because a missed secret is the worse failure: a key
  // written with its `sk-` prefix glued straight onto a preceding identifier
  // character (`fetchTokensk-proj-...`) is no longer redacted. Every way a
  // credential is actually written down puts a non-identifier character in front
  // of it — assignment, quoting, JSON, a header name, a path separator, or the
  // start of a line — and those all still match.
  { pattern: /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{16,}/gu, replace: replaceWhole },
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

/**
 * A redaction result that says how much it changed.
 *
 * WHY THE COUNT EXISTS. Redaction has two very different consequences depending
 * on what it runs over. On a log line, a trace attribute or a report artifact it
 * is terminal and correct: a secret is hidden from a reader. On text bound for a
 * packet — the reviewed diff, a changed file's content — it is generative: the
 * model reasons about source the file does not contain, and every finding
 * downstream of that span is derived from fiction. The first case needs no
 * accounting. The second is an altered-context path, and this repository
 * discloses those rather than leaving the reader to wonder why a review said
 * something impossible.
 */
export type RedactionResult = {
  readonly text: string
  // Spans replaced, counted once per substitution — not once per pattern and not
  // once per file, because the question a reader has is "how much of what the
  // model read was not there".
  readonly redactionCount: number
}

export type Redactor = {
  readonly redact: (value: string) => string
  readonly redactWithCount: (value: string) => RedactionResult
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

  // One implementation, counted. `redact` discards the count rather than running
  // a second uncounted pass: two passes over the same patterns is exactly how the
  // reviewed diff came to be redacted on one path and not the other.
  const redactWithCount = (value: string): RedactionResult => {
    let redactedValue = value
    let redactionCount = 0
    const countOne = (): void => {
      redactionCount += 1
    }

    for (const pattern of exactSecretPatterns) {
      redactedValue = redactedValue.replace(pattern, () => {
        countOne()
        return redactionMarker
      })
    }

    for (const { pattern, replace } of builtInSecretPatterns) {
      redactedValue = redactedValue.replace(
        pattern,
        (match: string, ...groups: string[]): string => {
          countOne()
          return replace(match, ...groups)
        }
      )
    }

    return { text: redactedValue, redactionCount }
  }

  return {
    redact: (value) => redactWithCount(value).text,
    redactWithCount
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

const currentDefaultRedactor = (): Redactor => {
  const configuredSecrets = currentConfiguredExactSecrets()

  if (configuredSecrets !== defaultRedactorSecrets) {
    defaultRedactorSecrets = configuredSecrets
    defaultRedactor = createRedactor()
  }

  return defaultRedactor
}

export const redactText = (value: string): string =>
  currentDefaultRedactor().redact(value)

/**
 * `redactText`, with the count of what it replaced.
 *
 * For the seams that redact PACKET-BOUND text, where a substitution changes what
 * the model reviewed and therefore has to be disclosable. Everywhere else —
 * logs, traces, report artifacts — `redactText` is the right call: hiding a
 * secret from a reader needs no accounting.
 */
export const redactTextWithCount = (value: string): RedactionResult =>
  currentDefaultRedactor().redactWithCount(value)
