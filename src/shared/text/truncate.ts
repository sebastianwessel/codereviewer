// Shared truncation for model-authored text that crosses into a length-capped
// contract field. Reuse this at every model->contract boundary instead of inline
// `.slice(0, n)` copies so a model summary that exceeds a destination cap cannot
// fail schema validation (the source of past `provider_error`-masked failures).
export const truncateForContract = (value: string, maxLength: number): string =>
  value.length <= maxLength ? value : value.slice(0, maxLength)
