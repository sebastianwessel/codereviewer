// Boundary schema for the SARIF 2.1.0 subset this engine reads.
//
// An analyzer artifact is UNTRUSTED INPUT (spec 07): it is produced by a tool this
// engine does not run, in a pipeline it does not control, and it may be attacker-
// influenced wherever the pipeline is. So it is parsed through Zod at the boundary
// like every other external document, and never trusted structurally.
//
// It is a SUBSET on purpose. SARIF is a large format and most of it is irrelevant
// to a code review: fixes, invocations, artifacts, conversion provenance, taxonomies.
// Objects are non-strict (unknown keys pass) because a producer legitimately emits
// far more than this reads and rejecting an artifact for carrying its own valid
// fields would make the feature unusable — but every field this engine ACTS on is
// typed here, so an artifact cannot smuggle an unexpected shape into the normalizer.
//
// `version` is pinned. A future SARIF revision may change the meaning of a field
// this reader depends on, and silently reading it as 2.1.0 would produce confident,
// wrong evidence.

import { z } from 'zod'

export const SARIF_SUPPORTED_VERSION = '2.1.0'

// Producers emit `security-severity` as a string ("8.8") far more often than as a
// number; both are accepted and neither is invented. A value outside 0-10 is
// dropped by the normalizer rather than clamped, because a clamp would turn a
// producer's mistake into a plausible number.
const SarifSeverityPropertySchema = z.union([z.string(), z.number()])

const SarifPropertyBagSchema = z.looseObject({
  tags: z.array(z.string()).optional(),
  cwe: z.union([z.string(), z.array(z.string())]).optional(),
  'security-severity': SarifSeverityPropertySchema.optional()
})

const SarifMessageSchema = z.looseObject({
  text: z.string().optional()
})

const SarifArtifactLocationSchema = z.looseObject({
  uri: z.string().optional()
})

const SarifRegionSchema = z.looseObject({
  startLine: z.number().optional(),
  startColumn: z.number().optional(),
  endLine: z.number().optional(),
  endColumn: z.number().optional()
})

const SarifPhysicalLocationSchema = z.looseObject({
  artifactLocation: SarifArtifactLocationSchema.optional(),
  region: SarifRegionSchema.optional()
})

export const SarifLocationSchema = z.looseObject({
  physicalLocation: SarifPhysicalLocationSchema.optional(),
  message: SarifMessageSchema.optional()
})

const SarifThreadFlowLocationSchema = z.looseObject({
  location: SarifLocationSchema.optional()
})

const SarifThreadFlowSchema = z.looseObject({
  locations: z.array(SarifThreadFlowLocationSchema).optional()
})

const SarifCodeFlowSchema = z.looseObject({
  message: SarifMessageSchema.optional(),
  threadFlows: z.array(SarifThreadFlowSchema).optional()
})

export const SarifLevelSchema = z.enum(['error', 'warning', 'note', 'none'])

const SarifReportingConfigurationSchema = z.looseObject({
  level: SarifLevelSchema.optional()
})

export const SarifReportingDescriptorSchema = z.looseObject({
  id: z.string().optional(),
  name: z.string().optional(),
  helpUri: z.string().optional(),
  shortDescription: SarifMessageSchema.optional(),
  fullDescription: SarifMessageSchema.optional(),
  defaultConfiguration: SarifReportingConfigurationSchema.optional(),
  properties: SarifPropertyBagSchema.optional()
})

export const SarifToolComponentSchema = z.looseObject({
  name: z.string().optional(),
  version: z.string().optional(),
  semanticVersion: z.string().optional(),
  informationUri: z.string().optional(),
  rules: z.array(SarifReportingDescriptorSchema).optional()
})

export const SarifResultSchema = z.looseObject({
  ruleId: z.string().optional(),
  ruleIndex: z.number().optional(),
  level: SarifLevelSchema.optional(),
  message: SarifMessageSchema.optional(),
  locations: z.array(SarifLocationSchema).optional(),
  relatedLocations: z.array(SarifLocationSchema).optional(),
  codeFlows: z.array(SarifCodeFlowSchema).optional(),
  properties: SarifPropertyBagSchema.optional()
})

export const SarifRunSchema = z.looseObject({
  tool: z.looseObject({
    driver: SarifToolComponentSchema,
    extensions: z.array(SarifToolComponentSchema).optional()
  }),
  results: z.array(SarifResultSchema).optional()
})

export const SarifLogSchema = z.looseObject({
  version: z.literal(SARIF_SUPPORTED_VERSION),
  runs: z.array(SarifRunSchema)
})

export type SarifLog = z.infer<typeof SarifLogSchema>
export type SarifRun = z.infer<typeof SarifRunSchema>
export type SarifResult = z.infer<typeof SarifResultSchema>
export type SarifLocation = z.infer<typeof SarifLocationSchema>
export type SarifReportingDescriptor = z.infer<
  typeof SarifReportingDescriptorSchema
>
export type SarifToolComponent = z.infer<typeof SarifToolComponentSchema>
