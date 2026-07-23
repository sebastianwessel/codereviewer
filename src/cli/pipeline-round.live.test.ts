import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { runCli } from './index.js'

// LIVE full-pipeline integration: one realistic "initial round" as a CI pipeline
// would run it, against a REAL model provider resolved from the environment
// (`npm run test:live` loads `.env`). It exercises, in one review command:
//   - the general whole-file review (Flow 1) over a real git diff,
//   - change-intent context building (inbox PR description + changed docs),
//   - the agentic verification flow (Flow 2) over SARIF-derived claims.
// It costs real money and is excluded from `npm test` (see vitest.live.config.ts).
const LIVE =
  process.env.CODEREVIEWER_PROVIDER_ID !== undefined &&
  process.env.CODEREVIEWER_PROVIDER_MODEL !== undefined

// Keep provider credentials, but drop env overrides that would fight the fixture's
// own config/flags (artifact dir, review mode/depth, refs).
const liveEnvironment = (): Record<string, string | undefined> => {
  const environment: Record<string, string | undefined> = { ...process.env }
  for (const key of [
    'CODEREVIEWER_ARTIFACT_DIR',
    'CODEREVIEWER_REVIEW_MODE',
    'CODEREVIEWER_REVIEW_DEPTH',
    'CODEREVIEWER_BASE_REF',
    'CODEREVIEWER_HEAD_REF'
  ]) {
    delete environment[key]
  }
  return environment
}

const git = (root: string, args: readonly string[]): void => {
  execFileSync('git', [...args], { cwd: root, stdio: 'pipe' })
}

// A CodeQL-style SARIF result flagging the SQL injection this PR introduces.
const SARIF = {
  version: '2.1.0',
  runs: [
    {
      tool: { driver: { name: 'CodeQL' } },
      results: [
        {
          ruleId: 'js/sql-injection',
          level: 'error',
          message: {
            text: 'User-provided value flows into an SQL query without sanitization.'
          },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: 'src/db.ts' },
                region: { startLine: 2 }
              }
            }
          ],
          properties: { cwe: 'CWE-89' }
        }
      ]
    }
  ]
}

// The pipeline step that turns analyzer output into neutral claim records for the
// verification flow (the product does not run the analyzer). This mirrors what a
// CI job would do before invoking the reviewer.
const sarifToClaims = (sarif: typeof SARIF): unknown[] =>
  sarif.runs.flatMap((run) =>
    run.results.map((result, index) => {
      const location = result.locations[0]?.physicalLocation
      const uri = location?.artifactLocation.uri ?? 'unknown'
      const line = location?.region.startLine ?? 1
      return {
        id: `claim_sarif_${index}`,
        kind: 'analyzer',
        title: result.message.text.slice(0, 200),
        detail: `${run.tool.driver.name} ${result.ruleId}: ${result.message.text}`,
        location: { path: uri, startLine: line, side: 'file' },
        source: `analyzer:${run.tool.driver.name.toLowerCase()}`,
        question: `Does the code at ${uri}:${line} really have the ${result.ruleId} defect the analyzer reported — is the flagged data flow real and reachable?`,
        evidenceRefs: [
          { key: 'ruleId', value: result.ruleId },
          { key: 'cwe', value: result.properties.cwe }
        ]
      }
    })
  )

const readJson = async (file: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(file, 'utf8'))

describe.skipIf(!LIVE)('full pipeline round (LIVE provider)', () => {
  test(
    'general review + change-intent context + SARIF verification over a real diff',
    async () => {
      const root = await mkdtemp(path.join(tmpdir(), 'codereviewer-pipeline-'))

      try {
        // --- base commit: a clean starting point -----------------------------
        git(root, ['init', '-q'])
        git(root, ['config', 'user.email', 'test@example.com'])
        git(root, ['config', 'user.name', 'Test'])
        await writeFile(path.join(root, 'README.md'), '# Fixture\n')
        git(root, ['add', '-A'])
        git(root, ['commit', '-q', '-m', 'base'])
        const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root })
          .toString()
          .trim()

        // --- head commit: the PR under review introduces a SQL injection -----
        await mkdir(path.join(root, 'src'), { recursive: true })
        await mkdir(path.join(root, 'docs'), { recursive: true })
        await writeFile(
          path.join(root, 'src', 'db.ts'),
          'export const getUser = (db: { query: (sql: string) => unknown }, id: string) =>\n' +
            "  db.query('SELECT * FROM users WHERE id = ' + id)\n"
        )
        await writeFile(
          path.join(root, 'docs', 'admin.md'),
          '# Admin panel\n\nThe admin panel can now look up a user by id via getUser.\n'
        )
        git(root, ['add', '-A'])
        git(root, ['commit', '-q', '-m', 'add getUser for admin panel'])

        // --- pipeline-provided artifacts (written before the review) ---------
        await mkdir(path.join(root, '.codereviewer', 'context'), { recursive: true })
        // PR description in the context inbox. Note the stated intent says nothing
        // about SQL safety — the reviewer must still flag the injection.
        await writeFile(
          path.join(root, '.codereviewer', 'context', 'pull-request.md'),
          '---\nsource: github-pr\ntitle: Add getUser lookup for the admin panel\n---\n' +
            'Adds a getUser(id) helper so the admin panel can fetch a user by id.\n'
        )
        // CodeQL SARIF + the pipeline conversion to neutral claims.
        await writeFile(
          path.join(root, '.codereviewer', 'results.sarif'),
          JSON.stringify(SARIF, null, 2)
        )
        await writeFile(
          path.join(root, '.codereviewer', 'claims.json'),
          JSON.stringify(sarifToClaims(SARIF))
        )
        await writeFile(
          path.join(root, '.codereviewer', 'config.json'),
          JSON.stringify({
            review: { mode: 'pr', depth: 'fast' },
            contextSources: {
              enabled: true,
              providers: [
                { type: 'inbox', dir: '.codereviewer/context' },
                { type: 'changed-files', include: ['docs/**', '**/*.md'] }
              ]
            },
            verification: {
              enabled: true,
              providers: [
                { type: 'claims-file', path: '.codereviewer/claims.json' }
              ],
              maxToolCallsPerClaim: 6
            }
          })
        )

        // --- run the review exactly as a pipeline would ----------------------
        const result = await runCli(
          ['review', '--base-ref', baseSha, '--head-ref', 'HEAD'],
          { cwd: root, environment: liveEnvironment() }
        )

        // 0 = clean, 1 = quality gate failed (the review found a blocking finding
        // and exits non-zero, which is expected here). Anything >= 2 is a setup,
        // repository, provider, or internal error and is a genuine failure.
        expect(result.exitCode).toBeLessThan(2)
        const artifactDir = JSON.parse(result.stdout).artifactDir as string
        const runDir = path.join(root, artifactDir)
        const report = await readJson(path.join(runDir, 'report.json'))
        const ledger = await readJson(path.join(runDir, 'context-ledger.json'))
        const verification = await readJson(
          path.join(runDir, 'verification-report.json')
        )

        const findings = (report.admittedFindings ?? []) as Array<{
          title: string
          severity: string
          category: string
          location?: { path?: string }
        }>
        const ledgerEntries = (
          Array.isArray(ledger) ? ledger : ((ledger.entries as unknown[]) ?? [])
        ) as Array<{ reason?: string }>
        const verdicts = (verification.verdicts ?? []) as Array<{
          claimId: string
          status: string
          rationale: string
        }>
        const corroborations = (verification.corroborations ?? []) as Array<{
          findingId: string
          matchKinds: string[]
          witnessClaimIds: string[]
        }>

        // ---- Evaluation output (read this in the test run) ------------------
        // eslint-disable-next-line no-console
        console.log(
          '\n===== FULL PIPELINE ROUND — EVALUATION =====\n' +
            `run provider: ${(report.run as { provider?: string }).provider}/${(report.run as { model?: string }).model}\n` +
            `general-review findings (${findings.length}):\n` +
            findings
              .map(
                (f) =>
                  `  - [${f.severity}/${f.category}] ${f.title} @ ${f.location?.path ?? '?'}`
              )
              .join('\n') +
            `\nchange-intent context injected: ${ledgerEntries.some((e) => e.reason === 'task-context-change-intent')}\n` +
            `verification verdicts (${verdicts.length}):\n` +
            verdicts
              .map((v) => `  - ${v.claimId}: ${v.status} — ${v.rationale.slice(0, 160)}`)
              .join('\n') +
            `\ncorroborations (${corroborations.length}):\n` +
            corroborations
              .map(
                (c) =>
                  `  - finding ${c.findingId} corroborated by ${c.witnessClaimIds.join(', ')} [${c.matchKinds.join(', ')}]`
              )
              .join('\n') +
            `\ncost usd: ${(report.run as { costUsd?: number }).costUsd ?? 'n/a'}\n` +
            '============================================\n'
        )

        // ---- Plumbing assertions (robust across model variation) ------------
        // The full round completed and all three lanes produced artifacts.
        expect((report.run as { provider?: string }).provider).toBeTruthy()
        // Change-intent context was built and injected.
        expect(
          ledgerEntries.some((e) => e.reason === 'task-context-change-intent')
        ).toBe(true)
        // Verification ran over the SARIF-derived claim and reached a verdict.
        expect(verdicts).toHaveLength(1)
        // The SQL injection is a genuine, obvious defect → the analyzer claim is
        // confirmed by the agent after it reads the code.
        expect(verdicts[0]?.status).toBe('confirmed')
        expect(verdicts[0]?.rationale.length).toBeGreaterThan(0)
        // The general review and CodeQL->verification independently identified the
        // same SQL injection, so the finding is surfaced as corroborated ("strong
        // finding"). Confidence only — the finding's severity is unchanged.
        expect(corroborations.length).toBeGreaterThanOrEqual(1)
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    }
  )
})
