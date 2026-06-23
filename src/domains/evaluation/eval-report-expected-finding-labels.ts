export type ExpectedFindingLabelInput = {
  readonly path?: string | undefined
  readonly lineRange?: readonly [number, number] | undefined
  readonly matchMode?: 'path-line' | 'path-semantic' | 'semantic-only' | undefined
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

export const expectedMatchModeLabel = (
  expected: ExpectedFindingLabelInput
): 'path-line' | 'path-semantic' | 'semantic-only' =>
  expected.matchMode ??
  (expected.path === undefined
    ? 'semantic-only'
    : expected.lineRange === undefined
      ? 'path-semantic'
      : 'path-line')
