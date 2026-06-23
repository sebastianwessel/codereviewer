import { hydrateCodeReviewBenchmarkPack } from '../src/domains/evaluation/benchmark-hydration.js'

const valueAfter = (args: readonly string[], flag: string): string | undefined => {
  const index = args.indexOf(flag)

  return index === -1 ? undefined : args[index + 1]
}

const valuesAfter = (args: readonly string[], flag: string): readonly string[] =>
  args.flatMap((arg, index) => (arg === flag && args[index + 1] !== undefined ? [args[index + 1]] : []))

const main = async (): Promise<void> => {
  const args = process.argv.slice(2)
  const quiet = args.includes('--quiet')
  const force = args.includes('--force')
  const sourceSliceRoot = valueAfter(args, '--source-slice-root')
  const outputSliceRoot = valueAfter(args, '--output-slice-root')
  const caseFilters = valuesAfter(args, '--case')
  const result = await hydrateCodeReviewBenchmarkPack({
    repositoryRoot: process.cwd(),
    ...(sourceSliceRoot === undefined ? {} : { sourceSliceRoot }),
    ...(outputSliceRoot === undefined ? {} : { outputSliceRoot }),
    ...(caseFilters.length === 0 ? {} : { caseFilters }),
    ...(force ? { force } : {}),
    ...(quiet ? {} : { log: (message) => console.error(message) })
  })

  if (!quiet) {
    console.error(
      `Hydrated ${result.hydratedCaseCount} benchmark cases and copied ${result.copiedCaseCount} local cases to ${result.outputSliceRoot}.`
    )
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  }
}

await main()
