import { z } from 'zod'

export const SeveritySchema = z.enum(['critical', 'high', 'medium', 'low', 'info'])

// Ordinal ranking of severities, low to high. Exported so severity-floor checks
// (admission threshold, the fix lane's `minSeverity` gate) share one ordering
// instead of re-deriving it.
const severityOrder: Readonly<Record<z.infer<typeof SeveritySchema>, number>> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
}

export const severityMeetsThreshold = (
  severity: z.infer<typeof SeveritySchema>,
  threshold: z.infer<typeof SeveritySchema>
): boolean => severityOrder[severity] >= severityOrder[threshold]

export const ReportFormatSchema = z.enum([
  'json',
  'markdown',
  'sarif'
])

// Renderer selection for platform-neutral review comments. `auto` runs platform
// detection (CI env, then git remote host, then `generic`); the other values
// pin a specific renderer and skip detection (spec 13).
export const ReviewCommentPlatformSchema = z.enum([
  'github',
  'gitlab',
  'bitbucket',
  'generic',
  'auto'
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

// Agentic cross-file discovery (spec 16). Off by default. When enabled, the
// holistic discovery agent may call the mediated repo read/list/grep tools to
// inspect code in files outside the changed set — the callee body, interface, or
// permission definition a suspected defect depends on — bounded by a per-task
// tool-call cap that CODE enforces. Its findings pass the SAME refutation and
// admission as any other candidate. Disabled, discovery is single-shot with no
// tools and the run is byte-for-byte unchanged.
export const CrossFileRetrievalConfigSchema = z.strictObject({
  enabled: z.boolean().default(false),
  // Runaway-loop guard: the maximum mediated tool calls one discovery task may
  // make. It exists to bound a model that never stops requesting reads, NOT to
  // ration context — measurement showed the model self-limits well below the cap
  // (0-7 calls when 8 were allowed, never exhausting it), so a tight cap only
  // starves the tasks that genuinely need several lookups.
  maxToolCallsPerTask: z.int().min(1).max(500).default(100),
  // Per-read byte cap for cross-file reads specifically. Retrieval reads whole
  // files, and a single large one measurably dilutes the review: a task that read
  // 162KB in one call lost a finding the same task made without retrieval. This cap
  // keeps a retrieved file to a useful excerpt; the model can grep to locate the
  // part it needs rather than pulling an entire large file into the prompt.
  maxBytesPerRead: z.int().min(1000).max(200000).default(24000)
})

// Context scout (spec 18). Off by default. Separates CHOOSING context from
// JUDGING code: a cheap scout call sees only the diff and a symbol inventory and
// names the out-of-change symbols the changed code's correctness depends on,
// deterministic code fetches their bodies, and the reviewer stays single-shot
// with no tools. This exists because spec 16 — giving the REVIEWER the tools —
// lost recall every time it was measured (68.8% to 56.3% at sixteen cases) while
// the tool-free reviewer measured ~68% recall at 100% adjusted precision. The
// scout only selects context; it can never influence a finding, severity, or the
// gate, and a symbol it names is injected only if deterministic resolution finds
// it.
export const ContextScoutConfigSchema = z.strictObject({
  enabled: z.boolean().default(false),
  // How many symbols one scout call may request. The reproducible failure mode of
  // extra context is dilution, so this is a relevance ration rather than a loop
  // guard: the scout must rank and spend its budget on the decisive symbols
  // instead of dumping every callee the change touches into the packet.
  maxSymbols: z.int().min(1).max(40).default(8),
  // Per-symbol byte cap on an extracted body. A single large callee must not
  // flood the referenced-definition section and push the changed files out of the
  // packet — budget pressure sheds scout context, never changed-file source. Big
  // enough to carry a whole ordinary function body, not a whole large file.
  maxBytesPerSymbol: z.int().min(500).max(40000).default(4000)
})

// Enumeration sweep: extra discovery calls per task, each told what has already
// been reported and asked only for further, distinct defects. A single discovery
// response answers with the defect it is most confident about and stops, so a
// file holding two defects yields one; asking again is what makes the review
// enumerate rather than answer. Rounds stop early as soon as one adds nothing.
export const DiscoverySweepConfigSchema = z.strictObject({
  maxAdditionalRounds: z.int().min(0).max(4).default(0)
})

// The diverse-lens second pass required by spec 05's Holistic Discovery: the same
// change re-read through a lens aimed at defect classes a general read commonly
// walks past. Distinct from the sweep, which asks the same question again; this
// asks a different question, which is the point — a second look from the same
// vantage mostly reproduces the first.
export const DiscoveryLensPassConfigSchema = z.strictObject({
  enabled: z.boolean().default(false)
})

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
  runTimeoutMs: z.int().min(10000).max(7200000).optional(),
  crossFileRetrieval: CrossFileRetrievalConfigSchema.default({
    enabled: false,
    maxToolCallsPerTask: 100,
    maxBytesPerRead: 24000
  }),
  contextScout: ContextScoutConfigSchema.default({
    enabled: false,
    maxSymbols: 8,
    maxBytesPerSymbol: 4000
  }),
  discoverySweep: DiscoverySweepConfigSchema.default({
    maxAdditionalRounds: 0
  }),
  discoveryLensPass: DiscoveryLensPassConfigSchema.default({ enabled: false })
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

// Dedicated additive security review pass (spec 15, Mechanism 1). Off by default.
// When enabled, each review task issues a SECOND, security-only discovery call that
// applies a generic OWASP/CWE checklist to the changed code. Its candidates are
// additive: they merge with the general pass's candidates and never displace them,
// so the pass can only raise security recall and cannot reduce the general
// reviewer's. They flow through the SAME refutation + admission as any other
// candidate; the pass never bypasses scope, severity, baseline, or the gate. A
// dedicated call (not an in-prompt checklist) is used because measurement showed
// folding the checklist into the general prompt trades the dominant authorization
// class for the injection classes (finite attention); a separate call removes that
// tradeoff.
export const SecurityDedicatedPassConfigSchema = z.strictObject({
  enabled: z.boolean().default(false)
})

// Deterministic security-signal evidence layer (spec 15, Mechanism 2). Wired now
// as configuration only; reserved for a later signal layer and carries no behavior
// in this phase.
export const SecuritySignalsConfigSchema = z.strictObject({
  enabled: z.boolean().default(false)
})

export const SecurityConfigSchema = z.strictObject({
  allowShell: z.literal(false).default(false),
  allowNetwork: z.literal(false).default(false),
  allowFilesystemWrite: z.literal(false).default(false),
  captureContentTelemetry: z.literal(false).default(false),
  dedicatedPass: SecurityDedicatedPassConfigSchema.default({ enabled: false }),
  signals: SecuritySignalsConfigSchema.default({ enabled: false })
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

// External change-intent context ingestion (spec 11). Phase 1 ships the two
// no-network providers; the `platform` adapter (event/api) is a later phase and
// is added to this union when its adapter lands, so config validation never
// accepts a provider the runtime cannot honor.
export const ContextInboxProviderSchema = z.strictObject({
  type: z.literal('inbox'),
  // Directory a pipeline writes frontmatter-markdown context files into before
  // the review. Filesystem-only, resolved under the repository root.
  dir: RepositoryRelativePathSchema.default('.codereviewer/context'),
  maxFiles: z.int().min(1).max(200).default(20),
  maxFileBytes: z.int().min(1).max(1_000_000).default(64_000)
})

export const ContextChangedFilesProviderSchema = z.strictObject({
  type: z.literal('changed-files'),
  // Globs selecting PR-changed repository files to surface as intent context
  // (for example changed specs/docs that explain the code change).
  include: z.array(z.string()).min(1).default(['**/*.md']),
  maxFiles: z.int().min(1).max(200).default(20),
  maxFileBytes: z.int().min(1).max(1_000_000).default(64_000)
})

export const ContextProviderConfigSchema = z.discriminatedUnion('type', [
  ContextInboxProviderSchema,
  ContextChangedFilesProviderSchema
])

export const ContextSummaryConfigSchema = z.strictObject({
  // `model` runs the dedicated summarizer call; `digest` is deterministic. When
  // omitted the mode is resolved at runtime: `model` if a provider is
  // configured, otherwise `digest`.
  mode: z.enum(['model', 'digest']).optional(),
  maxBytes: z.int().min(256).max(20_000).default(4_000)
})

export const ContextSourcesConfigSchema = z.strictObject({
  enabled: z.boolean().default(false),
  providers: z.array(ContextProviderConfigSchema).default([]),
  summary: ContextSummaryConfigSchema.default({ maxBytes: 4_000 })
})

// Agentic verification flow (spec 12). Off by default: with `enabled: false` no
// claim provider runs and the general review is byte-for-byte unchanged. Claim
// providers mirror the context-ingestion provider pattern (spec 11) — filesystem
// only, no network — and are added to the discriminated union without changing
// the flow when a new provider type ships.
export const VerificationClaimsFileProviderSchema = z.strictObject({
  type: z.literal('claims-file'),
  // Neutral claims file a pipeline writes before the run.
  path: RepositoryRelativePathSchema
})

export const VerificationPriorFindingsProviderSchema = z.strictObject({
  type: z.literal('prior-findings'),
  // A previous run's report (or the baseline) to derive "still holds / fixed?"
  // claims from.
  report: RepositoryRelativePathSchema
})

export const VerificationClaimProviderConfigSchema = z.discriminatedUnion('type', [
  VerificationClaimsFileProviderSchema,
  VerificationPriorFindingsProviderSchema
])

export const VerificationConfigSchema = z.strictObject({
  enabled: z.boolean().default(false),
  providers: z.array(VerificationClaimProviderConfigSchema).default([]),
  // Deterministic bound on the investigate_claim agent loop: exceeding it ends the
  // claim with an `uncertain` verdict rather than looping unboundedly.
  maxToolCallsPerClaim: z.int().min(1).max(50).default(12),
  // Mirrors the context-retrieval domain's read/search budget defaults so the
  // verification tools behave consistently with the general review's mediated
  // reads.
  maxBytesPerRead: z.int().min(1).default(20000),
  maxMatches: z.int().min(1).default(20)
})

// Agentic finding investigation-and-fix job (spec 12). Off by default. Reuses the
// same investigation agent, mediated tools, and per-claim bounds as
// `verification`; `enabled` is the single switch for the whole single pass
// (judgment and fix together). `minSeverity` gates which admitted findings the
// lane runs on. It is left optional here and resolved at runtime to
// `aiReview.actionableSeverityThreshold` (default `medium`) when unset, so out of
// the box the lane runs on exactly the findings that can block the pipeline, not
// on nits. Set it explicitly to `info` to cover every finding or `critical` for
// blockers only.
export const FixConfigSchema = z.strictObject({
  enabled: z.boolean().default(false),
  minSeverity: SeveritySchema.optional()
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

// Platform-neutral inline review comments (spec 13). Disabled by default. When
// enabled, the run writes a neutral `review-comments.json` plus a rendered
// `review-comments.<platform>.json`; it performs no network publishing.
export const ReviewCommentsConfigSchema = z.strictObject({
  enabled: z.boolean().default(false),
  platform: ReviewCommentPlatformSchema.default('auto')
})

export const ReportingConfigSchema = z.strictObject({
  formats: z.array(ReportFormatSchema).default(['json', 'markdown', 'sarif']),
  sarif: SarifReportingConfigSchema.default({
    target: 'generic',
    category: 'codereviewer',
    maxResults: 5000,
    redact: true
  }),
  reviewComments: ReviewCommentsConfigSchema.default({
    enabled: false,
    platform: 'auto'
  })
})

export const EvaluationConfigSchema = z.strictObject({
  enabled: z.boolean().default(false),
  // Minimum semantic-judge agreement against the committed calibration set. The
  // judge is the sole authority for every eval quality metric, so a run whose
  // agreement falls below this bar reports `scoring.judgeTrustworthy = false`.
  minJudgeAgreement: z.number().min(0).max(1).default(0.9)
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
  // Price per million cached input tokens. When set, the cached subset of input
  // tokens is re-priced at this (typically lower) rate. When unset, cached input
  // falls back to the full input price (no fabricated discount).
  cachedInputPerMillion: z.number().min(0).optional(),
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
    inlineSeverityThreshold: 'high',
    crossFileRetrieval: {
      enabled: false,
      maxToolCallsPerTask: 100,
      maxBytesPerRead: 24000
    },
    contextScout: {
      enabled: false,
      maxSymbols: 8,
      maxBytesPerSymbol: 4000
    },
    discoverySweep: {
      maxAdditionalRounds: 0
    },
    discoveryLensPass: { enabled: false }
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
  contextSources: ContextSourcesConfigSchema.default({
    enabled: false,
    providers: [],
    summary: { maxBytes: 4_000 }
  }),
  verification: VerificationConfigSchema.default({
    enabled: false,
    providers: [],
    maxToolCallsPerClaim: 12,
    maxBytesPerRead: 20000,
    maxMatches: 20
  }),
  fix: FixConfigSchema.default({
    enabled: false
  }),
  security: SecurityConfigSchema.default({
    allowShell: false,
    allowNetwork: false,
    allowFilesystemWrite: false,
    captureContentTelemetry: false,
    dedicatedPass: { enabled: false },
    signals: { enabled: false }
  }),
  reporting: ReportingConfigSchema.default({
    formats: ['json', 'markdown', 'sarif'],
    sarif: {
      target: 'generic',
      category: 'codereviewer',
      maxResults: 5000,
      redact: true
    },
    reviewComments: {
      enabled: false,
      platform: 'auto'
    }
  }),
  evaluation: EvaluationConfigSchema.default({
    enabled: false,
    minJudgeAgreement: 0.9
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
export type CrossFileRetrievalConfig = z.infer<
  typeof CrossFileRetrievalConfigSchema
>
export type ContextScoutConfig = z.infer<typeof ContextScoutConfigSchema>
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>
export type InstructionsConfig = z.infer<typeof InstructionsConfigSchema>
export type SkillsConfig = z.infer<typeof SkillsConfigSchema>
export type PathsConfig = z.infer<typeof PathsConfigSchema>
export type BaselineConfig = z.infer<typeof BaselineConfigSchema>
export type QualityGateConfig = z.infer<typeof QualityGateConfigSchema>
export type AiReviewConfig = z.infer<typeof AiReviewConfigSchema>
export type PromotionPolicyConfig = z.infer<typeof PromotionPolicyConfigSchema>
export type ContextSourcesConfig = z.infer<typeof ContextSourcesConfigSchema>
export type ContextProviderConfig = z.infer<typeof ContextProviderConfigSchema>
export type VerificationConfig = z.infer<typeof VerificationConfigSchema>
export type VerificationClaimProviderConfig = z.infer<
  typeof VerificationClaimProviderConfigSchema
>
export type FixConfig = z.infer<typeof FixConfigSchema>
export type SecurityConfig = z.infer<typeof SecurityConfigSchema>
export type SecurityDedicatedPassConfig = z.infer<
  typeof SecurityDedicatedPassConfigSchema
>
export type SecuritySignalsConfig = z.infer<typeof SecuritySignalsConfigSchema>
export type DriftCategory = z.infer<typeof DriftCategorySchema>
export type DriftConfig = z.infer<typeof DriftConfigSchema>
export type ReportingConfig = z.infer<typeof ReportingConfigSchema>
export type ReviewCommentPlatform = z.infer<typeof ReviewCommentPlatformSchema>
export type ReviewCommentsConfig = z.infer<typeof ReviewCommentsConfigSchema>
export type EvaluationConfig = z.infer<typeof EvaluationConfigSchema>
export type OpenTelemetryConfig = z.infer<typeof OpenTelemetryConfigSchema>
export type LoggingConfig = z.infer<typeof LoggingConfigSchema>
export type ObservabilityConfig = z.infer<typeof ObservabilityConfigSchema>
export type CostConfig = z.infer<typeof CostConfigSchema>
export type CodeReviewerConfig = z.infer<typeof CodeReviewerConfigSchema>
