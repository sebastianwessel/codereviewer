import { z } from 'zod'

export const SeveritySchema = z.enum(['critical', 'high', 'medium', 'low', 'info'])

export const ReportFormatSchema = z.enum([
  'json',
  'markdown',
  'sarif',
  'github-review-comments'
])

export const RepositoryRelativePathSchema = z
  .string()
  .min(1)
  .refine((value) => !value.includes('\0'), 'Path must not contain NUL bytes')
  .refine((value) => !value.startsWith('/'), 'Path must be repository-relative')
  .refine((value) => !/^[A-Za-z]:/.test(value), 'Path must not be a Windows absolute path')
  .refine((value) => !/(^|\/)\.\.(\/|$)/.test(value.replaceAll('\\', '/')), 'Path must not traverse above root')

const gitRefSchema = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith('-'), 'Git refs must not start with "-"')

export const ReviewConfigSchema = z.strictObject({
  mode: z.enum(['local', 'ci', 'pr', 'full']).default('local'),
  depth: z.enum(['fast', 'balanced', 'thorough']).default('balanced'),
  baseRef: gitRefSchema.default('main'),
  headRef: gitRefSchema.default('HEAD'),
  maxConcurrentTasks: z.int().min(1).max(32).default(4),
  maxFiles: z.int().min(1).max(10000).default(500),
  maxFileBytes: z.int().min(1).max(5000000).default(500000),
  contextMaxBytes: z.int().min(10000).max(10000000).optional(),
  inlineSeverityThreshold: SeveritySchema.default('high'),
  maxCostUsd: z.number().min(0).optional(),
  runTimeoutMs: z.int().min(10000).max(7200000).optional()
})

export const ProviderConfigSchema = z
  .strictObject({
    id: z.enum(['openai', 'openai-compatible', 'bedrock', 'azure']),
    model: z.string().min(1),
    baseUrl: z.url().optional(),
    temperature: z.number().min(0).max(2).default(0),
    maxOutputTokens: z.int().min(1).optional(),
    // Reasoning effort for reasoning models (OpenAI Responses API). Higher effort
    // improves the proof/investigation stages on smaller models at higher token
    // cost. Unset uses the provider default.
    reasoningEffort: z.enum(['minimal', 'low', 'medium', 'high']).optional(),
    timeoutMs: z.int().min(1000).max(600000).default(120000),
    // Classified retry of provider task calls: total attempts = maxRetries + 1.
    // Transient failures (network/5xx/timeout) and rate limits are retried;
    // oversized context, auth, and payment failures are not.
    maxRetries: z.int().min(0).max(5).default(2),
    // Base delay for exponential backoff between retries.
    retryBackoffMs: z.int().min(0).max(60000).default(500),
    // Maximum single backoff wait. A required wait above this cap (e.g. a long
    // rate-limit Retry-After) fails the run instead of blocking.
    retryMaxDelayMs: z.int().min(0).max(600000).default(30000)
  })
  .superRefine((value, context) => {
    if (value.id === 'openai-compatible' && value.baseUrl === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['baseUrl'],
        message: 'baseUrl is required for openai-compatible providers'
      })
    }
  })

export const InstructionsConfigSchema = z.strictObject({
  files: z.array(RepositoryRelativePathSchema).default([]),
  inline: z.string().default('')
})

export const SkillsConfigSchema = z.strictObject({
  enabled: z.boolean().default(false),
  directories: z.array(RepositoryRelativePathSchema).default(['.codereviewer/skills']),
  allowTools: z.array(z.enum(['read', 'list', 'grep'])).default([
    'read',
    'list',
    'grep'
  ])
})

// Default review excludes. Beyond VCS/dependency/build/artifact directories, this
// skips generated and non-reviewable data files (dependency lock files, minified
// bundles, source maps, test snapshots) from model review: they carry no
// semantic logic to review, so loading them only wastes tokens and produces
// noise. App-specific data (e.g. locale bundles) can be added via `paths.exclude`.
export const defaultReviewExcludePatterns: readonly string[] = [
  '.git/**',
  'node_modules/**',
  'dist/**',
  'coverage/**',
  '.codereviewer/**',
  '**/package-lock.json',
  '**/yarn.lock',
  '**/pnpm-lock.yaml',
  '**/npm-shrinkwrap.json',
  '**/composer.lock',
  '**/Gemfile.lock',
  '**/poetry.lock',
  '**/Cargo.lock',
  '**/go.sum',
  '**/*.min.js',
  '**/*.min.css',
  '**/*.map',
  '**/*.snap'
]

export const PathsConfigSchema = z.strictObject({
  include: z.array(z.string()).default(['**/*']),
  exclude: z.array(z.string()).default([...defaultReviewExcludePatterns]),
  artifactDir: RepositoryRelativePathSchema.default('.codereviewer/runs')
})

export const BaselineConfigSchema = z.strictObject({
  enabled: z.boolean().default(true),
  path: RepositoryRelativePathSchema.default('.codereviewer/baseline.json'),
  failOnNewOnly: z.boolean().default(true),
  includeResolvedInReport: z.boolean().default(true)
})

export const SecurityConfigSchema = z.strictObject({
  allowShell: z.literal(false).default(false),
  allowNetwork: z.literal(false).default(false),
  allowFilesystemWrite: z.literal(false).default(false),
  captureContentTelemetry: z.literal(false).default(false)
})

export const QualityGateConfigSchema = z.strictObject({
  maxCritical: z.int().min(0).default(0),
  maxHigh: z.int().min(0).default(0),
  // Omitted by default ("no fail" per spec 06).
  maxMedium: z.int().min(0).optional(),
  failOnProviderError: z.boolean().default(true),
  // Defaults to the baseline `failOnNewOnly` value at runtime when unset.
  failOnNewOnly: z.boolean().optional()
})

export const AiReviewConfigSchema = z.strictObject({
  enabled: z.boolean().optional(),
  requireRefutation: z.literal(true).default(true),
  deterministicSignalMode: z.enum(['support', 'disabled']).default('support'),
  // Minimum severity for a MODEL-origin finding to be admitted as actionable.
  // Below this, model findings are rejected as below-threshold (still recorded as
  // rejected findings, so they remain auditable). Default `medium` keeps the
  // engine focused on impactful runtime/security defects and out of low-severity
  // nit noise (aligned with the low-noise product vision). Trusted
  // deterministic-rule findings are exempt. Lower to `low`/`info` to surface more.
  actionableSeverityThreshold: SeveritySchema.default('medium')
})

export const PromotionPolicyConfigSchema = z.strictObject({
  // Disposition for a candidate the refuter judged `needs-more-evidence`.
  // `artifact-only` keeps it auditable but out of the inline review;
  // `rejected` drops it entirely.
  modelWeakOrRefuted: z.enum(['artifact-only', 'rejected']).default('artifact-only')
})

export const DriftCategorySchema = z.enum([
  'documentation-drift',
  'spec-drift',
  'implementation-drift',
  'generated-artifact-drift',
  'ambiguity',
  'security-drift'
])

export const DriftConfigSchema = z.strictObject({
  enabled: z.boolean().default(true),
  failOn: z.array(DriftCategorySchema).default([
    'generated-artifact-drift',
    'security-drift'
  ]),
  includeDocs: z.boolean().default(true),
  includeSpecs: z.boolean().default(true),
  includeGenerated: z.boolean().default(true)
})

export const SarifReportingConfigSchema = z.strictObject({
  target: z.enum(['generic', 'github']).default('generic'),
  category: z.string().min(1).default('codereviewer'),
  maxResults: z.int().min(1).max(25000).default(5000),
  redact: z.boolean().default(true)
})

export const ReportingConfigSchema = z.strictObject({
  formats: z.array(ReportFormatSchema).default(['json', 'markdown', 'sarif']),
  sarif: SarifReportingConfigSchema.default({
    target: 'generic',
    category: 'codereviewer',
    maxResults: 5000,
    redact: true
  })
})

export const EvaluationConfigSchema = z.strictObject({
  enabled: z.boolean().default(false)
})

export const OpenTelemetryConfigSchema = z
  .strictObject({
    enabled: z.boolean().default(false),
    endpoint: z.url().optional(),
    headers: z.record(z.string(), z.string()).default({}),
    serviceName: z.string().min(1).default('codereviewer')
  })
  .superRefine((value, context) => {
    if (value.enabled && value.endpoint === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['endpoint'],
        message: 'endpoint is required when OpenTelemetry is enabled'
      })
    }
  })

export const LoggingConfigSchema = z.strictObject({
  level: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
    .default('silent')
})

export const ObservabilityConfigSchema = z.strictObject({
  logging: LoggingConfigSchema.default({
    level: 'silent'
  }),
  openTelemetry: OpenTelemetryConfigSchema.default({
    enabled: false,
    headers: {},
    serviceName: 'codereviewer'
  })
})

export const CostConfigSchema = z.strictObject({
  inputPerMillion: z.number().min(0).optional(),
  outputPerMillion: z.number().min(0).optional()
})

export const CodeReviewerConfigSchema = z.strictObject({
  review: ReviewConfigSchema.default({
    mode: 'local',
    depth: 'balanced',
    baseRef: 'main',
    headRef: 'HEAD',
    maxConcurrentTasks: 4,
    maxFiles: 500,
    maxFileBytes: 500000,
    inlineSeverityThreshold: 'high'
  }),
  provider: ProviderConfigSchema.optional(),
  instructions: InstructionsConfigSchema.default({
    files: [],
    inline: ''
  }),
  skills: SkillsConfigSchema.default({
    enabled: false,
    directories: ['.codereviewer/skills'],
    allowTools: ['read', 'list', 'grep']
  }),
  paths: PathsConfigSchema.default({
    include: ['**/*'],
    exclude: [...defaultReviewExcludePatterns],
    artifactDir: '.codereviewer/runs'
  }),
  baseline: BaselineConfigSchema.default({
    enabled: true,
    path: '.codereviewer/baseline.json',
    failOnNewOnly: true,
    includeResolvedInReport: true
  }),
  qualityGate: QualityGateConfigSchema.default({
    maxCritical: 0,
    maxHigh: 0,
    failOnProviderError: true
  }),
  aiReview: AiReviewConfigSchema.default({
    requireRefutation: true,
    deterministicSignalMode: 'support',
    actionableSeverityThreshold: 'medium'
  }),
  promotionPolicy: PromotionPolicyConfigSchema.default({
    modelWeakOrRefuted: 'artifact-only'
  }),
  security: SecurityConfigSchema.default({
    allowShell: false,
    allowNetwork: false,
    allowFilesystemWrite: false,
    captureContentTelemetry: false
  }),
  reporting: ReportingConfigSchema.default({
    formats: ['json', 'markdown', 'sarif'],
    sarif: {
      target: 'generic',
      category: 'codereviewer',
      maxResults: 5000,
      redact: true
    }
  }),
  evaluation: EvaluationConfigSchema.default({
    enabled: false
  }),
  drift: DriftConfigSchema.default({
    enabled: true,
    failOn: ['generated-artifact-drift', 'security-drift'],
    includeDocs: true,
    includeSpecs: true,
    includeGenerated: true
  }),
  observability: ObservabilityConfigSchema.default({
    logging: {
      level: 'silent'
    },
    openTelemetry: {
      enabled: false,
      headers: {},
      serviceName: 'codereviewer'
    }
  }),
  costs: CostConfigSchema.default({})
})

export type Severity = z.infer<typeof SeveritySchema>
export type ReportFormat = z.infer<typeof ReportFormatSchema>
export type RepositoryRelativePath = z.infer<typeof RepositoryRelativePathSchema>
export type ReviewConfig = z.infer<typeof ReviewConfigSchema>
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>
export type InstructionsConfig = z.infer<typeof InstructionsConfigSchema>
export type SkillsConfig = z.infer<typeof SkillsConfigSchema>
export type PathsConfig = z.infer<typeof PathsConfigSchema>
export type BaselineConfig = z.infer<typeof BaselineConfigSchema>
export type QualityGateConfig = z.infer<typeof QualityGateConfigSchema>
export type AiReviewConfig = z.infer<typeof AiReviewConfigSchema>
export type PromotionPolicyConfig = z.infer<typeof PromotionPolicyConfigSchema>
export type SecurityConfig = z.infer<typeof SecurityConfigSchema>
export type DriftCategory = z.infer<typeof DriftCategorySchema>
export type DriftConfig = z.infer<typeof DriftConfigSchema>
export type ReportingConfig = z.infer<typeof ReportingConfigSchema>
export type EvaluationConfig = z.infer<typeof EvaluationConfigSchema>
export type OpenTelemetryConfig = z.infer<typeof OpenTelemetryConfigSchema>
export type LoggingConfig = z.infer<typeof LoggingConfigSchema>
export type ObservabilityConfig = z.infer<typeof ObservabilityConfigSchema>
export type CostConfig = z.infer<typeof CostConfigSchema>
export type CodeReviewerConfig = z.infer<typeof CodeReviewerConfigSchema>
