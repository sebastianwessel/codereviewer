import { hydrateRealRepoCorpus } from '../src/domains/evaluation/real-repo-corpus-hydration.js'

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
  const manifestPath = valueAfter(args, '--manifest')
  const outputSliceRoot = valueAfter(args, '--output-slice-root')
  const caseFilters = valuesAfter(args, '--case')
  const result = await hydrateRealRepoCorpus({
    repositoryRoot: process.cwd(),
    ...(manifestPath === undefined ? {} : { manifestPath }),
    ...(outputSliceRoot === undefined ? {} : { outputSliceRoot }),
    ...(caseFilters.length === 0 ? {} : { caseFilters }),
    ...(force ? { force } : {}),
    ...(quiet ? {} : { log: (message) => console.error(message) })
  })

  if (!quiet) {
    console.error(
      `Hydrated ${result.hydratedCaseCount}, repaired ${result.repairedCaseCount}, reused ${result.cachedCaseCount}, and pruned ${result.prunedCaseIds.length} real-repository corpus checkouts in ${result.outputSliceRoot}.`
    )
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  }
}

await main()
