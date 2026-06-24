import { describe, expect, test } from 'vitest'
import { mapWithBoundedConcurrencyInOrder } from './ordered-bounded-map.js'

const deferred = <T>(): {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
} => {
  let resolvePromise: (value: T) => void = () => undefined
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })

  return {
    promise,
    resolve: resolvePromise
  }
}

const flushPromises = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
}

describe('workflow ordered bounded map', () => {
  test('limits active work while preserving input order', async () => {
    const completions = [deferred<string>(), deferred<string>(), deferred<string>()]
    const started: number[] = []
    let active = 0
    let maxActive = 0

    const mapped = mapWithBoundedConcurrencyInOrder({
      items: [0, 1, 2],
      concurrency: 2,
      mapItem: async (item) => {
        started.push(item)
        active += 1
        maxActive = Math.max(maxActive, active)
        const completion = completions[item]

        if (completion === undefined) {
          throw new Error(`missing completion ${item}`)
        }

        const result = await completion.promise
        active -= 1

        return result
      }
    })

    await flushPromises()
    expect(started).toEqual([0, 1])
    expect(maxActive).toBe(2)

    completions[1]?.resolve('second')
    await flushPromises()
    expect(started).toEqual([0, 1, 2])

    completions[2]?.resolve('third')
    completions[0]?.resolve('first')

    await expect(mapped).resolves.toEqual(['first', 'second', 'third'])
  })

  test('handles empty inputs without starting workers', async () => {
    await expect(
      mapWithBoundedConcurrencyInOrder({
        items: [],
        concurrency: 4,
        mapItem: async () => 'unused'
      })
    ).resolves.toEqual([])
  })

  test('propagates mapper errors', async () => {
    const error = new Error('provider failed')

    await expect(
      mapWithBoundedConcurrencyInOrder({
        items: ['a'],
        concurrency: 1,
        mapItem: async () => {
          throw error
        }
      })
    ).rejects.toBe(error)
  })
})
