import { hydrateIntentCorpus } from '../src/domains/evaluation/index.js'

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
  const outputRoot = valueAfter(args, '--output-root')
  const caseFilters = valuesAfter(args, '--case')
  const result = await hydrateIntentCorpus({
    repositoryRoot: process.cwd(),
    ...(manifestPath === undefined ? {} : { manifestPath }),
    ...(outputRoot === undefined ? {} : { outputRoot }),
    ...(caseFilters.length === 0 ? {} : { caseFilters }),
    ...(force ? { force } : {}),
    ...(quiet ? {} : { log: (message) => console.error(message) })
  })

  if (!quiet) {
    console.error(
      `Hydrated ${result.hydratedCaseCount} and reused ${result.cachedCaseCount} intent corpus checkout(s), and pruned ${result.prunedCaseIds.length}, in ${result.outputRoot}.`
    )
    console.error(
      `${result.outstandingExpectationCount} enumerated outstanding obligation(s) by arm: ${JSON.stringify(result.outstandingExpectationsByArm)}.`
    )
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  }
}

await main()
