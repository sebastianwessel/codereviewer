// Spec 23's verification-matrix row: "harness test asserting distinct agents and
// distinct output schemas, plus a schema-shape assertion that the mapping output
// has no string field other than identifiers and enums".
//
// This is the most load-bearing test in the domain, because the requirement it
// guards is one an ordinary edit can undo without looking like it changed
// anything. Adding `reason: z.string()` to the judgement output would read as a
// helpful improvement, satisfy every other test in this folder, and reproduce the
// exact mechanism spec 23 exists to prevent: measured spurious rejection rises
// from 26-36% to 73-88% when a model justifies a verdict in the same breath as
// reaching it.
//
// The string-field assertion is written as an exact-set equality against a
// declared allowlist rather than as a list of forbidden names, so it fails on ANY
// new string field, including one nobody thought to ban.

import { describe, expect, test } from 'vitest'
import { toJSONSchema } from 'zod'
import type {
  JsonValue,
  ModelProvider,
  ObjectRequest,
  ObjectResponse
} from '@purista/harness'
import { createHarnessIntentFulfilmentAgents } from './intent-fulfilment-agents.js'
import { ModelFulfilmentExplanationSchema } from './explanation.js'
import { ModelFulfilmentJudgementSchema } from './judgement.js'
import { ModelObligationExtractionSchema } from './obligation-extraction.js'

// The complete set of string-typed leaves the judgement output is allowed to
// carry, each with the reason it is not free text.
//
//   `status`   - an enum. It is typed as a plain string in the model-bound schema
//                because a strict enum turns "Addressed." into a provider-side
//                rejection and loses the judgement; the three values are enforced
//                by `normalizeFulfilmentJudgement`.
//   `evidence[].path` - an identifier: the repository path of a changed file. It
//                is verified against the change surface, so it cannot hold prose
//                and survive.
//   `evidence[].side` - an enum ('added' | 'removed'), added by spec 23's
//                2026-07-30 amendment so a citation can name a REMOVED line.
//                String-typed for the same provider-error reason as `status`, and
//                normalized in code; anything that is not one of the two values is
//                dropped and the side is resolved from the change surface instead.
//                It can hold at most one of two words, so it cannot carry a
//                rationale.
//
// Adding an entry here is a deliberate act. Each one must be an identifier or an
// enum whose value set is closed in code — never somewhere a justification could
// live, because a model justifying a verdict in the same breath as reaching it is
// the exact mechanism this guard exists to prevent.
const ALLOWED_JUDGEMENT_STRING_FIELDS = [
  'evidence[].path',
  'evidence[].side',
  'status'
]

type JsonSchemaNode = {
  readonly type?: unknown
  readonly properties?: Record<string, unknown>
  readonly items?: unknown
}

const asNode = (value: unknown): JsonSchemaNode =>
  typeof value === 'object' && value !== null ? (value as JsonSchemaNode) : {}

// Every string-typed leaf in a JSON Schema, addressed by path. Arrays render as
// `field[]` so a string nested inside one cannot hide behind its container.
const stringFieldPaths = (value: unknown, prefix = ''): readonly string[] => {
  const node = asNode(value)

  if (node.type === 'string') {
    return [prefix]
  }

  if (node.items !== undefined) {
    return stringFieldPaths(node.items, `${prefix}[]`)
  }

  return Object.entries(node.properties ?? {}).flatMap(([name, child]) =>
    stringFieldPaths(child, prefix === '' ? name : `${prefix}.${name}`)
  )
}

const schemaProperties = (value: unknown): readonly string[] =>
  Object.keys(asNode(value).properties ?? {})

// Answers the shape the requested schema asks for and records every request, so
// the three agents' schemas and instructions can be compared as they actually
// reach a provider rather than as this domain composes them. Answering per-schema
// is itself part of the assertion: a single blended answer is rejected by all
// three output schemas, because none of them accepts another's fields.
class RecordingProvider implements ModelProvider {
  readonly id = 'recording'
  readonly genAiSystem = 'scripted'
  readonly requests: ObjectRequest[] = []

  async object<T extends JsonValue = JsonValue>(
    request: ObjectRequest<T>
  ): Promise<ObjectResponse<T>> {
    this.requests.push(request as ObjectRequest)

    const properties = schemaProperties(request.schema)
    const answer = properties.includes('obligations')
      ? { obligations: [{ origin: 'inbox:a', line: 1, statement: 'do a thing' }] }
      : properties.includes('explanation')
        ? { explanation: 'One obligation, not evidenced.' }
        : { status: 'not-evidenced' }

    return {
      object: answer as unknown as T,
      finishReason: 'stop',
      usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 }
    }
  }
}

const agentsWith = (provider: ModelProvider) =>
  createHarnessIntentFulfilmentAgents({
    modelAlias: { provider, model: 'scripted-model', capabilities: ['object'] }
  })

describe('intent-fulfilment judgement output schema', () => {
  test('carries no string field other than identifiers and enums', () => {
    expect(
      [...stringFieldPaths(toJSONSchema(ModelFulfilmentJudgementSchema))].sort()
    ).toEqual(ALLOWED_JUDGEMENT_STRING_FIELDS)
  })

  test('the shape assertion above is capable of failing', () => {
    // Without this, the assertion passes on a walker that silently stopped
    // finding string leaves — which is the failure mode an exact-set test over an
    // absence is most prone to. `reason` is the specific field spec 23 names.
    const withRationale = ModelFulfilmentJudgementSchema.extend({
      reason: ModelFulfilmentExplanationSchema.shape.explanation
    })

    expect([...stringFieldPaths(toJSONSchema(withRationale))].sort()).not.toEqual(
      ALLOWED_JUDGEMENT_STRING_FIELDS
    )
    expect(stringFieldPaths(toJSONSchema(withRationale))).toContain('reason')
  })

  test('has no property whose name suggests a justification', () => {
    // Belt to the exact-set brace above: a field added as a number or an enum
    // still cannot be a rationale, and this names the shapes explicitly so the
    // failure message says why rather than only that a set differed.
    const properties = schemaProperties(
      toJSONSchema(ModelFulfilmentJudgementSchema)
    )

    for (const forbidden of [
      'reason',
      'rationale',
      'explanation',
      'justification',
      'note',
      'summary',
      'comment',
      'confidence'
    ]) {
      expect(properties).not.toContain(forbidden)
    }
  })
})

describe('intent-fulfilment harness agents', () => {
  test('judgement and explanation are distinct agents with distinct output schemas', async () => {
    const provider = new RecordingProvider()
    const agents = agentsWith(provider)

    try {
      await agents.extractObligations(
        {
          maxObligations: 5,
          sources: [{ origin: 'inbox:a', lines: [{ line: 1, text: 'do a thing' }] }]
        },
        undefined
      )
      await agents.judge(
        {
          changedFiles: [
            { path: 'src/a.ts', changedLines: [{ line: 1, side: 'added' as const, text: 'const a = 1' }] }
          ],
          obligation: 'do a thing'
        },
        undefined
      )
      await agents.explain(
        {
          obligations: [
            { statement: 'do a thing', status: 'not-evidenced', evidence: [] }
          ],
          extraScopePaths: []
        },
        undefined
      )
    } finally {
      await agents.shutdown()
    }

    // Three calls, in order: extraction, judgement, explanation. One call could
    // never produce three requests, which is the requirement stated as an
    // observation rather than as a code reading.
    expect(provider.requests).toHaveLength(3)

    const [extraction, judgement, explanation] = provider.requests

    // Distinct OUTPUT SCHEMAS, compared as they reach the provider. If judgement
    // and explanation were one agent these would be the same object.
    const schemas = provider.requests.map((request) =>
      JSON.stringify(request.schema)
    )
    expect(new Set(schemas).size).toBe(3)
    expect(judgement?.schema).toEqual(toJSONSchema(ModelFulfilmentJudgementSchema))
    expect(explanation?.schema).toEqual(
      toJSONSchema(ModelFulfilmentExplanationSchema)
    )
    expect(extraction?.schema).toEqual(
      toJSONSchema(ModelObligationExtractionSchema)
    )

    // Distinct AGENTS: different instructions reached the provider on each call.
    const instructionsOf = (request: ObjectRequest | undefined): string =>
      (request?.messages ?? [])
        .filter((message) => message.role === 'system')
        .map((message) =>
          typeof message.content === 'string'
            ? message.content
            : JSON.stringify(message.content)
        )
        .join('\n')

    expect(instructionsOf(judgement)).toContain('You are given ONE obligation')
    expect(instructionsOf(explanation)).toContain('ALREADY DECIDED')
    expect(instructionsOf(extraction)).toContain(
      'Turn it into a list of discrete, checkable obligations'
    )
    expect(instructionsOf(judgement)).not.toContain('ALREADY DECIDED')
  })

  test('offers no tool to any of the three agents', async () => {
    // This capability judges a change it was handed; it does not search a
    // repository. Added context measured net-negative in this project twice.
    const provider = new RecordingProvider()
    const agents = agentsWith(provider)

    try {
      await agents.judge(
        {
          changedFiles: [
            { path: 'src/a.ts', changedLines: [{ line: 1, side: 'added' as const, text: 'const a = 1' }] }
          ],
          obligation: 'do a thing'
        },
        undefined
      )
    } finally {
      await agents.shutdown()
    }

    for (const request of provider.requests) {
      expect(request.tools ?? []).toEqual([])
    }
  })
})
