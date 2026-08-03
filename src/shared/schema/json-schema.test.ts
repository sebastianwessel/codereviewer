import { describe, expect, test } from 'vitest'
import { z } from 'zod'
import { toDraft202012JsonSchema } from './json-schema.js'

const withDefaults = z.strictObject({
  authored: z.string(),
  defaulted: z.string().default('value')
})

type Draft202012Object = {
  readonly required?: readonly string[]
  readonly properties?: Readonly<Record<string, unknown>>
}

describe('toDraft202012JsonSchema', () => {
  // The published configuration contract is validated against what a HUMAN
  // wrote, before any default is applied. Published from the output side, every
  // defaulted key becomes `required`, and an editor wired to the contract marks
  // a config the loader accepts as invalid. That shipped once: 19 of 20
  // top-level configuration blocks were `required` in `schema/`.
  test('the input view does not require a key that has a default', () => {
    const schema = toDraft202012JsonSchema(
      withDefaults,
      'Test',
      'https://example.test/test.json',
      'input'
    ) as Draft202012Object

    expect(schema.required).toEqual(['authored'])
  })

  // A produced artifact is read back post-defaults, so a consumer should be told
  // which fields it can rely on being present.
  test('the output view requires a key that has a default', () => {
    const schema = toDraft202012JsonSchema(
      withDefaults,
      'Test',
      'https://example.test/test.json',
      'output'
    ) as Draft202012Object

    expect(schema.required).toEqual(['authored', 'defaulted'])
  })
})
