import { z } from 'zod'

export const SeveritySchema = z.enum(['critical', 'high', 'medium', 'low', 'info'])

// Ordinal ranking of severities, low to high. Kept private and reached only
// through the two helpers below, so every consumer — admission's severity floor,
// the fix lane's `minSeverity` gate, discovery's merge ordering, the report sort
// — shares one ordering instead of re-deriving it.
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

// Comparator that sorts the most severe first, derived from the same ordering as
// the threshold check above so a ranking and a floor can never disagree about
// which of two severities is higher. Note the inversion: a higher severity yields
// a negative result, which is what puts `critical` ahead of `info` in a sort.
export const compareSeverityDescending = (
  left: z.infer<typeof SeveritySchema>,
  right: z.infer<typeof SeveritySchema>
): number => severityOrder[right] - severityOrder[left]

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

// Discovery posture (spec 20). This selects ONE thing and nothing else: how much
// self-evidence the discovery reviewer demands of itself before it raises a
// candidate.
//
// `precise` is the current, default behaviour — a candidate is raised only when
// the reviewer can support the claim from the code in front of it.
// `investigative` lowers that bar: the reviewer pursues a pattern it finds
// suspicious and reports what it can support, leaving adjudication to refutation
// and admission, which exist for exactly that purpose.
//
// It deliberately does NOT name, hint at, or enumerate any defect category,
// mechanism, or example. A checklist reallocates attention ACROSS categories,
// which was measured here to trade authorization recall for injection recall,
// and that change was rejected on those grounds. The posture also adds no model
// calls and changes neither the packet shape nor its field order, because
// prompt-cache prefix stability is a measured property of this engine.
export const DiscoveryPostureSchema = z.enum(['precise', 'investigative'])

// Independent discovery samples (spec 21). Discovery runs this many times for a
// task, each sample blind to every other, and the candidates are combined by
// UNION and then deduplicated by the semantic finding merge alone.
//
// The change exists because single-run recall and the union across runs differ by
// roughly twenty points on the same corpus: the same defect is found in one run
// and missed in the next. Union is the only permitted combination. Consensus,
// majority voting, and agreement thresholds are forbidden, because agreement
// between samples signals shared error rather than truth, and voting would delete
// precisely the rare single-sample finding this exists to recover.
//
// The upper bound is the published plateau. Beyond it, measured recall stops
// improving while cost keeps rising close to linearly in the sample count — the
// cache probe found provider-side caching unreachable for a repeated identical
// request, so an extra sample is very nearly an extra full-price call.
const maxDiscoverySampleCount = 5

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
  // Spec 20. `precise` until measurement selects otherwise: the posture is a
  // measured variant, not a shipped recommendation.
  discoveryPosture: DiscoveryPostureSchema.default('precise'),
  // Spec 21. `1` until measurement selects otherwise, and `1` is exactly today's
  // single-call path: same packet, same field order, same call count.
  discoverySampleCount: z
    .int()
    .min(1)
    .max(maxDiscoverySampleCount)
    .default(1)
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

// The deterministic security-signal evidence layer (spec 15, Mechanism 2) has no
// implementation yet, so this config surface was removed rather than shipping a
// toggle that silently does nothing (see specs/15-security-focused-review.md).
// Re-add a `signals` key here in the same change that implements the layer.
export const SecurityConfigSchema = z.strictObject({
  allowShell: z.literal(false).default(false),
  allowNetwork: z.literal(false).default(false),
  allowFilesystemWrite: z.literal(false).default(false),
  captureContentTelemetry: z.literal(false).default(false),
  dedicatedPass: SecurityDedicatedPassConfigSchema.default({ enabled: false })
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
  maxResults: z.int().min(1).max(25000).default(5000)
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
    maxResults: 5000
  }),
  reviewComments: ReviewCommentsConfigSchema.default({
    enabled: false,
    platform: 'auto'
  })
})

// Mirrors `EvalRegressionThresholdsSchema`
// (src/domains/evaluation/eval-report-contracts.ts) field-for-field so any
// value that validates here also parses there. It is redefined rather than
// imported: this file is the configuration boundary (shared/contracts) and must
// not depend on an application domain module, since the dependency arrow runs
// config -> domain and never the reverse. `npm run generate:schemas:check` and
// the eval CLI tests catch the two shapes drifting apart.
const EvalRegressionGateOverridesSchema = z.strictObject({
  minParseValidity: z.number().min(0).max(1).optional(),
  minRecall: z.number().min(0).max(1).optional(),
  minPrecision: z.number().min(0).max(1).optional(),
  minSeverityWeightedF1: z.number().min(0).max(1).optional(),
  maxFalsePositiveCount: z.int().min(0).optional(),
  maxCommentsPerKloc: z.number().min(0).optional(),
  maxCommentsPerDiffHunk: z.number().min(0).optional(),
  maxIncompleteCoverageRate: z.number().min(0).max(1).optional(),
  maxContextMutationRate: z.number().min(0).max(1).optional(),
  maxCostUsd: z.number().min(0).optional(),
  maxDurationMs: z.int().min(0).optional(),
  minProductRecall: z.number().min(0).max(1).optional(),
  failOnProviderError: z.boolean().optional()
})

// `stable` (the default) gates `eval run` only on signals that carry zero
// run-to-run sampling variance: parse validity and provider errors are each
// either satisfied or not on a given run, unlike a mean metric such as recall,
// which this project has measured to vary seed-to-seed by several percentage
// points on the primary corpus (see "Metrics" in
// specs/06-evaluation-and-quality-gates.md). `strict` restores the historical
// all-or-nothing behaviour (perfect recall, zero false positives) as an
// explicit opt-in for a maintainer who wants a release-quality bar rather than
// a CI smoke gate. See "Eval Regression Gate" in
// specs/06-evaluation-and-quality-gates.md for the full rationale.
export const EvalRegressionGateProfileSchema = z.enum(['stable', 'strict'])

export const EvalRegressionGateConfigSchema = z.strictObject({
  profile: EvalRegressionGateProfileSchema.default('stable'),
  // Per-field overrides layered on top of the resolved profile; any key set
  // here wins over that profile's value for the same key, so a project can
  // keep the stable default shape while tightening (or loosening) one signal.
  overrides: EvalRegressionGateOverridesSchema.default({})
})

export const EvaluationConfigSchema = z.strictObject({
  // Minimum semantic-judge agreement against the committed calibration set. The
  // judge is the sole authority for every eval quality metric, so a run whose
  // agreement falls below this bar reports `scoring.judgeTrustworthy = false`.
  //
  // There is deliberately no `enabled` key here: case selection is driven by
  // `eval run` CLI flags, not config, so an `enabled` flag would be accepted and
  // then silently ignored (see specs/06-evaluation-and-quality-gates.md).
  minJudgeAgreement: z.number().min(0).max(1).default(0.9),
  regressionGate: EvalRegressionGateConfigSchema.default({
    profile: 'stable',
    overrides: {}
  })
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
    discoveryPosture: 'precise',
    discoverySampleCount: 1
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
    dedicatedPass: { enabled: false }
  }),
  reporting: ReportingConfigSchema.default({
    formats: ['json', 'markdown', 'sarif'],
    sarif: {
      target: 'generic',
      category: 'codereviewer',
      maxResults: 5000
    },
    reviewComments: {
      enabled: false,
      platform: 'auto'
    }
  }),
  evaluation: EvaluationConfigSchema.default({
    minJudgeAgreement: 0.9,
    regressionGate: { profile: 'stable', overrides: {} }
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
export type DiscoveryPosture = z.infer<typeof DiscoveryPostureSchema>
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
export type DriftCategory = z.infer<typeof DriftCategorySchema>
export type DriftConfig = z.infer<typeof DriftConfigSchema>
export type ReportingConfig = z.infer<typeof ReportingConfigSchema>
export type ReviewCommentPlatform = z.infer<typeof ReviewCommentPlatformSchema>
export type ReviewCommentsConfig = z.infer<typeof ReviewCommentsConfigSchema>
export type EvaluationConfig = z.infer<typeof EvaluationConfigSchema>
export type EvalRegressionGateProfile = z.infer<
  typeof EvalRegressionGateProfileSchema
>
export type EvalRegressionGateConfig = z.infer<
  typeof EvalRegressionGateConfigSchema
>
export type OpenTelemetryConfig = z.infer<typeof OpenTelemetryConfigSchema>
export type LoggingConfig = z.infer<typeof LoggingConfigSchema>
export type ObservabilityConfig = z.infer<typeof ObservabilityConfigSchema>
export type CostConfig = z.infer<typeof CostConfigSchema>
export type CodeReviewerConfig = z.infer<typeof CodeReviewerConfigSchema>
