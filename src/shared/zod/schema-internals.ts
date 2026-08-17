import type { ZodType } from 'zod'

// Zod's internal node shape, READ rather than reimplemented, for the checks that
// have to walk a schema's structure instead of parsing a value with it.
//
// There is no public accessor covering unwrapping, unions, catchalls and
// defaults uniformly, so every such walk ends up reading `_zod.def` (the public
// `.def` getter is the same object). This module is the ONE place that does it:
// `drift/artifact-example-checker.ts` walks documented artifact examples against
// their producer contracts, and `drift/config-default-table-checker.ts` walks the
// configuration schema for its documented leaves. Both read the same fields, and
// two readers of one private structure drift apart silently — which is exactly
// what happened before this module existed: one peeled nine wrapper types and
// the other four, so a `.readonly()` or a `.catch()` added to the configuration
// schema would have made the second stop at the wrapper and report a leaf with
// no default, failing a page that was correct.
//
// Only the fields those walks need are named. A field Zod adds is invisible here
// until a walk needs it.

export type SchemaDef = {
  readonly type: string
  readonly innerType?: ZodType
  readonly getter?: () => ZodType
  readonly in?: ZodType
  readonly defaultValue?: unknown
  readonly shape?: Readonly<Record<string, ZodType>>
  readonly catchall?: ZodType
  readonly element?: ZodType
  readonly items?: readonly ZodType[]
  readonly rest?: ZodType
  readonly valueType?: ZodType
  readonly options?: readonly ZodType[]
  readonly discriminator?: string
  readonly entries?: Readonly<Record<string, string | number>>
  readonly values?: readonly unknown[]
  readonly left?: ZodType
  readonly right?: ZodType
}

export const definitionOf = (schema: ZodType): SchemaDef =>
  (schema as unknown as { readonly _zod: { readonly def: SchemaDef } })._zod.def

// Wrappers that add a rule without adding or removing a key: unwrapping them
// leaves the shape a value has to match.
const neutralWrapperTypes = new Set([
  'optional',
  'nullable',
  'nonoptional',
  'default',
  'prefault',
  'catch',
  'readonly'
])

/**
 * One wrapper peeled, or `undefined` when the node is not one.
 *
 * Exposed alongside `unwrapSchema` because a caller may need to SEE each layer
 * on the way down — the configuration inventory reads the outermost `default` it
 * passes through, which a walk that jumps straight to the inner node cannot do.
 *
 * A `pipe` is unwrapped to its INPUT side, which matters for the two evaluation
 * case contracts: `EvalSliceCaseSchema` is a raw object plus a transform that
 * derives tags, and a documented `slice.json` is the file an author writes, not
 * the value the loader hands on.
 */
export const unwrapSchemaOnce = (schema: ZodType): ZodType | undefined => {
  const def = definitionOf(schema)

  if (def.type === 'lazy') {
    return def.getter?.()
  }

  if (def.type === 'pipe') {
    return def.in
  }

  return def.innerType !== undefined && neutralWrapperTypes.has(def.type)
    ? def.innerType
    : undefined
}

/** The node under every wrapper: the object, container or leaf that carries the shape. */
export const unwrapSchema = (schema: ZodType): ZodType => {
  let node = schema

  for (;;) {
    const inner = unwrapSchemaOnce(node)

    if (inner === undefined) {
      return node
    }

    node = inner
  }
}
