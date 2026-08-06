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

// Review mode and depth. Declared here rather than beside the report contract
// that also carries them, because `review.mode`/`review.depth` and
// `RunSummary.mode`/`RunSummary.depth` are the SAME value travelling from
// configuration into the report: two enum literals would let a mode be
// configurable but unreportable (or the reverse) with nothing failing.
export const ReviewModeSchema = z.enum(['local', 'ci', 'pr', 'full'])
export const ReviewDepthSchema = z.enum(['fast', 'balanced', 'thorough'])

// Concrete platform a review-comment draft can be rendered for.
export const PlatformTargetSchema = z.enum([
  'github',
  'gitlab',
  'bitbucket',
  'generic'
])

// Renderer selection for platform-neutral review comments. `auto` runs platform
// detection (CI env, then git remote host, then `generic`); the other values
// pin a specific renderer and skip detection (spec 13). Derived from
// `PlatformTargetSchema` so a newly supported renderer becomes configurable in
// the same edit that makes it renderable.
export const ReviewCommentPlatformSchema = z.enum([
  ...PlatformTargetSchema.options,
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
  // ON by default since 2026-08-01, and the reasoning matters because the recall
  // gain is NOT statistically significant.
  //
  // It was long recorded as net negative and shipped off. That verdict turned out to
  // be measuring a bug — every retrieved file was cut at the per-read cap with the
  // model never told, so it concluded things were missing from code it had only
  // partly seen. With the cut now disclosed, two independent runs put it ahead on
  // EVERY measured dimension: recall up both times (+5.7pp, +2.3pp), adjusted
  // precision at 100% both times against 97.4% and 95.0%, cost DOWN both times
  // (-8%, -5%), latency inside noise, and zero provider errors across all four arms.
  //
  // Significance is the bar for CLAIMING a benefit; it is not the bar for permitting
  // a default that is free, harmless, and directionally positive twice. Demanding
  // proof of gain before allowing a no-cost change is the wrong test, and it would
  // also keep the feature off for models that might use tools better than the one it
  // was measured on.
  //
  // What is NOT claimed: a specific recall improvement. Both runs used one model on
  // one corpus. If a regression ever appears, this is the first switch to flip.
  enabled: z.boolean().default(true),
  // Runaway-loop guard: the maximum mediated tool calls one discovery task may
  // make. It exists to bound a model that never stops requesting reads, NOT to
  // ration context — measurement showed the model self-limits well below the cap
  // (0-7 calls when 8 were allowed, never exhausting it), so a tight cap only
  // starves the tasks that genuinely need several lookups.
  maxToolCallsPerTask: z.int().min(1).max(500).default(100),
  // Optional per-read byte cap. UNSET by default (spec 28): no proactive cut.
  //
  // It used to default to 24,000 — roughly 600 lines — chosen defensively and never
  // measured. It cut files mid-read while telling the model nothing, and three
  // separate measurements recorded cross-file retrieval as harmful when what they
  // were measuring was the cap. The files most worth consulting are precisely the
  // large ones it truncated.
  //
  // The reviewer now narrows a read itself, by line range, after locating what it
  // needs with grep. When a real limit binds, the provider says so and the read
  // budget is reduced on retry. Setting this is a deliberate operator choice and
  // still binds, with the cut disclosed.
  maxBytesPerRead: z.int().min(1000).max(4000000).optional()
})

// Mediated cross-file retrieval inside the REFUTATION stage (spec 05). Off by
// default, and unmeasured: no run has been scored with it on, so nothing is claimed
// about what it does to precision or recall. It may move recall in either direction
// — a better-informed refuter may rescue candidates it previously could only mark
// `needs-more-evidence`, or refute candidates it previously let pass — and the
// pre-registered decision rule that settles which lives in spec 05.
//
// When enabled, the refutation agent is given the same mediated repo read/list/grep
// tools discovery may hold, through the same retriever, eligibility gate, redaction
// and ledger. Disabled, the refuter is offered no tool, its prompt is byte-for-byte
// the base prompt, and the stage behaves exactly as it did before this key existed.
export const RefutationRetrievalConfigSchema = z.strictObject({
  enabled: z.boolean().default(false),
  // Runaway-loop guard on ONE refutation call, enforced by code. It is the refuter's
  // own budget: a fresh allowance is granted per adjudication call and is never
  // shared with, nor drawn from, `crossFileRetrieval.maxToolCallsPerTask`, so
  // enabling one stage cannot starve the other.
  //
  // Sized from the shape of the call rather than from a measurement, because there
  // is none: a refutation call adjudicates a BATCH of candidates, where the
  // per-claim investigation lane (`verification.maxToolCallsPerClaim`, default 12)
  // adjudicates one claim. Twice that leaves room for a locate-then-read pair on
  // several candidates while still bounding a model that never stops asking. The
  // worst-case cost this admits is stated in the spec: `maxToolCallsPerBatch` tool
  // calls per refutation call, and a batch that splits or retries is another call.
  maxToolCallsPerBatch: z.int().min(1).max(500).default(24)
})

// Accepted range for `review.maxConcurrentTasks`. Exported because `eval run`
// also accepts it as a flag: a flag range that drifted below the schema's would
// reject a value the config allows, and one above it would be accepted by the
// parser and then rejected by config validation.
export const maxConcurrentTasksBounds = { min: 1, max: 32 } as const

export const ReviewConfigSchema = z.strictObject({
  mode: ReviewModeSchema.default('local'),
  depth: ReviewDepthSchema.default('balanced'),
  baseRef: gitRefSchema.default('main'),
  headRef: gitRefSchema.default('HEAD'),
  maxConcurrentTasks: z
    .int()
    .min(maxConcurrentTasksBounds.min)
    .max(maxConcurrentTasksBounds.max)
    .default(4),
  maxFiles: z.int().min(1).max(10000).default(500),
  maxFileBytes: z.int().min(1).max(5000000).default(500000),
  contextMaxBytes: z.int().min(10000).max(10000000).optional(),
  inlineSeverityThreshold: SeveritySchema.default('high'),
  maxCostUsd: z.number().min(0).optional(),
  crossFileRetrieval: CrossFileRetrievalConfigSchema.prefault({}),
  refutationRetrieval: RefutationRetrievalConfigSchema.prefault({})
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

// One configured instruction file, with an optional path scope. `scope`
// reuses the exact glob dialect `paths.include`/`paths.exclude` already match
// repository-relative paths with (`shared/glob/glob-matcher.ts`: `*`, `**`,
// `?`) — there is deliberately no second matcher here, only a second field
// that gets compiled through the same one.
//
// Omitted `scope` keeps this instruction repo-wide, applied to every review
// task exactly as `instructions.files` behaved before scoping existed: the
// unscoped case is not a special zero-pattern scope, it is the absence of one,
// so an operator who never asks for scoping sees byte-for-byte the same
// config and the same packets as before this change.
//
// `scope: []` is rejected (`.min(1)`) rather than accepted as "matches
// nothing": an empty array reads as a typo or a leftover from removing every
// pattern, and silently turning it into "never include this instruction"
// would be exactly the silent-optimism-shaped mistake this project has a
// standing rule against — the config would parse, the instruction would stop
// appearing anywhere, and nothing would say why. Delete the key to go back to
// unscoped, or write at least one real pattern.
export const InstructionFileEntrySchema = z.strictObject({
  path: RepositoryRelativePathSchema,
  scope: z.array(z.string().min(1)).min(1).optional()
})

// A task packet covers a CLUSTER of files (`aiReview.maxFilesPerDiscoveryCall`
// batches several changed files into one discovery/refutation call), not one
// file, so "does this instruction's scope match this packet" needs a rule for
// a many-files-to-many-patterns comparison. The engine matches on ANY file in
// the packet matching ANY scope pattern, not on every file matching.
//
// This is the fail-safe direction. Guidance a reader never sees is invisible
// and uncatchable; guidance shown for one extra file in a mixed packet is
// merely some noise the reader can see and discount. An `all-files-must-match`
// rule would silently withhold a `backend/**`-scoped instruction from a
// packet that batches one backend file with one unrelated file purely because
// task clustering happened to combine them — the exact "absence produces a
// plausible answer" shape this project keeps finding and fixing elsewhere.
//
// `inline` stays a single unscoped string rather than gaining the same
// `scope` field. It is operator-typed free text (a config value or a CLI/env
// override), not a checked-in document — there is only ever one of it, so
// "which area does THIS one apply to" is not a question multiple inline
// blocks could answer differently. A team that wants area-specific free text
// already has the strictly better tool for it: a short scoped file under
// `instructions.files`, which is git-diffable, reviewable, and requires no
// second scoping shape for a single string. Keeping `inline` simple is a
// deliberate choice, not an oversight.
export const InstructionsConfigSchema = z.strictObject({
  files: z.array(InstructionFileEntrySchema).default([]),
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
  dedicatedPass: SecurityDedicatedPassConfigSchema.prefault({})
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
  // A plain boolean, defaulting ON. It used to be `.optional()`, which made it a
  // TRI-state where `undefined` and `true` behaved identically and only an explicit
  // `false` meant anything — so every reader had to write `=== false` and get that
  // right. The goal is that naming a provider and a model is enough to get a
  // review; this says so in the schema instead of leaving it implicit.
  enabled: z.boolean().default(true),
  requireRefutation: z.literal(true).default(true),
  deterministicSignalMode: z.enum(['support', 'disabled']).default('support'),
  // Minimum severity for a MODEL-origin finding to be admitted as actionable.
  // Below this, model findings are rejected as below-threshold (still recorded as
  // rejected findings, so they remain auditable). Default `medium` keeps the
  // engine focused on impactful runtime/security defects and out of low-severity
  // nit noise (aligned with the low-noise product vision). Trusted
  // deterministic-rule findings are exempt. Lower to `low`/`info` to surface more.
  actionableSeverityThreshold: SeveritySchema.default('medium'),
  // Spec 27: how many changed files ONE discovery call may review. A task covering
  // more is partitioned across several calls whose candidates are unioned.
  //
  // Discovery yield tracks CALL COUNT, not defect count. Measured law: a file that
  // gets any attention yields ~1.2 findings — invariant across a 19x range of
  // files-per-call and across two corpora — while per-call yield is SUB-LINEAR in
  // scope (~0.46 * files^0.70). Partitioning raises the SHARE of files looked at
  // (11% -> 27%); it never raises per-file yield.
  //
  // Default 2, chosen by MEASUREMENT rather than by feel — a sweep of 1 / 2 / 4 /
  // unlimited on the 21 largest benchmark cases. 2 matched the strongest setting (1)
  // exactly on both recall and adjusted precision while costing 27% less, and it is
  // the only arm in the sweep whose recall gain was statistically significant.
  //
  // Partitioning only engages above this many changed files, so a typical small
  // change is unaffected; the cost applies to large changes, which are precisely the
  // ones the unpartitioned reviewer served worst.
  maxFilesPerDiscoveryCall: z.int().min(1).default(2)
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
  summary: ContextSummaryConfigSchema.prefault({})
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
  // Optional per-read byte cap. UNSET by default, for the same reason
  // `review.crossFileRetrieval.maxBytesPerRead` is (spec 28): no proactive cut.
  //
  // It defaulted to 20,000 — roughly 500 lines — under a comment saying it
  // "mirrors the context-retrieval domain's defaults". It stopped mirroring
  // anything when spec 28 removed that domain's cap, and the reason spec 28
  // removed it applies here unchanged: a byte cap chosen in advance cuts the
  // file mid-read, and the files most worth consulting during an investigation
  // are precisely the large ones it cuts. A claim resolved against the first
  // 500 lines of a file is not a claim resolved against the file.
  //
  // What replaces it is not a bigger guess. The investigator narrows its own
  // read by line range after locating what it needs with `repo_grep`; a cut that
  // does happen is disclosed in the tool output the model reads; and a provider
  // that genuinely refuses the context says so, which is handled where the claim
  // runs rather than pre-empted here. Setting this is a deliberate operator
  // choice and still binds, with the cut disclosed.
  maxBytesPerRead: z.int().min(1000).max(4000000).optional(),
  maxMatches: z.int().min(1).default(20)
})

// Change-impact adjudication (spec 22 design step 3). Off by default, and
// SEPARATELY off from the command that hosts it.
//
// The second switch is not redundant. Everything else `impact check` does is
// deterministic and free; adjudication is the only part that can reach a provider,
// and turning `changeImpact.enabled` on must not silently start billing an
// operator who asked for the reference list. It also stays off for spec 22's own
// reason — the capability stays disabled until measured, and this layer is the
// unmeasured one.
const ChangeImpactAdjudicationConfigSchema = z.strictObject({
  enabled: z.boolean().default(false),
  // Upper bound on MODEL calls per run. Deterministic verdicts — a removed,
  // relocated or newly added declaration — are free and are never bounded by it,
  // so this caps the residue only: dependents of a symbol whose behaviour moved.
  //
  // Binding it is disclosed rather than absorbed: `summary.adjudicationCallsTruncated`
  // says a bounded run happened, and every pair past the cap is counted as
  // unadjudicated instead of being reported as a weak finding.
  maxCalls: z.int().min(1).max(500).default(40)
})

// Change-impact review (spec 22). Off by default until measured, and reached
// only by the separate `impact check` command — never by `review`.
//
// The bounds below are the whole cost model. The deterministic core makes no
// provider call and its only resource is repository traversal; the adjudication
// block above is the one part that can spend, and it is separately disabled. The
// traversal bounds are deliberately per-run and per-symbol rather than one global
// pool, because a change touching forty symbols must not let the first symbol
// consume the entire reference budget.
//
// THERE IS NO `blocking` KEY, AND THERE WILL NOT BE ONE. This is settled, not
// pending: spec 22 makes the lane non-blocking and states that it "MUST NOT be
// configurable to block". There is nothing to block on, because a breaking change
// is frequently intentional and the tool's job is to surface the dependents rather
// than to decide whether breaking them is acceptable. A `blocking` key would be a
// switch that changes nothing — worse than absent, because an operator could set it
// and believe the build was gated. The object is strict, so setting one is a
// configuration error rather than a silent no-op, which is the mistake
// `SecurityConfigSchema` above records having already made once.
export const ChangeImpactConfigSchema = z.strictObject({
  enabled: z.boolean().default(false),
  // Upper bound on the changed symbols seeded from the diff. Each seed costs one
  // repository search, so this is what bounds total traversal.
  maxChangedSymbols: z.int().min(1).max(500).default(50),
  // Per-symbol cap on reported reference sites. A symbol referenced more than
  // this many times is reported truncated rather than dropped, so the report
  // never silently understates how widely a symbol is used.
  maxReferencesPerSymbol: z.int().min(1).max(500).default(25),
  // Directory levels the reference search descends from the repository root.
  // Mirrors the context-retrieval traversal bound of the same name.
  maxSearchDepth: z.int().min(0).max(32).default(12),
  adjudication: ChangeImpactAdjudicationConfigSchema.prefault({})
})

// Intent-fulfilment review (spec 23). Off by default until measured, and reached
// only by the separate `intent check` command — never by `review`.
//
// The bounds here are the whole cost model, and unlike change-impact this
// capability does spend: one extraction call, one judgement call per obligation,
// and one explanation call per run. `maxObligations` is therefore the primary
// spend bound — it caps both how many obligations are reported and how many
// judgement calls the run can issue.
//
// There is deliberately no `blocking` key, and unlike `changeImpact` there is no
// later change that adds one. Spec 23 makes advisory-only a REQUIREMENT rather
// than a default: "The command MUST NOT be able to fail a pipeline on fulfilment
// grounds. This is not configurable", because the measured spurious-rejection
// rate of model requirement-conformance judgement (26-36%, rising to 73-88% when
// the same call also explains itself) is not accurate enough to gate on. A
// `blocking` key would be accepted and then silently ignored, which is the
// mistake `SecurityConfigSchema` above records having already made once.
export const IntentFulfilmentConfigSchema = z.strictObject({
  enabled: z.boolean().default(false),
  // EVERY LIMIT BELOW IS A RUNAWAY GUARD, NOT A RATION. The distinction is not
  // stylistic: all three degrade the answer SILENTLY when they bind, so a limit set
  // where real inputs reach it turns this capability into one that reports "nothing
  // left to do" because it could not see, not because there was nothing.
  //
  // Two of the three were set as rations, and both were measured on 2026-08-01:
  //
  //   maxObligations was 20. On a 28-case corpus of real specification sections,
  //   24 runs returned EXACTLY their cap. The checklist was being cut off routinely.
  //
  //   maxChangeLines was 400. Over this repository's last 60 commits, 43% change
  //   more than 400 lines — median 350, p90 2809. On nearly half of real changes the
  //   judgement saw a partial diff, and a judgement that cannot see the evidence
  //   reports the obligation UNADDRESSED. Silently wrong, in the direction that
  //   matters, on the capability's only question.
  //
  // The precedent for the shape is `maxToolCallsPerTask` above: "It exists to bound
  // a model that never stops requesting reads, NOT to ration — a tight cap only
  // starves the tasks that genuinely need several lookups."
  //
  // Upper bound on obligations extracted from the stated intent, and therefore on
  // judgement calls: one call judges one obligation, so this is also the spend
  // bound. Measured at ~$0.008 per obligation over 37 runs, so a ticket that
  // genuinely states 100 requirements costs ~$0.80 — against ~$1.40 for one
  // `review` run. The cost is set by the intent, not by this number: raising it
  // cannot make a small ticket expensive.
  maxObligations: z.int().min(1).max(100).default(100),
  // Cap on the redacted change-intent text handed to the extraction call. The
  // ingestion providers already bound themselves per file; this bounds the SUM,
  // because a pipeline can configure several of them.
  //
  // 20 000 was kept for one revision on the grounds that no measurement showed it
  // binding. That was the wrong test: every corpus case used SINGLE-SOURCE intent —
  // one commit message, or one specification slice — so the sum this limit exists
  // to bound was never exercised. Absence of evidence from a corpus that cannot
  // produce it is not evidence of absence, and a ticket plus a linked issue plus a
  // review thread passes 20 KB without being unusual.
  //
  // The cost asymmetry also runs the other way from the two limits above. Those
  // bound work that scales per obligation; this bounds ONE extraction call per run,
  // so a larger value buys a bigger prompt once, while binding costs a silently
  // incomplete checklist for the whole run. 100 KB is roughly 25 000 tokens on a
  // single call — bounded, affordable, and far above any realistic stated intent.
  //
  // The ceiling stays at 200 000 so a pipeline that genuinely needs more has room
  // without a schema change, and so a run that reaches even this default is a
  // signal worth acting on rather than a wall.
  maxIntentBytes: z.int().min(256).max(200_000).default(100_000),
  // Cap on the changed lines shown to each judgement call. The judgement may only
  // cite a line the change actually touched, so this is what bounds the evidence
  // surface a judgement is allowed to draw from — and therefore the limit whose
  // binding does the most damage.
  maxChangeLines: z.int().min(1).max(5_000).default(5_000)
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
  sarif: SarifReportingConfigSchema.prefault({}),
  reviewComments: ReviewCommentsConfigSchema.prefault({})
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
  overrides: EvalRegressionGateOverridesSchema.prefault({})
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
  regressionGate: EvalRegressionGateConfigSchema.prefault({})
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
  logging: LoggingConfigSchema.prefault({}),
  openTelemetry: OpenTelemetryConfigSchema.prefault({})
})

export const CostConfigSchema = z.strictObject({
  inputPerMillion: z.number().min(0).optional(),
  // Price per million cached input tokens. When set, the cached subset of input
  // tokens is re-priced at this (typically lower) rate. When unset, cached input
  // falls back to the full input price (no fabricated discount).
  cachedInputPerMillion: z.number().min(0).optional(),
  outputPerMillion: z.number().min(0).optional()
})

// EVERY nested block below uses `.prefault({})`, never `.default({...})`.
//
// Zod's `.default(value)` returns that value VERBATIM without parsing it, so a
// restated literal becomes a SECOND source of truth that silently wins. This bit:
// `crossFileRetrieval.enabled` was changed to `true` on the field itself and the
// engine kept using `false`, because the restated literal here still said `false`.
// The schema said one thing, the engine did another, tests passed, nothing failed.
//
// `.prefault({})` parses `{}` through the schema, so each field's own default is the
// single source of truth. Converting all 29 blocks was verified to leave the parsed
// default configuration byte-identical — the literals were pure duplication, which is
// exactly why the drift was invisible.
export const CodeReviewerConfigSchema = z.strictObject({
  review: ReviewConfigSchema.prefault({}),
  provider: ProviderConfigSchema.optional(),
  instructions: InstructionsConfigSchema.prefault({}),
  skills: SkillsConfigSchema.prefault({}),
  paths: PathsConfigSchema.prefault({}),
  baseline: BaselineConfigSchema.prefault({}),
  qualityGate: QualityGateConfigSchema.prefault({}),
  aiReview: AiReviewConfigSchema.prefault({}),
  promotionPolicy: PromotionPolicyConfigSchema.prefault({}),
  contextSources: ContextSourcesConfigSchema.prefault({}),
  verification: VerificationConfigSchema.prefault({}),
  changeImpact: ChangeImpactConfigSchema.prefault({}),
  intentFulfilment: IntentFulfilmentConfigSchema.prefault({}),
  fix: FixConfigSchema.prefault({}),
  security: SecurityConfigSchema.prefault({}),
  reporting: ReportingConfigSchema.prefault({}),
  evaluation: EvaluationConfigSchema.prefault({}),
  drift: DriftConfigSchema.prefault({}),
  observability: ObservabilityConfigSchema.prefault({}),
  costs: CostConfigSchema.prefault({})
})

export type Severity = z.infer<typeof SeveritySchema>
export type ReportFormat = z.infer<typeof ReportFormatSchema>
export type ReviewMode = z.infer<typeof ReviewModeSchema>
export type ReviewDepth = z.infer<typeof ReviewDepthSchema>
export type PlatformTarget = z.infer<typeof PlatformTargetSchema>
export type RepositoryRelativePath = z.infer<typeof RepositoryRelativePathSchema>
export type ReviewConfig = z.infer<typeof ReviewConfigSchema>
export type CrossFileRetrievalConfig = z.infer<
  typeof CrossFileRetrievalConfigSchema
>
export type RefutationRetrievalConfig = z.infer<
  typeof RefutationRetrievalConfigSchema
>
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>
export type InstructionsConfig = z.infer<typeof InstructionsConfigSchema>
export type InstructionFileEntry = z.infer<typeof InstructionFileEntrySchema>
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
export type ChangeImpactConfig = z.infer<typeof ChangeImpactConfigSchema>
export type IntentFulfilmentConfig = z.infer<
  typeof IntentFulfilmentConfigSchema
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
