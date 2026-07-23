// Run-warning prefixes for provider issues surfaced during an eval run. A run
// warning carrying either prefix marks a case as provider-affected; the text
// after the prefix is the provider error/retry code.
//
// `provider-error:` — the review run terminated in a provider error.
// `eval-provider-retry:` — a transient provider error the eval harness retried
// past (the run recovered), recorded so recovered degradation stays visible.
export const PROVIDER_ERROR_WARNING_PREFIX = 'provider-error:'
export const EVAL_PROVIDER_RETRY_WARNING_PREFIX = 'eval-provider-retry:'

export const isProviderIssueWarning = (warning: string): boolean =>
  warning.startsWith(PROVIDER_ERROR_WARNING_PREFIX) ||
  warning.startsWith(EVAL_PROVIDER_RETRY_WARNING_PREFIX)
