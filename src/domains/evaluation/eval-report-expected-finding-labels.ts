// Shared label formatting for expected findings in eval Markdown reports. These
// helpers read the SAVED report contract, where `matchMode` is already resolved,
// so they never re-derive it — `resolveExpectedFindingMatchMode` in
// `eval-fixture.schema.ts` is the single derivation site.
export type ExpectedFindingLabelInput = {
  readonly path?: string | undefined
  readonly lineRange?: readonly [number, number] | undefined
}

export const formatLineRange = (
  lineRange: readonly [number, number] | undefined
): string => {
  if (lineRange === undefined) {
    return ''
  }

  const [startLine, endLine] = lineRange
  return startLine === endLine ? `:${startLine}` : `:${startLine}-${endLine}`
}

export const expectedLocationLabel = (
  expected: ExpectedFindingLabelInput
): string =>
  expected.path === undefined
    ? '(semantic-only)'
    : `${expected.path}${formatLineRange(expected.lineRange)}`
