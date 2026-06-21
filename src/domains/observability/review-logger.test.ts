import { describe, expect, test } from 'vitest'
import { createReviewLogger } from './review-logger.js'

describe('review logger', () => {
  test('emits structured records and redacts unsafe nested fields', () => {
    let output = ''
    const logger = createReviewLogger({
      level: 'debug',
      out: {
        write: (chunk) => {
          output += chunk
        }
      },
      bindings: {
        component: 'test'
      }
    })

    logger.debug('Provider step failed.', {
      provider_id: 'openai',
      changed_file_count: 2,
      prompt: 'do not log prompt',
      error: {
        code: 'MODEL_ERROR',
        providerHeaders: {
          authorization: 'Bearer secret'
        },
        providerBody: {
          request: 'raw request body'
        },
        meta: {
          status: 400,
          token: 'secret-token'
        }
      }
    })

    const parsed = JSON.parse(output)
    const serialized = JSON.stringify(parsed)

    expect(parsed).toMatchObject({
      level: 'debug',
      msg: 'Provider step failed.',
      component: 'test',
      provider_id: 'openai',
      changed_file_count: 2
    })
    expect(serialized).toContain('MODEL_ERROR')
    expect(serialized).toContain('400')
    expect(serialized).not.toContain('do not log prompt')
    expect(serialized).not.toContain('secret')
    expect(serialized).not.toContain('raw request body')
  })
})
