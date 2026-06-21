import { describe, expect, test } from 'vitest'
import { configureOpenTelemetry } from './open-telemetry.js'

describe('open telemetry setup', () => {
  test('stays disabled by default', async () => {
    await expect(
      configureOpenTelemetry({
        config: {
          enabled: false,
          serviceName: 'codereviewer',
          headers: {}
        }
      })
    ).resolves.toEqual({
      enabled: false,
      warning: 'opentelemetry-disabled'
    })
  })

  test('requires an endpoint when enabled', async () => {
    await expect(
      configureOpenTelemetry({
        config: {
          enabled: true,
          serviceName: 'codereviewer',
          headers: {}
        }
      })
    ).rejects.toMatchObject({
      code: 'opentelemetry_endpoint_missing',
      exitCode: 2
    })
  })

  test('reports missing optional dependencies without swallowing the cause', async () => {
    await expect(
      configureOpenTelemetry({
        config: {
          enabled: true,
          endpoint: 'http://127.0.0.1:4318/v1/traces',
          serviceName: 'codereviewer',
          headers: {}
        },
        importModule: async () => {
          const error = new Error('Cannot find package')
          Object.assign(error, { code: 'ERR_MODULE_NOT_FOUND' })
          throw error
        }
      })
    ).rejects.toMatchObject({
      code: 'opentelemetry_dependency_missing',
      exitCode: 2,
      details: expect.objectContaining({
        cause: 'Cannot find package'
      })
    })
  })
})

