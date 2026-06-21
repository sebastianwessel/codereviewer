import { toJSONSchema, type ZodType } from 'zod'

export function toDraft202012JsonSchema(schema: ZodType, title: string, id: string): object {
  const jsonSchema = toJSONSchema(schema)

  return {
    ...jsonSchema,
    $id: id,
    title
  }
}
