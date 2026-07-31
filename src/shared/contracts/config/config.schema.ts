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
    enabled: true,
    maxToolCallsPerTask: 100
  })
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
  actionableSeverityThreshold: SeveritySchema.default('medium'),
  // Spec 27: how many changed files ONE discovery call may review. A task covering
  // more is partitioned across several calls whose candidates are unioned.
  //
  // Discovery yield tracks CALL COUNT, not defect count: a call returns roughly
  // three to five candidates whether it is shown one file or forty. The spec 26 A/B
  // measured the same code, same prompts, differing only in how many calls it was
  // spread across — 106 candidates against 75, and 43.7% recall against 35.2%.
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

// Change-impact review (spec 22). Off by default until measured, and reached
// only by the separate `impact check` command — never by `review`.
//
// The bounds below are the whole cost model of the current implementation: it
// makes no provider call, so the only resource it can spend is repository
// traversal. They are deliberately per-run and per-symbol rather than one global
// pool, because a change touching forty symbols must not let the first symbol
// consume the entire reference budget.
//
// There is deliberately no `blocking` key yet. Spec 22 requires blocking to be
// configurable and non-blocking by default, but the current command has nothing
// to block on — it reports references, not findings, and always exits 0. Adding
// the key now would ship a toggle that silently does nothing, which is the same
// mistake `SecurityConfigSchema` above records having already made once. Add it
// in the same change that admits the first impact finding.
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
  maxSearchDepth: z.int().min(0).max(32).default(12)
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

// Conformance adjudication (spec 24, design step 4). Off by default, and off
// independently of `invariantConformance.enabled`, because it is the only part of
// this capability that costs money: one model call per divergence. With it
// disabled the command runs spec 24's deterministic baseline arm, which the
// adjudicated arm has to beat.
//
// `maxAdjudications` is the spend bound, and it is the only one this key needs:
// the divergence lists are already capped, so this bounds calls per run in
// absolute terms. Divergences beyond it are counted as unadjudicated and are NOT
// reported — an unjudged divergence has not passed the filter, and the error
// direction here is silence.
export const ConformanceAdjudicationConfigSchema = z.strictObject({
  enabled: z.boolean().default(false),
  maxAdjudications: z.int().min(1).max(500).default(25)
})

// Invariant-conformance review (spec 24). Off by default until measured, and
// reached only by the separate `conformance check` command — never by `review`.
//
// The bounds are again most of the cost model: the deterministic core makes no
// provider call, so the only resource it spends is repository traversal. Peer
// derivation reads sibling files, which is the one place this capability can grow
// expensive on a wide change, so the peer bounds are both per-declaration and
// per-run. The one part that can spend money is `adjudication` below, bounded
// separately and disabled separately.
//
// There is deliberately no `blocking` key. Spec 24 says the capability is
// advisory only and MUST NOT be able to fail a pipeline, and the command always
// exits 0. A `blocking` key would therefore be accepted and silently ignored —
// the mistake `SecurityConfigSchema` above records having already made once and
// undone. There is nothing to add later either: advisory-only is a spec
// requirement here, not a maturity stage.
export const InvariantConformanceConfigSchema = z.strictObject({
  enabled: z.boolean().default(false),
  // Upper bound on the declarations the diff seeds. Each seed derives one peer
  // set, so this is what bounds how many peer sets are built.
  maxChangedDeclarations: z.int().min(1).max(500).default(50),
  // Per-declaration cap on the peer set. A peer set larger than this is
  // truncated in file-then-line order rather than dropped, so a large directory
  // still yields a bounded, reproducible comparison.
  maxPeersPerDeclaration: z.int().min(3).max(500).default(60),
  // Run-wide cap on sibling files read for peer derivation. This is the
  // traversal bound: peer derivation reads the changed file's directory, so a
  // change spread over many directories would otherwise read the repository.
  maxPeerFiles: z.int().min(1).max(2000).default(300),
  // Caps on the two reported divergence lists. They are separate caps because
  // the lists are counted separately and a flood of pre-existing divergences
  // must never crowd out the change-attributed ones.
  maxDivergences: z.int().min(1).max(500).default(50),
  maxPreExistingDivergences: z.int().min(0).max(500).default(25),
  adjudication: ConformanceAdjudicationConfigSchema.default({
    enabled: false,
    maxAdjudications: 25
  })
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
  // `.prefault({})`, not `.default({...})` with every field restated.
  //
  // Zod's `.default(value)` returns that value VERBATIM without parsing it, so a
  // restated literal becomes a SECOND source of truth that silently wins. Changing
  // `crossFileRetrieval` on the field itself had no effect at all until this was
  // fixed: the schema said one thing, the engine did another, and nothing failed.
  // `.prefault({})` parses `{}` through the schema, so each field's own default is
  // the single source of truth.
  review: ReviewConfigSchema.prefault({}),
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
    actionableSeverityThreshold: 'medium',
    maxFilesPerDiscoveryCall: 2
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
  changeImpact: ChangeImpactConfigSchema.default({
    enabled: false,
    maxChangedSymbols: 50,
    maxReferencesPerSymbol: 25,
    maxSearchDepth: 12
  }),
  intentFulfilment: IntentFulfilmentConfigSchema.default({
    enabled: false,
    maxObligations: 100,
    maxIntentBytes: 100_000,
    maxChangeLines: 5_000
  }),
  invariantConformance: InvariantConformanceConfigSchema.default({
    enabled: false,
    maxChangedDeclarations: 50,
    maxPeersPerDeclaration: 60,
    maxPeerFiles: 300,
    maxDivergences: 50,
    maxPreExistingDivergences: 25,
    adjudication: { enabled: false, maxAdjudications: 25 }
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
export type ChangeImpactConfig = z.infer<typeof ChangeImpactConfigSchema>
export type IntentFulfilmentConfig = z.infer<
  typeof IntentFulfilmentConfigSchema
>
export type InvariantConformanceConfig = z.infer<
  typeof InvariantConformanceConfigSchema
>
export type ConformanceAdjudicationConfig = z.infer<
  typeof ConformanceAdjudicationConfigSchema
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
