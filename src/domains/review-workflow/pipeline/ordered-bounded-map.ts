export const mapWithBoundedConcurrencyInOrder = async <TInput, TOutput>(
  input: {
    readonly items: readonly TInput[]
    readonly concurrency: number
    readonly mapItem: (item: TInput) => Promise<TOutput>
  }
): Promise<readonly TOutput[]> => {
  if (input.items.length === 0) {
    return []
  }

  const results = new Array<TOutput>(input.items.length)
  const workerCount = Math.max(
    1,
    Math.min(input.concurrency, input.items.length)
  )
  let nextIndex = 0

  const runWorker = async (): Promise<void> => {
    while (nextIndex < input.items.length) {
      const index = nextIndex
      nextIndex += 1
      const item = input.items[index]

      if (item === undefined) {
        continue
      }

      results[index] = await input.mapItem(item)
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()))

  return results
}
