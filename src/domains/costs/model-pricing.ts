import { modelPricingSnapshot } from './model-pricing-snapshot.js'

type ModelPricingEntry = {
  readonly provider: string
  readonly inputPerMillion: number
  readonly outputPerMillion: number
  readonly cachedInputPerMillion?: number
}

export type BuiltInPrice = {
  readonly inputPerMillion: number
  readonly outputPerMillion: number
  readonly cachedInputPerMillion?: number
}

const supplementalOpenAiPrices: Readonly<Record<string, ModelPricingEntry>> = {
  'gpt-5.3-codex': {
    provider: 'openai',
    inputPerMillion: 1.75,
    outputPerMillion: 14,
    // Cached input is 0.1x of input across the gpt-5 family (mirrors the
    // snapshot's gpt-5-mini 0.25->0.025, gpt-5.4-mini 0.75->0.075).
    cachedInputPerMillion: 0.175
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
}): Partial<BuiltInPrice> => {
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
    ...(price.cachedInputPerMillion === undefined
      ? {}
      : { cachedInputPerMillion: price.cachedInputPerMillion })
  }
}
