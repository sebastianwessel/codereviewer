// Report fixtures shared by the digest, comment and pipeline tests.
//
// They are hand-built rather than captured from a paid run, and they are
// deliberately shaped like what the engine actually emits: a model-origin
// finding carries `side: "file"` (not `"new"`), which is the shape spec 13
// records having been got wrong once before, `fingerprints` is populated,
// because inline-comment identity depends on it, and an admitted finding carries
// `refutationId` with a matching `refutationResults` entry, because
// `aiReview.requireRefutation` is a literal `true` — a fixture with an empty
// refutation ledger is a shape the engine cannot produce.
//
// "Deliberately shaped like what the engine emits" is a claim, and a claim a
// reader cannot check is what this file got wrong: `impactReportFixture` went on
// asserting a `symbols[]` list the engine stopped writing at impact schema 2.0,
// so the Impact section of every pull-request comment rendered nothing for weeks
// while these tests stayed green. Every fixture that stands in for a run of THIS
// engine is therefore passed through the producer's own contract below, on
// import: when a report shape moves, the fixture stops being a payload the
// producer could emit and every test that reads it fails at once, naming the
// field. There is no exception, and there is no longer anything for one to be an
// exception to: `report-digest.ts` reads the artifacts of the run that produced
// them, out of the same checkout, so a shape no producer can write is a shape the
// digest refuses.

import { ChangeImpactReferenceReportSchema } from '../../src/domains/change-impact/impact-report.js'
import { IntentFulfilmentReportSchema } from '../../src/domains/intent-fulfilment/intent-fulfilment-report.js'
import { renderReviewComments } from '../../src/domains/reporting/index.js'
import {
  ReviewCommentDraftSchema,
  ReviewReportSchema
} from '../../src/shared/contracts/index.js'
import type { z } from 'zod'

// Returns the fixture unchanged — the digest parses raw JSON, so the fixtures
// stay plain literals rather than becoming parsed contract types — but refuses to
// hand back one the producer's contract rejects.
const asProducedByThisEngine = <T>(schema: z.ZodType, fixture: T): T => {
  schema.parse(fixture)

  return fixture
}

// Bookkeeping the comment never renders — hashes, coverage counters, per-finding
// provenance — is present because the producer always writes it. A fixture that
// omitted it would be a report no run could have produced, which is the whole
// failure this file is guarding against.
const hash = '1'.repeat(64)

export const reviewReportFixture = asProducedByThisEngine(ReviewReportSchema, {
  schemaVersion: '1.0',
  run: {
    runId: 'run_abc123',
    startedAt: '2026-07-31T09:00:00.000Z',
    completedAt: '2026-07-31T09:04:00.000Z',
    mode: 'pr',
    depth: 'balanced',
    repositoryRootHash: hash,
    configHash: hash,
    durationMs: 240_000,
    costUsd: 1.2345,
    warnings: ['context-source-failed: inbox']
  },
  coverage: {
    status: 'complete',
    excludedFileCount: 0,
    reviewableFileCount: 2,
    coveredFileCount: 2,
    reviewableBytes: 2_048,
    coveredBytes: 2_048,
    incompleteReasons: [],
    files: [
      {
        path: 'src/routes/admin.ts',
        contentHash: '2'.repeat(64),
        status: 'complete',
        bytes: 1_024,
        coveredBytes: 1_024,
        taskIds: ['task_abc123']
      },
      {
        path: 'src/db/pool.ts',
        contentHash: '3'.repeat(64),
        status: 'complete',
        bytes: 1_024,
        coveredBytes: 1_024,
        taskIds: ['task_abc123']
      }
    ]
  },
  admittedFindings: [
    {
      id: 'find_high1',
      taskId: 'task_abc123',
      severity: 'high',
      category: 'security',
      title: 'Session check removed from the admin route',
      description: 'The handler no longer calls requireSession before reading the user record.',
      location: { path: 'src/routes/admin.ts', startLine: 42, side: 'file' },
      evidenceIds: ['ev_diff1'],
      proposedBy: 'review-agent',
      admissionStatus: 'admitted',
      admittedAt: '2026-07-31T09:03:00.000Z',
      admissionEvidenceIds: ['ev_diff1'],
      provenance: {
        reviewer: 'review-agent',
        instructionHashes: [],
        skillHashes: [],
        signalVersions: {},
        configHash: hash
      },
      baselineStatus: 'new',
      reporterEligibility: 'inline',
      refutationId: 'refute_high1',
      fingerprints: [{ algorithm: 'sha256', value: 'fp1' }]
    },
    {
      id: 'find_medium1',
      taskId: 'task_abc123',
      severity: 'medium',
      category: 'bug',
      title: 'Unawaited promise leaves the handle open',
      description: 'close() returns a promise that is never awaited.',
      location: { path: 'src/db/pool.ts', startLine: 8, side: 'file' },
      evidenceIds: ['ev_diff2'],
      proposedBy: 'review-agent',
      admissionStatus: 'admitted',
      admittedAt: '2026-07-31T09:03:00.000Z',
      admissionEvidenceIds: ['ev_diff2'],
      provenance: {
        reviewer: 'review-agent',
        instructionHashes: [],
        skillHashes: [],
        signalVersions: {},
        configHash: hash
      },
      baselineStatus: 'existing',
      reporterEligibility: 'summary-only',
      fingerprints: [{ algorithm: 'sha256', value: 'fp2' }]
    }
  ],
  rejectedFindings: [],
  evidence: [],
  skippedFiles: [{ path: 'assets/logo.png', reason: 'binary' }],
  qualityGate: {
    passed: false,
    failingFindingIds: ['find_high1'],
    thresholds: { maxHigh: 0 }
  },
  refutationResults: [
    {
      id: 'refute_high1',
      candidateId: 'cand_high1',
      verdict: 'proved',
      summary:
        'Searched the route table for a guard that runs before the handler; none is registered.',
      evidenceIds: ['ev_diff1'],
      checks: []
    }
  ],
  providerIssues: [],
  artifacts: []
})

// A report shaped like a run that also produced an unresolved (`artifact-only`)
// suspicion, rejected candidates, a semantic merge, and a baseline with fixed
// entries — the four pieces of the report that `reviewReportFixture` alone
// (rejectedFindings empty, no discovery, no baseline) cannot exercise.
export const reviewReportWithFullAccountingFixture = asProducedByThisEngine(
  ReviewReportSchema,
  {
    ...reviewReportFixture,
    admittedFindings: [
      ...reviewReportFixture.admittedFindings,
      {
        id: 'find_unresolved1',
        taskId: 'task_abc123',
        severity: 'high',
        category: 'security',
        title: 'Possible SSRF via the fetched webhook URL',
        description: 'The handler fetches a URL taken from the request body.',
        location: { path: 'src/webhooks/deliver.ts', startLine: 17, side: 'file' },
        evidenceIds: ['ev_diff3'],
        proposedBy: 'review-agent',
        admissionStatus: 'admitted',
        admittedAt: '2026-07-31T09:03:00.000Z',
        admissionEvidenceIds: ['ev_diff3'],
        provenance: {
          reviewer: 'review-agent',
          instructionHashes: [],
          skillHashes: [],
          signalVersions: {},
          configHash: hash
        },
        baselineStatus: 'new',
        reporterEligibility: 'artifact-only',
        refutationId: 'refute_unresolved1',
        fingerprints: [{ algorithm: 'sha256', value: 'fp3' }]
      }
    ],
    rejectedFindings: [
      {
        candidateId: 'cand_rejected1',
        status: 'rejected',
        reason: 'refuted',
        message: 'The route is behind an existing auth middleware.'
      },
      {
        candidateId: 'cand_rejected2',
        status: 'rejected',
        // `below-threshold` is the vocabulary the admission gate actually writes;
        // this said `admission-gate` — the name of the stage, not one of its
        // reasons — which no run could have produced.
        reason: 'below-threshold',
        message: 'Severity below the configured threshold.'
      }
    ],
    refutationResults: [
      ...reviewReportFixture.refutationResults,
      {
        id: 'refute_unresolved1',
        candidateId: 'cand_unresolved1',
        verdict: 'needs-more-evidence',
        summary:
          'The allow-list this depends on is defined in a config file outside the reviewed diff.',
        evidenceIds: [],
        checks: []
      }
    ],
    // Discovery telemetry is written whole or not at all, so the merge counter the
    // comment renders arrives with the rest of the run's discovery accounting
    // rather than alone: three candidates raised across four calls, four of them
    // merged away into the three that survived.
    discovery: {
      totals: {
        callCount: 4,
        rawFindingCount: 7,
        rawFindingsPerCall: [2, 2, 2, 1],
        candidateCount: 3,
        droppedCount: 0,
        suppressedByIdCount: 0,
        suppressedByLocationCount: 0,
        cappedByLimitCount: 0,
        contextOverflowSplitCount: 0,
        mergeCallCount: 1,
        mergeGroupCount: 2,
        mergedAwayCount: 4
      },
      tasks: [
        {
          taskId: 'task_abc123',
          callCount: 4,
          rawFindingCount: 7,
          rawFindingsPerCall: [2, 2, 2, 1],
          candidateCount: 3,
          droppedCount: 0,
          suppressedByIdCount: 0,
          suppressedByLocationCount: 0,
          cappedByLimitCount: 0,
          contextOverflowSplitCount: 0,
          mergeCallCount: 1,
          mergeGroupCount: 2,
          mergedAwayCount: 4
        }
      ]
    },
    resolvedBaselineEntries: [
      { algorithm: 'sha256', value: 'resolvedfp1' },
      { algorithm: 'sha256', value: 'resolvedfp2' }
    ]
  }
)

// `review-comments.github.json` as the engine writes it — rendered by the engine's
// own GitHub renderer rather than transcribed from it, so the anchor fields this
// action posts from (`line`, `side`, `findingId`) cannot quietly stop matching what
// it will actually be handed.
export const renderedGithubCommentsFixture = renderReviewComments(
  [
    ReviewCommentDraftSchema.parse({
      path: 'src/routes/admin.ts',
      targetRange: { startLine: 42, endLine: 42 },
      body: '**HIGH security:** Session check removed\n\nFinding: find_high1',
      suggestion: {
        replacement: 'if (!(await requireSession(request))) return unauthorized()'
      },
      findingId: 'find_high1',
      severity: 'high',
      category: 'security'
    })
  ],
  'github'
)

export const intentReportFixture = asProducedByThisEngine(
  IntentFulfilmentReportSchema,
  {
    schemaVersion: '1.0',
    status: 'completed',
    generatedAt: '2026-07-31T09:04:00.000Z',
    scope: {
      baseRef: 'origin/main',
      headRef: 'HEAD',
      changedFileCount: 3,
      changedLineCount: 120,
      // No `changedLinesTruncated` here: the contract deliberately has no such slot,
      // because reaching `intentFulfilment.maxChangeLines` REFUSES the run instead
      // of writing a cut report. This fixture carried one anyway, which is a field
      // no reader could ever have been shown.
      intentOrigins: ['inbox:pull-request/42'],
      intentTruncated: false
    },
    summary: {
      intentFragmentCount: 1,
      obligationCount: 3,
      evidencedCount: 2,
      notEvidencedStatusCount: 1,
      // The producer always counts the prohibitions the change did not go against,
      // and the comment renders that clause from it. Absent, this fixture exercised
      // the digest's "the report does not say" default on every run of the suite.
      notContradictedCount: 0,
      undeterminedCount: 0,
      obligationsTruncated: false,
      uncitedObligationCount: 0,
      unverifiedEvidenceClaimCount: 0,
      notEvidencedCount: 1,
      extraScopeFileCount: 1
    },
    obligations: [
      {
        id: 'o1',
        source: { origin: 'inbox:pull-request/42', line: 3, text: 'Add a session guard' },
        statement: 'Add a session guard to the admin route',
        status: 'evidenced',
        evidence: [
          {
            path: 'src/routes/admin.ts',
            line: 40,
            side: 'added',
            text: 'const session = await requireSession(request)'
          }
        ]
      },
      {
        id: 'o2',
        source: { origin: 'inbox:pull-request/42', line: 5, text: 'Cover it with a test' },
        statement: 'Cover the guard with a test',
        status: 'not-evidenced'
      },
      {
        id: 'o3',
        source: { origin: 'inbox:pull-request/42', line: 6, text: 'Update the docs' },
        statement: 'Update the route documentation',
        status: 'evidenced',
        evidence: [
          { path: 'docs/routes.md', line: 12, side: 'added', text: 'Requires a session.' }
        ]
      }
    ],
    extraScope: [{ path: 'src/db/pool.ts', changedLineCount: 4 }],
    warnings: []
  }
)

// Schema 3.0, the shape the engine emits: what CHANGED and which FILES it reaches
// are two normalized lists, joined on the name/path/line triple.
//
// It carried the 1.1 shape — one `symbols` list with references nested inside it —
// long after the engine stopped writing it, and that is precisely how the comment's
// Impact section stayed empty for months with a green unit suite. A fixture in a
// shape no producer can write tests the reader against a world that does not exist.
export const impactReportFixture = asProducedByThisEngine(
  ChangeImpactReferenceReportSchema,
  {
    schemaVersion: '3.0',
    status: 'completed',
    // Adjudication is off by default, so a report whose reference list was never
    // triaged is the ordinary shape — and `disabled` is the vocabulary the producer
    // writes for it. `not-attempted` is not one of the three values the contract
    // has, so no run could have written it.
    adjudicationStatus: 'disabled',
    generatedAt: '2026-07-31T09:04:00.000Z',
    scope: {
      baseRef: 'origin/main',
      headRef: 'HEAD',
      changedFileCount: 3,
      deletedFileCount: 0
    },
    summary: {
      changedSymbolCount: 2,
      changedSymbolsTruncated: false,
      referencedSymbolCount: 1,
      impactedFileCount: 2,
      impactedTestFileCount: 1,
      referenceCount: 2,
      testReferenceCount: 1,
      nonSourceReferenceCount: 0,
      // The adjudication counters a 3.0 report always carries. All zero because the
      // tier was disabled: nothing was triaged, so nothing was relied upon, refused
      // or left unadjudicated, and no call was spent.
      impactFindingCount: 0,
      reliedUponPairCount: 0,
      deterministicNoImpactPairCount: 0,
      unadjudicatedPairCount: 0,
      adjudicationCallCount: 0,
      failedAdjudicationCallCount: 0,
      modelVerdictCounts: { relies: 0, 'does-not-rely': 0, undetermined: 0 },
      adjudicationCallsTruncated: false,
      rejectedFindingCount: 0
    },
    impactFindings: [],
    changedSymbols: [
      {
        name: 'requireSession',
        kind: 'export',
        language: 'typescript',
        definitionPath: 'src/auth/session.ts',
        definitionLine: 10,
        changeKind: 'modified',
        // What callers can now observe differently, and how far the reference
        // search got. A changed symbol carries all four; they are what separates
        // this report from a bounded grep.
        contractChanges: ['may now reject a session it previously accepted'],
        referencesInDefinitionFile: 0,
        referencesInNonSourceFiles: 0,
        referencesTruncated: false,
        referenceSearchTruncated: false
      },
      {
        name: 'unusedHelper',
        kind: 'declaration',
        language: 'typescript',
        definitionPath: 'src/auth/session.ts',
        definitionLine: 30,
        changeKind: 'new',
        contractChanges: [],
        referencesInDefinitionFile: 0,
        referencesInNonSourceFiles: 0,
        referencesTruncated: false,
        referenceSearchTruncated: false
      }
    ],
    impactedFiles: [
      {
        path: 'src/routes/admin.ts',
        symbols: [
          {
            name: 'requireSession',
            definitionPath: 'src/auth/session.ts',
            definitionLine: 10,
            sites: [{ line: 40, text: 'requireSession(request)' }]
          }
        ]
      },
      {
        path: 'src/routes/user.ts',
        symbols: [
          {
            name: 'requireSession',
            definitionPath: 'src/auth/session.ts',
            definitionLine: 10,
            sites: [{ line: 12, text: 'requireSession(request)' }]
          }
        ]
      }
    ],
    impactedTestFiles: [
      {
        path: 'src/auth/session.test.ts',
        symbols: [
          {
            name: 'requireSession',
            definitionPath: 'src/auth/session.ts',
            definitionLine: 10,
            sites: [{ line: 4, text: 'requireSession' }]
          }
        ]
      }
    ],
    warnings: []
  }
)

