export const selectDisplayName = (
  preferredName: string | undefined,
  fallbackName: string
): string => {
  return preferredName ?? fallbackName
}
