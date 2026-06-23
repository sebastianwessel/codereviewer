import { describe, expect, test } from 'vitest'
import { renderMarkdownReport } from './index.js'
import { createReportFixture } from './reporting-fixture.js'

describe('Markdown reporter', () => {
  test('renders deterministic report sections and escapes user-controlled text', () => {
    const report = createReportFixture()
    const rendered = renderMarkdownReport({
      ...report,
      modelSuspicions: [
        {
          id: 'susp_abc123',
          taskId: 'task_abc123',
          category: 'bug',
          severityHint: 'high',
          title: 'Suspicious branch',
          hypothesis: 'The changed branch may return the wrong value.',
          primaryLocation: {
            path: 'src/app.ts',
            startLine: 4,
            side: 'new'
          },
          contextRequests: [
            {
              tool: 'read',
              path: 'src/app.ts',
              reason: 'Inspect the changed branch.'
            }
          ],
          requestedContext: ['Inspect src/app.ts near line 4.'],
          evidenceIds: ['ev_diff1'],
          status: 'proved',
          proposedBy: 'review-agent'
        }
      ],
      reviewIntents: [
        {
          id: 'intent_abc123',
          title: 'Verify changed return behavior',
          objective: 'Verify the changed branch end to end.',
          paths: ['src/app.ts'],
          taskIds: ['task_abc123'],
          focusAreas: ['changed branch'],
          riskAreas: ['incorrect return value'],
          verificationQuestions: [
            'Does the changed branch still return the expected value?'
          ],
          source: 'model'
        }
      ],
      investigationTraces: [
        {
          suspicionId: 'susp_abc123',
          toolCalls: [
            {
              tool: 'tool-read',
              status: 'completed',
              ledgerEntryId: 'ctx_abc123',
              summary: 'Read changed branch context.'
            }
          ],
          contextLedgerEntryIds: ['ctx_abc123'],
          budget: {
            maxReads: 1,
            usedReads: 1,
            maxSearches: 0,
            usedSearches: 0,
            maxRounds: 1,
            usedRounds: 1
          },
          result: 'proof'
        }
      ],
      proofPackets: [
        {
          id: 'proof_abc123',
          suspicionId: 'susp_abc123',
          candidateId: 'cand_weak1',
          changedBehavior: 'The changed branch can return the wrong value.',
          executionOrDataPath: 'src/app.ts branch execution',
          violatedInvariant: 'Branch returns expected value',
          impact: 'Incorrect result reaches callers.',
          introducedByChange: 'The changed branch was introduced in the reviewed range.',
          evidenceIds: ['ev_diff1'],
          contradictionChecks: ['No contradiction found.'],
          fixDirection: 'Return the computed value.'
        }
      ],
      refutationResults: [
        {
          id: 'refute_abc123',
          proofPacketId: 'proof_abc123',
          verdict: 'proved',
          summary: 'No contradiction found.',
          evidenceIds: ['ev_diff1'],
          checks: [
            {
              kind: 'task-evidence',
              result: 'passed',
              summary: 'Evidence exists.',
              evidenceIds: ['ev_diff1']
            }
          ]
        }
      ],
      aggregateResults: [
        {
          id: 'agg_abc123',
          scope: 'run',
          verdict: 'mixed',
          summary: 'The aggregate critic accepted one finding and rejected one sibling.',
          candidateIds: ['cand_weak1', 'cand_weak2'],
          evidenceIds: ['ev_diff1'],
          decisions: [
            {
              candidateId: 'cand_weak1',
              verdict: 'valid',
              summary: 'The proof remains valid after comparing sibling changes.',
              evidenceIds: ['ev_diff1'],
              relatedCandidateIds: ['cand_weak2']
            },
            {
              candidateId: 'cand_weak2',
              verdict: 'false-positive',
              summary: 'The sibling finding duplicates the stronger proof.',
              evidenceIds: ['ev_diff1'],
              relatedCandidateIds: ['cand_weak1']
            }
          ],
          similarIssueChecks: [
            {
              kind: 'sibling-pattern',
              result: 'passed',
              summary: 'Sibling changes were compared.',
              evidenceIds: ['ev_diff1']
            }
          ]
        }
      ],
      judgeResults: [
        {
          id: 'judge_abc123',
          candidateId: 'cand_weak1',
          verdict: 'valid',
          summary: 'The proof is supported by the cited evidence.',
          challengeQuestions: [
            'Does the changed branch reach the incorrect return value?'
          ],
          verificationChecks: [
            {
              kind: 'changed-branch',
              result: 'passed',
              summary: 'The cited evidence proves the changed branch is reachable.',
              evidenceIds: ['ev_diff1']
            }
          ],
          contextRequests: [
            {
              tool: 'read',
              path: 'src/app.ts',
              reason: 'Inspect the changed branch source.'
            }
          ],
          requestedContext: ['Inspect src/app.ts near the changed branch.'],
          evidenceIds: ['ev_diff1'],
          proofPacketId: 'proof_abc123',
          refutationId: 'refute_abc123'
        }
      ],
      promotionDecisions: [
        {
          candidateId: 'cand_weak1',
          proofPacketId: 'proof_abc123',
          refutationId: 'refute_abc123',
          status: 'artifact-only',
          reason: 'Policy kept this proof out of comments.',
          policy: 'promotion-policy-v1'
        }
      ],
      providerIssues: [
        {
          code: 'provider_error',
          stage: 'refutation-check',
          recovered: true,
          message: 'Provider failed once and the run continued.'
        }
      ],
      admittedFindings: [
        {
          ...report.admittedFindings[0]!,
          title: 'Bad | title <script>alert(1)</script>\n## Forged',
          description:
            'Leaked token sk-proj-abcdefghijklmnopqrstuvwxyz should not appear.\n![secret](https://example.invalid/x.png)'
        },
        {
          ...report.admittedFindings[0]!,
          id: 'find_artifact1',
          title: 'Support signal diagnostic',
          description: 'A deterministic support signal was preserved for audit.',
          proposedBy: 'typescript-support-signal',
          reporterEligibility: 'artifact-only',
          severity: 'medium'
        }
      ]
    })

    expect(rendered).toContain('# Review Report')
    expect(rendered).toContain('Suggested fix')
    expect(rendered).toContain('Return the computed value from the changed branch.')
    expect(rendered).toContain('Fix edits')
    expect(rendered).toContain('## Provider Issues')
    expect(rendered).toContain('## Review Intents')
    expect(rendered).toContain('intent_abc123')
    expect(rendered).toContain('## Judge Results')
    expect(rendered).toContain('## Aggregate Results')
    expect(rendered).toContain('agg_abc123')
    expect(rendered).toContain('Aggregate evidence: ev_diff1')
    expect(rendered).toContain('Decision evidence: ev_diff1')
    expect(rendered).toContain(
      'Similar issue check sibling-pattern: passed - Sibling changes were compared. evidence: ev_diff1'
    )
    expect(rendered).toContain('judge_abc123')
    expect(rendered).toContain('Judge evidence: ev_diff1')
    expect(rendered).toContain('Challenge:')
    expect(rendered).toContain('Check changed-branch')
    expect(rendered).toContain('Context request read')
    expect(rendered).toContain('Requested context:')
    expect(rendered).toContain('provider_error')
    expect(rendered).toContain('## Artifact-only Findings')
    expect(rendered).toContain('find_artifact1')
    expect(rendered).toContain('Trace budget: reads 1/1, searches 0/0, rounds 1/1')
    expect(rendered).toContain(
      'Tool call tool-read: completed ledger: ctx_abc123 - Read changed branch context.'
    )
    expect(rendered).toContain('## Proof Packets')
    expect(rendered).toContain('proof_abc123')
    expect(rendered).toContain('Proof evidence: ev_diff1')
    expect(rendered).toContain('Changed behavior: The changed branch can return the wrong value.')
    expect(rendered).toContain('Impact: Incorrect result reaches callers.')
    expect(rendered).toContain('Fix direction: Return the computed value.')
    expect(rendered).toContain('Contradiction check: No contradiction found.')
    expect(rendered).toContain('Refutation evidence: ev_diff1')
    expect(rendered).toContain(
      'Refutation check task-evidence: passed - Evidence exists. evidence: ev_diff1'
    )
    expect(rendered).toContain('## Promotion Decisions')
    expect(rendered).toContain(
      'cand_weak1: artifact-only proof: proof_abc123 refutation: refute_abc123'
    )
    expect(rendered).toContain('src/app.ts:4-4')
    expect(rendered).toContain('return computedValue')
    expect(rendered).toContain(
      'Bad \\\\| title &lt;script&gt;alert\\(1\\)&lt;/script&gt; \\#\\# Forged'
    )
    expect(rendered).not.toContain('\n## Forged')
    expect(rendered).not.toContain('![secret]')
    expect(rendered).not.toContain('sk-proj-abcdefghijklmnopqrstuvwxyz')
    expect(rendered).not.toContain('- medium: 1')
    expect(rendered).toMatchSnapshot()
  })

  test('renders missing critic evidence explicitly', () => {
    const report = createReportFixture()
    const rendered = renderMarkdownReport({
      ...report,
      aggregateResults: [
        {
          id: 'agg_empty',
          scope: 'run',
          verdict: 'needs-more-evidence',
          summary: 'The aggregate critic cited no decisive evidence.',
          candidateIds: ['cand_empty'],
          evidenceIds: [],
          decisions: [
            {
              candidateId: 'cand_empty',
              verdict: 'needs-more-evidence',
              summary: 'The decision is under-proved.',
              evidenceIds: [],
              relatedCandidateIds: []
            }
          ],
          similarIssueChecks: [
            {
              kind: 'sibling-pattern',
              result: 'unknown',
              summary: 'The sibling pattern check cited no decisive evidence.',
              evidenceIds: []
            }
          ]
        }
      ],
      refutationResults: [
        {
          id: 'refute_empty',
          proofPacketId: 'proof_empty',
          verdict: 'needs-more-evidence',
          summary: 'The refuter cited no decisive evidence.',
          evidenceIds: [],
          checks: [
            {
              kind: 'proof-review',
              result: 'unknown',
              summary: 'The proof review cited no evidence.',
              evidenceIds: []
            }
          ]
        }
      ],
      judgeResults: [
        {
          id: 'judge_empty',
          candidateId: 'cand_empty',
          verdict: 'needs-more-evidence',
          summary: 'The critic cited no decisive evidence.',
          challengeQuestions: [],
          verificationChecks: [
            {
              kind: 'challenge-evidence',
              result: 'unknown',
              summary: 'The check did not cite decisive evidence.',
              evidenceIds: []
            }
          ],
          contextRequests: [],
          requestedContext: [],
          evidenceIds: []
        }
      ]
    })

    expect(rendered).toContain('Refutation evidence: none cited')
    expect(rendered).toContain(
      'Refutation check proof-review: unknown - The proof review cited no evidence. evidence: none cited'
    )
    expect(rendered).toContain('Aggregate evidence: none cited')
    expect(rendered).toContain('Decision evidence: none cited')
    expect(rendered).toContain(
      'Similar issue check sibling-pattern: unknown - The sibling pattern check cited no decisive evidence. evidence: none cited'
    )
    expect(rendered).toContain('Judge evidence: none cited')
    expect(rendered).toContain(
      'Check challenge-evidence: unknown - The check did not cite decisive evidence. evidence: none cited'
    )
  })
})
