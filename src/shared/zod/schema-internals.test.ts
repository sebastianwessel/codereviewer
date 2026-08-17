import { describe, expect, test } from 'vitest'
import { z } from 'zod'
import {
  definitionOf,
  unwrapSchema,
  unwrapSchemaOnce
} from './schema-internals.js'

// The peel set is the whole point of having ONE reader: the two callers used to
// carry a nine-type set and a four-type set, and a schema reaching a wrapper the
// smaller set did not know stopped at it and was reported as a leaf. Every
// wrapper is asserted here by name so shrinking the set fails a test rather than
// a documentation page.
const wrappedInner = z.strictObject({ inner: z.string() })

describe('reading a schema’s structure', () => {
  test('the definition names the node type the schema really is', () => {
    expect(definitionOf(z.string()).type).toBe('string')
    expect(definitionOf(wrappedInner).type).toBe('object')
    expect(Object.keys(definitionOf(wrappedInner).shape ?? {})).toEqual(['inner'])
  })

  test.each([
    ['optional', wrappedInner.optional()],
    ['nullable', wrappedInner.nullable()],
    ['nonoptional', wrappedInner.optional().nonoptional()],
    ['default', wrappedInner.default({ inner: 'a' })],
    ['prefault', wrappedInner.prefault({ inner: 'a' })],
    ['catch', wrappedInner.catch({ inner: 'a' })],
    ['readonly', wrappedInner.readonly()],
    ['lazy', z.lazy(() => wrappedInner)]
  ])('a %s wrapper is peeled to the shape underneath it', (_type, schema) => {
    expect(definitionOf(unwrapSchema(schema)).type).toBe('object')
  })

  // A pipe is unwrapped to its INPUT side: a documented example is the value an
  // author writes, not what a transform hands on.
  test('a pipe is peeled to its input side, not its output', () => {
    const piped = wrappedInner.transform((value) => value.inner)

    expect(Object.keys(definitionOf(unwrapSchema(piped)).shape ?? {})).toEqual([
      'inner'
    ])
  })

  test('stacked wrappers are peeled all the way down', () => {
    expect(
      definitionOf(
        unwrapSchema(wrappedInner.optional().default({ inner: 'a' }).readonly())
      ).type
    ).toBe('object')
  })

  // What lets a caller read each layer instead of jumping past all of them: the
  // configuration inventory takes the OUTERMOST default it walks through, which
  // it cannot see once the wrappers are gone.
  test('one step at a time stops at the node that is not a wrapper', () => {
    const schema = wrappedInner.default({ inner: 'a' })
    const inner = unwrapSchemaOnce(schema)

    expect(definitionOf(schema).type).toBe('default')
    expect(inner === undefined ? undefined : definitionOf(inner).type).toBe(
      'object'
    )
    expect(unwrapSchemaOnce(wrappedInner)).toBeUndefined()
    expect(unwrapSchemaOnce(z.string())).toBeUndefined()
  })
})
