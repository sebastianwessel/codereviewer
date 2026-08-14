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

  // Spec 07 requires run logs to include counts, and the key pattern deleted the
  // counts along with the content: `input_tokens` trips on "input", `output_tokens`
  // on "output", and `adjudication_requested` on "request". The pair was removed
  // outright, so every run log reported the provider step as having no usage at
  // all — the counts existed and were correct, and nothing said they were withheld.
  test('keeps operational counts and flags whose key resembles a content key', () => {
    let output = ''
    const logger = createReviewLogger({
      level: 'debug',
      out: {
        write: (chunk) => {
          output += chunk
        }
      }
    })

    logger.debug('Model-backed review workflow completed.', {
      input_tokens: 1234,
      output_tokens: 56,
      adjudication_requested: true
    })

    expect(JSON.parse(output)).toMatchObject({
      input_tokens: 1234,
      output_tokens: 56,
      adjudication_requested: true
    })
  })

  // The exemption is by EXACT key AND by value type, so it cannot become a channel:
  // a string parked under `input_tokens` is a token, not a count of them.
  test('refuses an exempt key whose value is not the type that key may carry', () => {
    let output = ''
    const logger = createReviewLogger({
      level: 'debug',
      out: {
        write: (chunk) => {
          output += chunk
        }
      }
    })

    logger.debug('Provider usage.', {
      input_tokens: 'sk-abcdef0123456789',
      adjudication_requested: 'do not log prompt',
      // Resembling an exempt name is not membership in the set.
      total_input_tokens: 99
    })

    const parsed = JSON.parse(output) as Record<string, unknown>
    const marker = '[dropped: field name is not log-safe]'
    expect(parsed['input_tokens']).toBe(marker)
    expect(parsed['adjudication_requested']).toBe(marker)
    expect(parsed['total_input_tokens']).toBe(marker)
    expect(JSON.stringify(parsed)).not.toContain('sk-abcdef')
    expect(JSON.stringify(parsed)).not.toContain('do not log prompt')
  })

  // A removed pair is indistinguishable from one the caller never emitted, which is
  // the silent-absence shape the sanitizer itself exists to prevent. The key stays
  // and the value is replaced, so the line says a field was withheld.
  test('marks a withheld field instead of deleting the pair', () => {
    let output = ''
    const logger = createReviewLogger({
      level: 'debug',
      out: {
        write: (chunk) => {
          output += chunk
        }
      }
    })

    logger.debug('Provider step failed.', {
      prompt: 'do not log prompt'
    })

    const parsed = JSON.parse(output) as Record<string, unknown>
    expect(Object.keys(parsed)).toContain('prompt')
    expect(parsed['prompt']).toBe('[dropped: field name is not log-safe]')
    expect(JSON.stringify(parsed)).not.toContain('do not log prompt')
  })
})
