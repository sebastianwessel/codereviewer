export type ServiceConfig = {
  readonly name: string
  readonly endpoints: Record<string, string>
}

export const resolveEndpoint = (
  config: ServiceConfig,
  region: string
): string => {
  const endpoint = config.endpoints[region]

  return endpoint.toLowerCase()
}
