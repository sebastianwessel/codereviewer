// THE WHOLE PATH, ONCE: a real git repository with a real diff, through the
// default `review` command, out to every artifact a human actually receives —
// including the pull-request comment `scripts/github/` renders from them.
//
// It exists because the unit suites are green over surfaces that had drifted
// apart. Each of the following shipped, and none of them could be seen from a
// test of one module:
//
//   - the summary comment's findings section filtered out every blank line, so
//     heading, prose and list ran together in every comment ever posted;
//   - a ` ```suggestion ` block offered a one-click apply of edits nothing had
//     checked against the file;
//   - a run with no model search named a model and published the measured rates
//     of a search that never happened;
//   - and, found BY this file, the comment's Impact section read a report shape
//     the engine stopped emitting at schema 2.0, so it silently rendered nothing
//     while `report-digest.test.ts` stayed green against a 1.1 fixture.
//
// So the assertions here are deliberately about AGREEMENT and PLACEMENT rather
// than existence: the same finding must carry the same id, severity, path and
// line everywhere it appears, and the human-facing surfaces are snapshotted so
// wording drift lands in review instead of in a pull request.
//
// HERMETIC AND FREE. Git is real, because the CLI exposes no git seam and the
// point is to run it as a user does. The provider is scripted and injected
// through `providerImport` — the same seam `review-command.test.ts`,
// `review-workflow.test.ts` and `verification-run.test.ts` use — so no request
// leaves the process and nothing costs money or varies run to run.
//
// `@purista/harness/testing` ships a `FakeModelProvider`. It is deliberately NOT
// used: it answers from a single FIFO queue with no dispatch on the request, and
// this run issues ten calls across six different stages, two of them concurrent.
// A queue would bind an answer to a call ORDER that is not guaranteed. The
// scripted provider below answers from the OUTPUT SCHEMA it was asked for, which
// is what every scripted provider in this repository already does.
import { execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type {
  JsonValue,
  ModelProvider,
  ObjectRequest,
  ObjectResponse
} from '@purista/harness'
import { validateSarifDocument } from '../domains/reporting/sarif-validation.js'
import {
  digestImpactReport,
  digestIntentReport,
  digestReviewReport
} from '../../scripts/github/report-digest.js'
import {
  buildInlineComments,
  fingerprintsByFindingId,
  parseRenderedComments
} from '../../scripts/github/inline-review.js'
import { renderSummaryComment } from '../../scripts/github/summary-comment.js'
import { reviewStageDefinition } from '../../scripts/github/stage-outcomes.js'
import { runCli } from './index.js'

const git = (root: string, args: readonly string[]): void => {
  execFileSync('git', [...args], { cwd: root, stdio: 'pipe' })
}

// ---------------------------------------------------------------------------
// The fixture repository
// ---------------------------------------------------------------------------
//
// Shaped so the DEFAULT configuration has something to do at every stage that is
// now on by default. Nothing here is switched on by the config file: it names a
// provider and a model and nothing else, which is the whole zero-config surface.
//
//   - `src/pricing.ts`   the changed file carrying the defect the model "finds"
//   - `src/audit.ts`     a second changed file, so discovery runs more than once
//   - `src/checkout.ts`  an UNCHANGED caller of the changed symbol, so
//                        change-impact has a real reference to report
//   - `docs/pricing.md`  a changed markdown file, picked up by the default
//                        `changed-files` context provider
//   - `.codereviewer/context/PROJ-1.md`
//                        an inbox file, picked up by the default `inbox`
//                        provider — both feed the change-intent brief AND the
//                        intent-fulfilment lane's obligations
//
// The head commit sits on a branch, because `review.baseRef` defaults to `main`:
// two commits on one branch share a merge base with themselves and the run is
// (correctly) refused as having nothing to review.
//
// The origin remote is a github.com URL so platform detection resolves `github`
// from the repository rather than from configuration. The GitHub pipeline reads
// `review-comments.github.json` by exact filename, so a detection that resolved
// `generic` would leave it silently finding nothing.

const BASE_PRICING = [
  'export type Order = { readonly total: number; readonly coupon?: string }',
  '',
  'export const applyDiscount = (order: Order, percent: number): number => {',
  '  const factor = (100 - percent) / 100',
  '  return order.total * factor',
  '}',
  ''
].join('\n')

// Lines 5 and 6 are the added ones. Both findings below anchor to them, which is
// what makes them inline-eligible: admission only anchors a comment to a line the
// diff actually added.
const HEAD_PRICING = [
  'export type Order = { readonly total: number; readonly coupon?: string }',
  '',
  'export const applyDiscount = (order: Order, percent: number): number => {',
  '  const factor = (100 - percent) / 100',
  '  // BUG: negative percents are not rejected',
  '  return order.total * factor * 100',
  '}',
  ''
].join('\n')

const CHECKOUT = [
  "import { applyDiscount, type Order } from './pricing.js'",
  '',
  'export const checkout = (order: Order): number => {',
  '  return applyDiscount(order, 10)',
  '}',
  ''
].join('\n')

const BASE_AUDIT =
  'export const auditLine = (message: string): string => `audit: ${message}`\n'

const HEAD_AUDIT = [
  'export const auditLine = (message: string): string =>',
  '  `audit: ${message.trim()}`',
  ''
].join('\n')

const buildRepositoryTemplate = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'codereviewer-review-e2e-template-'))

  await mkdir(join(root, 'src'), { recursive: true })
  await mkdir(join(root, 'docs'), { recursive: true })
  await mkdir(join(root, '.codereviewer', 'context'), { recursive: true })

  await writeFile(join(root, 'src', 'pricing.ts'), BASE_PRICING)
  await writeFile(join(root, 'src', 'checkout.ts'), CHECKOUT)
  await writeFile(join(root, 'src', 'audit.ts'), BASE_AUDIT)
  await writeFile(
    join(root, 'docs', 'pricing.md'),
    '# Pricing\n\nDiscounts are percentages.\n'
  )
  await writeFile(
    join(root, '.codereviewer', 'config.json'),
    `${JSON.stringify({ provider: { id: 'openai', model: 'fixture-model' } }, null, 2)}\n`
  )

  git(root, ['init', '-q', '-b', 'main'])
  git(root, ['config', 'user.email', 'test@example.com'])
  git(root, ['config', 'user.name', 'Test'])
  git(root, ['remote', 'add', 'origin', 'https://github.com/acme/fixture.git'])
  git(root, ['add', '-A'])
  git(root, ['commit', '-q', '-m', 'base'])
  git(root, ['checkout', '-q', '-b', 'feature'])

  await writeFile(join(root, 'src', 'pricing.ts'), HEAD_PRICING)
  await writeFile(join(root, 'src', 'audit.ts'), HEAD_AUDIT)
  await writeFile(
    join(root, 'docs', 'pricing.md'),
    [
      '# Pricing',
      '',
      'Discounts are percentages.',
      '',
      'The discount must never exceed the order total.',
      ''
    ].join('\n')
  )
  await writeFile(
    join(root, '.codereviewer', 'context', 'PROJ-1.md'),
    [
      '---',
      'id: PROJ-1',
      'source: jira',
      'title: Cap the discount at the order total',
      '---',
      '',
      'The discount must never exceed the order total.',
      'Reject a negative percent.',
      ''
    ].join('\n')
  )

  git(root, ['add', '-A'])
  git(root, ['commit', '-q', '-m', 'cap the discount'])

  return root
}

// Building the template costs a dozen `git` spawns, and a spawn from a vitest
// worker is an order of magnitude more expensive than one from a bare node
// process. Paid once per file and copied per test, exactly as
// `intent-command.test.ts` does it.
let repositoryTemplate: string | undefined

// ONE default run, shared by every test that only READS its artifacts.
//
// Not an economy: it is the premise. These tests assert that the artifacts of a
// SINGLE run agree with each other, so running the command seven times would be
// seven different premises checked one at a time. The command is driven again
// only where the configuration differs (the model review switched off), and its
// repository is its own.
let defaultRun: CompletedRun | undefined

beforeAll(async () => {
  repositoryTemplate = await buildRepositoryTemplate()

  const root = await createRepository()

  try {
    defaultRun = await runDefaultReview(root)
  } finally {
    // Every artifact is already in memory, so the repository has served its
    // purpose. Nothing below reads the working tree again.
    await rm(root, { recursive: true, force: true })
  }
  // The hook timeout is its own budget — `describe`'s does not cover it — and this
  // hook does the file's heavy work: a dozen `git` spawns plus one full review.
  // Under parallel worker load that comfortably exceeds vitest's 10s default.
}, 60_000)

afterAll(async () => {
  if (repositoryTemplate !== undefined) {
    await rm(repositoryTemplate, { recursive: true, force: true })
  }
})

const completedRun = (): CompletedRun => {
  if (defaultRun === undefined) {
    throw new Error('The shared default review run was not completed.')
  }

  return defaultRun
}

const createRepository = async (): Promise<string> => {
  if (repositoryTemplate === undefined) {
    throw new Error('The repository template was not built.')
  }

  const root = await mkdtemp(join(tmpdir(), 'codereviewer-review-e2e-'))

  await cp(repositoryTemplate, root, { recursive: true })

  return root
}

// ---------------------------------------------------------------------------
// The scripted provider
// ---------------------------------------------------------------------------

const schemaProperties = (request: ObjectRequest): readonly string[] =>
  Object.keys(
    (request.schema as { readonly properties?: Record<string, unknown> })
      .properties ?? {}
  )

const requestPayload = (request: ObjectRequest): Record<string, unknown> => {
  const user = request.messages.find((message) => message.role === 'user')

  try {
    return JSON.parse(String(user?.content)) as Record<string, unknown>
  } catch {
    return {}
  }
}

type ScriptedCandidate = {
  readonly id: string
  readonly location: { readonly path: string; readonly startLine: number }
}

// A refutation verdict that can hold. The evidence fields are not decoration:
// `aiReview.requireRefutation` is a literal `true`, so a candidate with no
// adjudication is not admitted, and a `proved` verdict missing them is not a
// shape the refuter can produce.
const provedVerdict = (
  candidateId: string,
  fields: Record<string, JsonValue>
): Record<string, JsonValue> => ({
  candidateId,
  verdict: 'proved',
  changedBehavior: 'applyDiscount no longer returns the discounted order total.',
  executionOrDataPath: 'checkout calls applyDiscount for every order.',
  violatedInvariant: 'applyDiscount must return the discounted order total.',
  impact: 'Every checkout total computed through this function is wrong.',
  introducedByChange: 'The line is added by this diff.',
  contradictionChecks: ['No caller compensates for the change.'],
  fixDirection: 'Restore the documented contract.',
  ...fields
})

/**
 * Answers every model-backed stage the default configuration reaches, dispatching
 * on the OUTPUT SCHEMA it was asked for rather than on call order:
 *
 *   `brief`        the change-intent summarizer (spec 11)
 *   `findings`     holistic discovery, once per task
 *   `groups`       the semantic merge, once per file with two or more candidates
 *   `verdicts`     batched refutation, once per task
 *   `obligations`  the intent lane's obligation extraction
 *   `status`       the intent lane's per-obligation judgement
 *   `explanation`  the intent lane's explanation
 *
 * `relies` — change-impact's reliance judgement — is deliberately absent: impact
 * adjudication is a measured-off capability (0 of 7 against a pre-registered bar),
 * so the DEFAULT run makes no impact model call at all. Answering a request that
 * cannot arrive would assert the opposite.
 */
class ScriptedReviewProvider implements ModelProvider {
  readonly id = 'scripted-review'
  readonly genAiSystem = 'scripted'
  /** One entry per call, as `<stage>`, so a test can assert what actually ran. */
  readonly stages: string[] = []
  /**
   * The `reviewText` of every discovery call, kept so a test can prove what the
   * reviewer was actually SHOWN. A stage that gathers context, ledgers it and
   * then drops it before the prompt is this repository's recorded failure mode —
   * reviewer instructions did exactly that, undetected, for months.
   */
  readonly discoveryPrompts: string[] = []

  async object<T extends JsonValue = JsonValue>(
    request: ObjectRequest<T>
  ): Promise<ObjectResponse<T>> {
    const properties = schemaProperties(request)
    const reply = (object: unknown): ObjectResponse<T> => ({
      object: object as T,
      finishReason: 'stop',
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }
    })

    if (properties.includes('brief')) {
      this.stages.push('change-intent-brief')

      return reply({
        brief:
          'Cap the discount at the order total and reject a negative percent.'
      })
    }

    if (properties.includes('findings')) {
      const payload = requestPayload(request)
      const paths = (payload.paths ?? []) as readonly string[]

      this.stages.push(`discovery:${[...paths].join(',')}`)
      this.discoveryPrompts.push(String(payload.reviewText ?? ''))

      if (paths.includes('src/pricing.ts')) {
        return reply({
          findings: [
            {
              category: 'bug',
              severity: 'high',
              title: 'Discount is multiplied by a hundred',
              description:
                'applyDiscount multiplies the discounted total by 100, so every caller receives a total a hundred times too large.',
              path: 'src/pricing.ts',
              startLine: 6,
              citations: [
                { startLine: 6, quote: 'return order.total * factor * 100' }
              ]
            },
            {
              category: 'bug',
              severity: 'high',
              title: 'A negative percent is accepted',
              description:
                'Nothing rejects a negative percent, so a negative discount raises the order total.',
              path: 'src/pricing.ts',
              startLine: 5,
              citations: [
                {
                  startLine: 5,
                  quote: '// BUG: negative percents are not rejected'
                }
              ]
            }
          ]
        })
      }

      if (paths.includes('src/audit.ts')) {
        return reply({
          findings: [
            {
              category: 'bug',
              severity: 'medium',
              title: 'Trimming the audit message drops meaningful whitespace',
              description:
                'auditLine now trims the message, so a caller that pads it loses the padding.',
              path: 'src/audit.ts',
              startLine: 2,
              citations: [
                { startLine: 2, quote: 'audit: ${message.trim()}' }
              ]
            }
          ]
        })
      }

      return reply({ findings: [] })
    }

    if (properties.includes('groups')) {
      this.stages.push('semantic-merge')

      // The two pricing candidates are different defects on neighbouring lines,
      // which is the case the merge exists to NOT collapse.
      return reply({ groups: [] })
    }

    if (properties.includes('verdicts')) {
      const candidates = (requestPayload(request).candidates ??
        []) as readonly ScriptedCandidate[]

      this.stages.push(`refutation:${candidates.length}`)

      return reply({
        verdicts: candidates.map((candidate) => {
          const at = `${candidate.location.path}:${candidate.location.startLine}`

          // Proved, with a single-line edit covering exactly the commented line:
          // the one shape a ` ```suggestion ` block can carry, and it applies
          // cleanly to the file as it is.
          if (at === 'src/pricing.ts:6') {
            return provedVerdict(candidate.id, {
              rationaleSummary:
                'The added return statement multiplies the discounted total by a hundred.',
              fixSummary:
                'Return the discounted total without the stray factor of a hundred.',
              fixEdits: [
                {
                  path: 'src/pricing.ts',
                  startLine: 6,
                  endLine: 6,
                  replacement: '  return order.total * factor'
                }
              ]
            })
          }

          // Proved, with a TWO-LINE edit. A comment is anchored to one line, so
          // this edit cannot be rendered as a suggestion — the case that used to
          // drop the replacement in silence under a body still reading
          // "Suggested fix: <summary>".
          if (at === 'src/pricing.ts:5') {
            return provedVerdict(candidate.id, {
              rationaleSummary: 'No guard rejects a negative percent.',
              fixSummary:
                'Reject a percent outside 0..100 before computing the factor.',
              fixEdits: [
                {
                  path: 'src/pricing.ts',
                  startLine: 5,
                  endLine: 6,
                  replacement:
                    '  if (percent < 0 || percent > 100) throw new RangeError("percent")\n  return order.total * factor'
                }
              ]
            })
          }

          // Neither proved nor disproved: admitted as `artifact-only`, which is
          // what puts it under "Worth a look" and keeps it out of the gate, the
          // inline comments and the SARIF.
          return {
            candidateId: candidate.id,
            verdict: 'needs-more-evidence',
            rationaleSummary:
              'Whether any caller depends on the untrimmed message could not be settled from the files this run could reach.'
          }
        })
      })
    }

    if (properties.includes('obligations')) {
      this.stages.push('intent-obligations')

      return reply({
        obligations: [
          {
            origin: 'inbox:jira/PROJ-1',
            line: 1,
            statement: 'The discount must never exceed the order total.'
          },
          {
            origin: 'inbox:jira/PROJ-1',
            line: 2,
            statement: 'Reject a negative percent.'
          }
        ]
      })
    }

    if (properties.includes('status')) {
      this.stages.push('intent-judgement')

      return reply({ status: 'not-evidenced' })
    }

    if (properties.includes('explanation')) {
      this.stages.push('intent-explanation')

      return reply({
        explanation:
          'Neither obligation is evidenced by this change: the cap and the guard are both still missing.'
      })
    }

    throw new Error(
      `The scripted provider was asked for an unexpected output schema: ${properties.join(', ')}`
    )
  }
}

// ---------------------------------------------------------------------------
// Reading a run
// ---------------------------------------------------------------------------

type CompletedRun = {
  readonly exitCode: number
  readonly artifactDir: string
  readonly stages: readonly string[]
  readonly discoveryPrompts: readonly string[]
  readonly report: any
  readonly runSummary: any
  readonly contextLedger: readonly any[]
  readonly observability: any
  readonly markdown: string
  readonly sarif: any
  readonly neutralComments: readonly any[]
  readonly githubComments: string
  readonly impactJson: string
  readonly intentJson: string
}

const readOptional = async (
  path: string
): Promise<string | undefined> => await readFile(path, 'utf8').catch(() => undefined)

const runDefaultReview = async (
  root: string,
  args: readonly string[] = []
): Promise<CompletedRun> => {
  const provider = new ScriptedReviewProvider()
  const result = await runCli(['review', ...args], {
    cwd: root,
    environment: { OPENAI_API_KEY: 'sk-test' },
    providerImport: async () => ({ openai: () => provider })
  })

  expect(result.stderr).toBe('')

  const artifactDir = (JSON.parse(result.stdout) as { artifactDir: string })
    .artifactDir
  const read = async (name: string): Promise<string> =>
    await readFile(join(root, artifactDir, name), 'utf8')

  return {
    exitCode: result.exitCode,
    artifactDir,
    stages: provider.stages,
    discoveryPrompts: provider.discoveryPrompts,
    report: JSON.parse(await read('report.json')),
    runSummary: JSON.parse(await read('run-summary.json')),
    contextLedger: JSON.parse(await read('context-ledger.json')),
    observability: JSON.parse(await read('observability.json')),
    markdown: await read('report.md'),
    sarif: JSON.parse(await read('report.sarif')),
    neutralComments: JSON.parse(await read('review-comments.json')),
    githubComments:
      (await readOptional(join(root, artifactDir, 'review-comments.github.json'))) ??
      '',
    impactJson:
      (await readOptional(join(root, artifactDir, 'impact-report.json'))) ?? '',
    intentJson:
      (await readOptional(join(root, artifactDir, 'intent-report.json'))) ?? ''
  }
}

// Everything that legitimately differs between two runs of the same fixture: the
// run id, the clock, the temp directory, and the commit sha (git commits carry a
// timestamp, so the merge base is new on every template build). Normalised rather
// than asserted around, because a snapshot carrying any of them is a snapshot that
// gets deleted the first time it flakes.
const normalise = (text: string): string =>
  text
    .replaceAll(/run-[0-9a-f-]{36}/gu, 'run-<id>')
    .replaceAll(/\b[0-9a-f]{40}\b/gu, '<sha40>')
    .replaceAll(/\b[0-9a-f]{64}\b/gu, '<sha256>')
    .replaceAll(
      /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/gu,
      '<timestamp>'
    )
    // Grouped digits included: the reporter formats with a locale separator, so a
    // slow run under parallel workers prints `1,716 ms` where a fast one prints
    // `498 ms`. Matching only the ungrouped form is how this snapshot first flaked.
    .replaceAll(/Duration: [\d,. ]+ ms/gu, 'Duration: <duration>')

// The pull-request comment, rendered from the artifacts by exactly the code path
// `scripts/github/pipeline.ts` uses.
const renderComment = (run: CompletedRun, options: {
  readonly inlineCommentCount?: number
} = {}): string => {
  const review = digestReviewReport(JSON.stringify(run.report))
  const impact =
    run.impactJson === '' ? undefined : digestImpactReport(run.impactJson)
  const intent =
    run.intentJson === '' ? undefined : digestIntentReport(run.intentJson)

  expect(review).toBeDefined()

  return renderSummaryComment({
    markerKey: 'default',
    outcomes: [
      {
        id: reviewStageDefinition.id,
        kind: reviewStageDefinition.kind,
        status: run.exitCode === 0 ? 'passed' : 'gate-failed'
      }
    ],
    headSha: 'feedfacefeedfacefeedfacefeedfacefeedface',
    ...(review === undefined ? {} : { review }),
    ...(impact === undefined ? {} : { impact }),
    ...(intent === undefined ? {} : { intent }),
    ...(options.inlineCommentCount === undefined
      ? {}
      : { inlineCommentCount: options.inlineCommentCount }),
    notes: []
  })
}

const aboveTheFold = (comment: string): string =>
  comment.slice(0, comment.indexOf('<details>'))

const collapsedBlock = (comment: string): string =>
  comment.slice(comment.indexOf('<details>'))

// Bound by process spawns and filesystem work — a dozen `git` calls to build the
// template, then the command itself twice — rather than by anything it computes.
// The raise is scoped here so the rest of the suite keeps failing fast.
describe('review end to end', { timeout: 30_000 }, () => {
  test('the default review reaches every stage that is on by default', () => {
    const run = completedRun()

    // Two high findings against `maxHigh: 0`, so the gate fails and the command
    // exits 1. Asserted first because every other expectation below is about
    // the artifacts of THIS run, and a different exit code means a different
    // run happened.
    expect(run.exitCode).toBe(1)

    // The stages the default configuration actually reaches, in the shape the
    // scripted provider saw them. Two discovery calls because
    // `aiReview.maxFilesPerDiscoveryCall` is 2 over three changed files; one
    // merge call because one file carries two candidates; one refutation call
    // per task, batched.
    expect([...run.stages].sort()).toEqual([
      'change-intent-brief',
      'discovery:docs/pricing.md,src/audit.ts',
      'discovery:src/pricing.ts',
      'intent-explanation',
      'intent-judgement',
      'intent-judgement',
      'intent-obligations',
      'refutation:1',
      'refutation:2',
      'semantic-merge'
    ])

    // The change-intent brief was ledgered AND actually reached the discovery
    // prompt. Both halves are asserted because this repository has shipped the
    // half that ledgers and drops: reviewer instructions were gathered, hashed
    // and recorded, then dropped before the discovery call, and nothing could
    // tell the difference from the artifacts alone.
    expect(run.contextLedger).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: 'task-context-change-intent',
          decision: 'summarized'
        })
      ])
    )
    expect(run.discoveryPrompts).toHaveLength(2)
    for (const prompt of run.discoveryPrompts) {
      expect(prompt).toContain('## Change intent')
      expect(prompt).toContain(
        'Cap the discount at the order total and reject a negative percent.'
      )
    }

    // Both default context providers were ingested, not just one: the inbox
    // file AND the changed markdown file.
    const intent = JSON.parse(run.intentJson) as {
      status: string
      scope: { intentOrigins: readonly string[] }
      obligations: readonly { statement: string; status: string }[]
    }

    expect(intent.scope.intentOrigins).toEqual([
      'inbox:jira/PROJ-1',
      'changed-file:docs/pricing.md'
    ])
    expect(intent.status).toBe('completed')
    expect(intent.obligations.map((obligation) => obligation.status)).toEqual([
      'not-evidenced',
      'not-evidenced'
    ])

    // The deterministic stages that are on by default and produce no artifact of
    // their own still RAN. A drift gate that silently stopped running would be
    // invisible from every other file this test reads.
    const stepEnded = (step: string): any =>
      (run.observability.events as readonly any[]).find(
        (event) => event.type === 'step-ended' && event.step === step
      )

    expect(stepEnded('drift_check')?.attributes).toMatchObject({
      passed: true,
      errorCount: 0
    })
    // Platform detection resolved GitHub from the repository's own remote, not
    // from configuration — and exactly one of the two drafts carried a
    // suggestion, which is the apply-check's answer recorded at the source.
    expect(stepEnded('review_comments')?.attributes).toMatchObject({
      draftCount: 2,
      suggestionCount: 1,
      platform: 'github',
      platformDetectedFrom: 'remote'
    })

    // Change-impact found the UNCHANGED caller of the changed symbol.
    const impact = JSON.parse(run.impactJson) as {
      status: string
      impactedFiles: readonly {
        path: string
        symbols: readonly { name: string; sites: readonly unknown[] }[]
      }[]
    }

    expect(impact.status).toBe('completed')
    expect(impact.impactedFiles).toEqual([
      expect.objectContaining({
        path: 'src/checkout.ts',
        symbols: [
          expect.objectContaining({
            name: 'applyDiscount',
            sites: [
              expect.objectContaining({ line: 1 }),
              expect.objectContaining({ line: 4 })
            ]
          })
        ]
      })
    ])
  })

  test('run-summary.json names the model that searched, and the search that happened', () => {
    const run = completedRun()

    // `modelSearch` is the unambiguous fact a reader needs before weighing any
    // rate in the report: `report.discovery === undefined` is ALSO what a
    // deterministic-only run and every pre-spec-27 report look like, so silence
    // was never the signal.
    expect(run.runSummary).toMatchObject({
      provider: 'openai',
      model: 'fixture-model',
      modelSearch: 'performed'
    })
    expect(run.report.run).toMatchObject({
      provider: 'openai',
      model: 'fixture-model',
      modelSearch: 'performed'
    })

    // The rates are published WITH the model they were measured on, and with
    // the fact that this run used a different one. A rate is a property of a
    // model, not of the engine.
    expect(run.markdown).toContain('Measured on `openai/gpt-5.3-codex`')
    expect(run.markdown).toContain('**This run used `openai/fixture-model`**')
  })

  test('a run with the model review switched off names no model and publishes no rate', async () => {
    const root = await createRepository()

    try {
      await writeFile(
        join(root, '.codereviewer', 'config.json'),
        JSON.stringify({
          provider: { id: 'openai', model: 'fixture-model' },
          aiReview: { enabled: false }
        })
      )

      const provider = new ScriptedReviewProvider()
      const result = await runCli(['review'], {
        cwd: root,
        environment: { OPENAI_API_KEY: 'sk-test' },
        providerImport: async () => ({ openai: () => provider })
      })

      // Deterministic-only is a legitimate request, so it succeeds — and that is
      // precisely why the disclosure has to be load-bearing: exit 0 over an empty
      // findings list is what a clean review looks like.
      expect(result.exitCode).toBe(0)

      const artifactDir = (JSON.parse(result.stdout) as { artifactDir: string })
        .artifactDir
      const runSummary = JSON.parse(
        await readFile(join(root, artifactDir, 'run-summary.json'), 'utf8')
      ) as Record<string, unknown>
      const markdown = await readFile(
        join(root, artifactDir, 'report.md'),
        'utf8'
      )

      expect(runSummary.modelSearch).toBe('not-performed')
      expect(runSummary.provider).toBeUndefined()
      expect(runSummary.model).toBeUndefined()

      // No rate, and no model name, anywhere in the human-facing report: both
      // would describe a search that did not happen.
      expect(markdown).toContain('NO MODEL SEARCHED THIS CHANGE')
      expect(markdown).not.toContain('in-diff recall')
      expect(markdown).not.toContain('adjusted precision')
      expect(markdown).not.toContain('gpt-5.3-codex')
      expect(markdown).not.toContain('fixture-model')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('report.md carries its sections in the order a reader works in', () => {
    const run = completedRun()

    const headings = [...run.markdown.matchAll(/^## .*$/gmu)].map(
      (match) => match[0]
    )

    // The ORDER, not a set of substrings. Findings come before the machinery
    // that produced them, and the unresolved section sits directly under the
    // actionable one so a "could not decide" can never be read as a verdict by
    // being far away from the list it is not part of.
    expect(headings).toEqual([
      '## Scope of this search',
      '## Summary',
      '## Bounds that bound',
      '## Actionable Findings (2)',
      '## Unresolved - Needs Human Decision (1)',
      '## Rejected Candidates (0)',
      '## What Discovery Produced',
      '## Refutation Results (3)',
      '## Skipped Files (1)',
      '## Changed source files with no test file in this change (2)',
      '## Cost And Timing'
    ])

    expect(normalise(run.markdown)).toMatchSnapshot()
  })

  test('the pull-request comment puts what to fix above the fold and the engine below it', () => {
    const run = completedRun()

    const comment = renderComment(run, { inlineCommentCount: 2 })
    const above = aboveTheFold(comment)
    const below = collapsedBlock(comment)

    // Reading order: what happened, what the change was for and whether it got
    // there, what it might affect, what is wrong with it, and last what is only
    // maybe wrong with it.
    expect(above).toContain(
      '## Code review: quality gate failed, 2 findings to read'
    )
    expect([...above.matchAll(/^### .*$/gmu)].map((match) => match[0])).toEqual([
      '### Intent',
      '### Impact',
      '### Findings (2)',
      '### Worth a look (1)'
    ])

    // The Impact section is the one this file was written to catch: the engine
    // moved its report shape at schema 2.0 and the digest kept reading the 1.1
    // spelling, so this table silently disappeared from every comment while the
    // digest's own unit test stayed green against a 1.1 fixture.
    expect(above).toContain('| `applyDiscount` | `src/pricing.ts` | 2 | 0 |')

    // NO ENGINE JARGON ABOVE THE FOLD. Every term below names a pipeline state
    // rather than telling a reviewer something about their change; each one was
    // above the fold at some point and was deliberately moved.
    for (const jargon of [
      'refutation',
      'Survived refutation',
      'needs-more-evidence',
      'artifact-only',
      'Candidates:',
      '| Stage |',
      'in-diff recall',
      'adjusted precision',
      'gpt-5.3-codex'
    ]) {
      expect(above).not.toContain(jargon)
    }

    // None of it was DELETED, though: the stage table, the measured rates with
    // the model they were measured on, and the refuter's own words are all one
    // click away.
    expect(below).toContain('| Stage | Role | Result | What it contributes |')
    expect(below).toContain('measured on `openai/gpt-5.3-codex`')
    expect(below).toContain('**What was checked against each finding**')
    expect(below).toContain('Survived refutation — proved:')
    expect(below).toContain('- Inline comments posted: 2')

    // The blank lines are structural. A heading, a paragraph and a list that run
    // together render as one blob on a strict CommonMark renderer, which is what
    // every comment ever posted looked like until the filter that removed them
    // was taken out.
    expect(above).toContain('### Findings (2)\n\n2 high.\n\n- **high**')

    expect(normalise(comment)).toMatchSnapshot()
  })

  test('inline comments anchor to the reported line and only offer an apply that still fits', () => {
    const run = completedRun()

    const review = digestReviewReport(JSON.stringify(run.report))
    const rendered = parseRenderedComments(run.githubComments)

    expect(review).toBeDefined()

    const plan = buildInlineComments({
      rendered,
      fingerprints: fingerprintsByFindingId(review?.findings ?? []),
      existingMarkers: new Set(),
      maxComments: 20
    })

    // One comment per INLINE-eligible finding, and no more. The `artifact-only`
    // finding is an open question rather than a verdict and must never arrive as
    // a note on somebody's line; the `summary-only` class is absent here because
    // both proved findings landed on added lines.
    expect(plan.comments).toHaveLength(2)
    expect(plan.overCap).toBe(0)
    expect(plan.alreadyPosted).toBe(0)

    const byLine = new Map(plan.comments.map((comment) => [comment.line, comment]))
    const applies = byLine.get(6)
    const doesNotApply = byLine.get(5)

    expect(applies).toBeDefined()
    expect(doesNotApply).toBeDefined()
    expect(applies?.path).toBe('src/pricing.ts')
    expect(applies?.side).toBe('RIGHT')
    // Single-line anchors carry no range, so GitHub does not draw one.
    expect(applies?.start_line).toBeUndefined()

    // The edit covers exactly the commented line and still applies to the file
    // as it is now, so the reader is offered the one-click apply.
    expect(applies?.body).toContain(
      '```suggestion\n  return order.total * factor\n```'
    )

    // The other finding's edit spans two lines, which a comment anchored to one
    // line cannot carry. The PROSE is kept, no suggestion block is offered, and
    // the reader is told where the replacement can still be read — this used to
    // drop the replacement in silence under a body still promising a fix.
    expect(doesNotApply?.body).toContain('A negative percent is accepted')
    expect(doesNotApply?.body).toContain(
      'Reject a percent outside 0..100 before computing the factor.'
    )
    expect(doesNotApply?.body).not.toContain('```suggestion')
    expect(doesNotApply?.body).toContain(
      'is not offered as a one-click apply and was not checked against the file'
    )
    expect(doesNotApply?.body).toContain(
      'recorded in full in `report.json` under this finding\'s `fixProposal.edits`'
    )

    // WHAT THIS CANNOT REACH, said rather than asserted around. The apply-check
    // has four withholding outcomes and only two of them are reachable from the
    // CLI end to end: `none` and `not-representable`. `stale` (re-applied and did
    // not fit) and `unchecked` (the bytes never arrived) both require the file to
    // differ from what the finding was anchored to, and one run reads BOTH the
    // reviewed content and the apply-check bytes from the same working tree — so
    // a proved single-line edit at a line the model was shown always applies.
    // Those two outcomes stay pinned by `reporting/review-comments.test.ts`,
    // which injects the reader directly.

    // The replacement really is still there to be read.
    const withheld = (run.report.admittedFindings as readonly any[]).find(
      (finding) => finding.location.startLine === 5
    )

    expect(withheld.fixProposal.edits).toEqual([
      expect.objectContaining({ startLine: 5, endLine: 6 })
    ])

    // The bodies are a human-facing surface in their own right — they are what
    // lands beside somebody's code — so they are snapshotted for the same reason
    // `report.md` and the summary comment are. The finding-identity marker is
    // normalised out: it is a content fingerprint, not prose.
    expect(
      plan.comments.map((comment) => ({
        path: comment.path,
        line: comment.line,
        body: comment.body.replace(
          /<!-- codereviewer:finding:[^ ]+ -->/gu,
          '<!-- codereviewer:finding:<fingerprint> -->'
        )
      }))
    ).toMatchSnapshot()
  })

  test('the SARIF validates, defines every rule it references, and excludes what was never proved', () => {
    const run = completedRun()

    expect(() => {
      validateSarifDocument(run.sarif, 'generic')
    }).not.toThrow()

    const driver = run.sarif.runs[0].tool.driver
    const definedRuleIds = new Set(
      (driver.rules as readonly { id: string }[]).map((rule) => rule.id)
    )
    const results = run.sarif.runs[0].results as readonly {
      ruleId: string
      locations: readonly any[]
    }[]

    for (const result of results) {
      expect(definedRuleIds.has(result.ruleId)).toBe(true)
    }

    // The two proved findings, and NOT the unresolved one: a candidate
    // refutation could neither prove nor disprove is a question for a human, and
    // a SARIF result is consumed by machines that treat it as a defect.
    expect(results).toHaveLength(2)
    expect(
      results
        .map(
          (result) =>
            `${result.locations[0].physicalLocation.artifactLocation.uri}:${result.locations[0].physicalLocation.region.startLine}`
        )
        .sort()
    ).toEqual(['src/pricing.ts:5', 'src/pricing.ts:6'])
  })

  test('one finding keeps one id, severity, path and line across every artifact', () => {
    const run = completedRun()

    const comment = renderComment(run)

    type Identity = {
      readonly id: string
      readonly severity: string
      readonly path: string
      readonly line: number
    }

    const fromReport: readonly Identity[] = (
      run.report.admittedFindings as readonly any[]
    ).map((finding) => ({
      id: finding.id,
      severity: finding.severity,
      path: finding.location.path,
      line: finding.location.startLine
    }))

    // Three admitted findings: two actionable, one unresolved.
    expect(fromReport).toHaveLength(3)

    const actionable = (run.report.admittedFindings as readonly any[]).filter(
      (finding) => finding.reporterEligibility !== 'artifact-only'
    )

    for (const finding of fromReport) {
      // report.md prints the id and the location together.
      expect(run.markdown).toContain(`ID: \`${finding.id}\``)
      expect(run.markdown).toContain(
        `Location: \`${finding.path}:${finding.line}\``
      )
    }

    // The comment addresses a finding by location and severity rather than by
    // id, so that is what has to agree. A finding present in `report.json` and
    // missing here is the drift this test exists to catch.
    for (const finding of fromReport) {
      expect(comment).toContain(
        `**${finding.severity}** · bug · \`${finding.path}:${finding.line}\``
      )
    }

    // The neutral comment drafts and the GitHub-rendered ones carry the same
    // ids and lines as the report, for the actionable findings only.
    const neutralByFindingId = new Map(
      (run.neutralComments as readonly any[]).map((draft) => [
        draft.findingId,
        draft
      ])
    )
    const githubByFindingId = new Map(
      parseRenderedComments(run.githubComments).map((comment) => [
        comment.findingId,
        comment
      ])
    )

    expect([...neutralByFindingId.keys()].sort()).toEqual(
      actionable.map((finding: any) => finding.id).sort()
    )
    expect([...githubByFindingId.keys()].sort()).toEqual(
      actionable.map((finding: any) => finding.id).sort()
    )

    for (const finding of actionable) {
      expect(githubByFindingId.get(finding.id)).toMatchObject({
        path: finding.location.path,
        line: finding.location.startLine,
        severity: finding.severity
      })
    }

    // And the SARIF, which addresses the same findings by rule and location.
    const sarifLocations = (run.sarif.runs[0].results as readonly any[]).map(
      (result) =>
        `${result.locations[0].physicalLocation.artifactLocation.uri}:${result.locations[0].physicalLocation.region.startLine}`
    )

    expect(sarifLocations.sort()).toEqual(
      actionable
        .map(
          (finding: any) =>
            `${finding.location.path}:${finding.location.startLine}`
        )
        .sort()
    )
  })
})
