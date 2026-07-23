/**
 * Canonical JSON value shape used when serializing or redacting arbitrary data
 * for output. Object values may be `undefined` so optional fields can be omitted
 * during construction; arrays are `readonly` because output values are never
 * mutated in place.
 */
export type JsonPrimitive = string | number | boolean | null

export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue | undefined }
