#!/usr/bin/env tsx

/**
 * Sync the bundled LiteLLM OpenAI model pricing snapshot.
 *
 * Usage:
 *   npx tsx scripts/update-model-pricing.ts          # check only, show diff
 *   npx tsx scripts/update-model-pricing.ts --write  # apply changes
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const upstreamUrl =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'
const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const snapshotPath = resolve(
  workspaceRoot,
  'src/domains/costs/model-pricing-snapshot.ts'
)

type PricingEntry = {
  readonly provider: string
  readonly inputPerMillion: number
  readonly outputPerMillion: number
  readonly cachedInputPerMillion?: number
}

type Snapshot = {
  readonly _source: string
  readonly _fetched: string
  readonly models: Record<string, PricingEntry>
}

type UpstreamEntry = {
  readonly mode?: unknown
  readonly litellm_provider?: unknown
  readonly input_cost_per_token?: unknown
  readonly output_cost_per_token?: unknown
  readonly cache_read_input_token_cost?: unknown
}

const checkMode = !process.argv.includes('--write')

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const perMillion = (perToken: number): number =>
  Number((perToken * 1_000_000).toFixed(12))

const fetchUpstream = async (): Promise<Record<string, PricingEntry>> => {
  console.log(`Fetching ${upstreamUrl} ...`)
  const response = await fetch(upstreamUrl)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching upstream catalog`)
  }

  const raw = (await response.json()) as Record<string, UpstreamEntry>
  const models: Record<string, PricingEntry> = {}

  for (const [modelName, entry] of Object.entries(raw)) {
    if (
      entry.mode !== 'chat' ||
      entry.litellm_provider !== 'openai' ||
      !isFiniteNumber(entry.input_cost_per_token) ||
      !isFiniteNumber(entry.output_cost_per_token)
    ) {
      continue
    }

    models[modelName] = {
      provider: 'openai',
      inputPerMillion: perMillion(entry.input_cost_per_token),
      outputPerMillion: perMillion(entry.output_cost_per_token),
      // Capture the cached (prompt-cache read) input rate only when the upstream
      // catalog exposes one. Models without it stay conservative (cached input
      // falls back to the full input price at cost time).
      ...(isFiniteNumber(entry.cache_read_input_token_cost)
        ? {
            cachedInputPerMillion: perMillion(entry.cache_read_input_token_cost)
          }
        : {})
    }
  }

  return Object.fromEntries(
    Object.entries(models).sort(([left], [right]) => left.localeCompare(right))
  )
}

const loadSnapshot = async (): Promise<Snapshot> => {
  const source = await readFile(snapshotPath, 'utf8')
  const match = /modelPricingSnapshot\s*=\s*(\{[\s\S]*?\})\s+as const/u.exec(
    source
  )
  if (match?.[1] === undefined) {
    throw new Error(`Unable to parse ${pathRelative(snapshotPath)}`)
  }

  return JSON.parse(match[1]) as Snapshot
}

const diffModels = (
  current: Record<string, PricingEntry>,
  incoming: Record<string, PricingEntry>
): {
  readonly added: readonly string[]
  readonly removed: readonly string[]
  readonly changed: readonly string[]
} => {
  const currentKeys = new Set(Object.keys(current))
  const incomingKeys = new Set(Object.keys(incoming))

  const added = [...incomingKeys].filter((key) => !currentKeys.has(key))
  const removed = [...currentKeys].filter((key) => !incomingKeys.has(key))
  const changed = [...currentKeys]
    .filter((key) => incomingKeys.has(key))
    .filter((key) => {
      const currentEntry = current[key]
      const incomingEntry = incoming[key]

      return (
        currentEntry?.provider !== incomingEntry?.provider ||
        currentEntry?.inputPerMillion !== incomingEntry?.inputPerMillion ||
        currentEntry?.outputPerMillion !== incomingEntry?.outputPerMillion ||
        currentEntry?.cachedInputPerMillion !== incomingEntry?.cachedInputPerMillion
      )
    })

  return { added, removed, changed }
}

const serializeSnapshot = (snapshot: Snapshot): string =>
  [
    'export const modelPricingSnapshot = ',
    JSON.stringify(snapshot, null, 2),
    ' as const\n'
  ].join('')

const pathRelative = (outputPath: string): string =>
  outputPath.slice(workspaceRoot.length + 1).split('\\').join('/')

const printSample = (
  label: string,
  keys: readonly string[],
  current: Record<string, PricingEntry>,
  incoming: Record<string, PricingEntry>
): void => {
  if (keys.length === 0) {
    return
  }

  console.log(`  ${label}: ${keys.length}`)
  for (const key of keys.slice(0, 10)) {
    const before = current[key] === undefined ? '' : ` ${JSON.stringify(current[key])}`
    const after = incoming[key] === undefined ? '' : ` ${JSON.stringify(incoming[key])}`
    console.log(`    ${key}${before}${after}`)
  }
  if (keys.length > 10) {
    console.log(`    ... and ${keys.length - 10} more`)
  }
}

const main = async (): Promise<void> => {
  const incoming = await fetchUpstream()
  console.log(`Upstream: ${Object.keys(incoming).length} priced OpenAI chat models`)

  const current = await loadSnapshot().catch(() => ({
    _source: upstreamUrl,
    _fetched: 'missing',
    models: {}
  }))
  console.log(
    `Snapshot (_fetched: ${current._fetched}): ${Object.keys(current.models).length} models`
  )

  const diff = diffModels(current.models, incoming)
  if (diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0) {
    console.log('\nNo changes detected. Snapshot is up to date.')
    return
  }

  console.log('\nChanges detected:')
  printSample('Added', diff.added, current.models, incoming)
  printSample('Removed', diff.removed, current.models, incoming)
  printSample('Changed', diff.changed, current.models, incoming)

  if (checkMode) {
    console.log('\nRun with --write to apply changes.')
    process.exit(1)
  }

  const updated: Snapshot = {
    _source: upstreamUrl,
    _fetched: new Date().toISOString().slice(0, 10),
    models: incoming
  }
  await mkdir(dirname(snapshotPath), { recursive: true })
  await writeFile(snapshotPath, serializeSnapshot(updated), 'utf8')
  console.log(`\nSnapshot updated: ${pathRelative(snapshotPath)}`)
}

await main().catch((error: unknown) => {
  console.error('Error:', error instanceof Error ? error.message : String(error))
  process.exit(1)
})
