import { toJSONSchema, type ZodType } from 'zod'

// Which side of a schema the published document describes.
//
// Zod distinguishes the type going IN to a parse from the type coming OUT of
// it, and a key with a default differs between them: absent-and-allowed on the
// way in, always-present on the way out. One Zod schema therefore yields two
// different JSON Schemas, and publishing the wrong one is not a cosmetic
// difference.
//
// `input` is for a document a HUMAN authors and a validator checks BEFORE
// parsing -- the configuration file. Every block there has a default, so the
// output view marks all of them `required`, and an editor wired to that view
// reports an empty config, and every partial config, as invalid while the
// loader accepts them happily.
//
// `output` is for a document the ENGINE produces and a consumer checks AFTER
// the fact -- the review report. A consumer reading a written report is looking
// at post-default values and should be told which fields it can rely on being
// present.
//
// The direction is required rather than defaulted: it is a fact about what the
// document is for, and a wrong default here is silently wrong in a published
// contract rather than loudly wrong at the call site.
export type JsonSchemaDirection = 'input' | 'output'

export function toDraft202012JsonSchema(
  schema: ZodType,
  title: string,
  id: string,
  direction: JsonSchemaDirection
): object {
  const jsonSchema = toJSONSchema(schema, { io: direction })

  return {
    ...jsonSchema,
    $id: id,
    title
  }
}
