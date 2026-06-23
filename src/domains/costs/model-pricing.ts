import type { CostConfig } from '../../shared/contracts/index.js'
import { modelPricingSnapshot } from './model-pricing-snapshot.js'

type ModelPricingEntry = {
  readonly provider: string
  readonly inputPerMillion: number
  readonly outputPerMillion: number
}

const supplementalOpenAiPrices: Readonly<Record<string, ModelPricingEntry>> = {
  'gpt-5.3-codex': {
    provider: 'openai',
    inputPerMillion: 1.75,
    outputPerMillion: 14
  }
}

const providerToPricingProvider = (providerId?: string): string | undefined =>
  providerId === 'openai' ? 'openai' : undefined

const isModelNameMatch = (candidate: string, modelName: string): boolean =>
  modelName === candidate || modelName.startsWith(`${candidate}-`)

const snapshotEntries = Object.entries(
  {
    ...modelPricingSnapshot.models,
    ...supplementalOpenAiPrices
  }
) as readonly (readonly [string, ModelPricingEntry])[]

export const builtInPricesFor = (input: {
  readonly providerId?: string
  readonly modelName?: string
}): Partial<CostConfig> => {
  const pricingProvider = providerToPricingProvider(input.providerId)
  if (pricingProvider === undefined || input.modelName === undefined) {
    return {}
  }

  const normalizedModelName = input.modelName.toLowerCase()
  const exact = snapshotEntries.find(
    ([modelName, entry]) =>
      entry.provider === pricingProvider && modelName.toLowerCase() === normalizedModelName
  )
  const prefix = snapshotEntries
    .filter(([, entry]) => entry.provider === pricingProvider)
    .sort(([left], [right]) => right.length - left.length)
    .find(([modelName]) => isModelNameMatch(modelName.toLowerCase(), normalizedModelName))
  const price = exact?.[1] ?? prefix?.[1]

  if (price === undefined) {
    return {}
  }

  return {
    inputPerMillion: price.inputPerMillion,
    outputPerMillion: price.outputPerMillion,
    currency: 'USD'
  }
}
