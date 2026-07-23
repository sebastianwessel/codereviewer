// Run-warning prefixes for provider issues surfaced during an eval run. A run
// warning carrying either prefix marks a case as provider-affected; the text
// after the prefix is the provider error/retry code.
//
// `provider-error:` — the review run terminated in a provider error.
// `eval-provider-retry:` — a transient provider error the eval harness retried
// past (the run recovered), recorded so recovered degradation stays visible.
export const PROVIDER_ERROR_WARNING_PREFIX = 'provider-error:'
export const EVAL_PROVIDER_RETRY_WARNING_PREFIX = 'eval-provider-retry:'

// `eval-inconclusive-match:` — the semantic judge could not decide N
// expected/finding pairs for the case. Those pairs left both the recall and the
// precision denominator, so the case's quality numbers cover fewer pairs than
// the case declares. The judge failure itself is reported as a provider issue.
export const EVAL_INCONCLUSIVE_MATCH_WARNING_PREFIX = 'eval-inconclusive-match:'

export const inconclusiveMatchWarnings = (
  inconclusiveMatchCount: number
): readonly string[] =>
  inconclusiveMatchCount === 0
    ? []
    : [`${EVAL_INCONCLUSIVE_MATCH_WARNING_PREFIX}${inconclusiveMatchCount}`]

export const isProviderIssueWarning = (warning: string): boolean =>
  warning.startsWith(PROVIDER_ERROR_WARNING_PREFIX) ||
  warning.startsWith(EVAL_PROVIDER_RETRY_WARNING_PREFIX)
