import { describe, expect, test } from 'vitest'
import { err, isErr, isOk, mapResult, ok } from './result.js'

describe('result helper', () => {
  test('creates typed success results', () => {
    const result = ok({ path: 'src/index.ts' })

    expect(isOk(result)).toBe(true)
    expect(isErr(result)).toBe(false)
    expect(result.value.path).toBe('src/index.ts')
  })

  test('creates typed failure results', () => {
    const result = err({
      code: 'path_rejected',
      message: 'Path escapes root'
    })

    expect(isErr(result)).toBe(true)
    expect(isOk(result)).toBe(false)
    expect(result.error.code).toBe('path_rejected')
  })

  test('maps success values without changing failures', () => {
    expect(mapResult(ok(2), (value) => value * 2)).toEqual(ok(4))

    const failure = err('denied')
    expect(mapResult(failure, (value: number) => value * 2)).toBe(failure)
  })
})
