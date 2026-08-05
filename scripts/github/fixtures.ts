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

export const reviewReportFixture = {
  schemaVersion: '1.0',
  run: {
    runId: 'run_abc123',
    startedAt: '2026-07-31T09:00:00.000Z',
    completedAt: '2026-07-31T09:04:00.000Z',
    mode: 'pr',
    depth: 'balanced',
    durationMs: 240_000,
    costUsd: 1.2345,
    warnings: ['context-source-failed: inbox']
  },
  coverage: { status: 'complete' },
  admittedFindings: [
    {
      id: 'find_high1',
      severity: 'high',
      category: 'security',
      title: 'Session check removed from the admin route',
      description: 'The handler no longer calls requireSession before reading the user record.',
      location: { path: 'src/routes/admin.ts', startLine: 42, side: 'file' },
      baselineStatus: 'new',
      reporterEligibility: 'inline',
      refutationId: 'refute_high1',
      fingerprints: [{ algorithm: 'sha256', value: 'fp1' }]
    },
    {
      id: 'find_medium1',
      severity: 'medium',
      category: 'bug',
      title: 'Unawaited promise leaves the handle open',
      description: 'close() returns a promise that is never awaited.',
      location: { path: 'src/db/pool.ts', startLine: 8, side: 'file' },
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
}

// A report shaped like a run that also produced an unresolved (`artifact-only`)
// suspicion, rejected candidates, a semantic merge, and a baseline with fixed
// entries — the four pieces of the report that `reviewReportFixture` alone
// (rejectedFindings empty, no discovery, no baseline) cannot exercise.
export const reviewReportWithFullAccountingFixture = {
  ...reviewReportFixture,
  admittedFindings: [
    ...reviewReportFixture.admittedFindings,
    {
      id: 'find_unresolved1',
      severity: 'high',
      category: 'security',
      title: 'Possible SSRF via the fetched webhook URL',
      description: 'The handler fetches a URL taken from the request body.',
      location: { path: 'src/webhooks/deliver.ts', startLine: 17, side: 'file' },
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
      reason: 'admission-gate',
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
  discovery: {
    totals: { mergedAwayCount: 4 }
  },
  resolvedBaselineEntries: [
    { algorithm: 'sha256', value: 'resolved_fp1' },
    { algorithm: 'sha256', value: 'resolved_fp2' }
  ]
}

export const renderedGithubCommentsFixture = [
  {
    path: 'src/routes/admin.ts',
    body: '**HIGH security:** Session check removed\n\nFinding: find_high1\n\n```suggestion\nif (!(await requireSession(request))) return unauthorized()\n```',
    findingId: 'find_high1',
    severity: 'high',
    category: 'security',
    line: 42,
    side: 'RIGHT'
  }
]

export const intentReportFixture = {
  schemaVersion: '1.0',
  status: 'completed',
  generatedAt: '2026-07-31T09:04:00.000Z',
  scope: {
    baseRef: 'origin/main',
    headRef: 'HEAD',
    changedFileCount: 3,
    changedLineCount: 120,
    changedLinesTruncated: false,
    intentOrigins: ['inbox:pull-request/42'],
    intentTruncated: false
  },
  summary: {
    intentFragmentCount: 1,
    obligationCount: 3,
    evidencedCount: 2,
    notEvidencedStatusCount: 1,
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

export const impactReportFixture = {
  schemaVersion: '1.1',
  status: 'completed',
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
    referenceCount: 2,
    testReferenceCount: 1,
    nonSourceReferenceCount: 0
  },
  symbols: [
    {
      name: 'requireSession',
      kind: 'export',
      language: 'typescript',
      definitionPath: 'src/auth/session.ts',
      definitionLine: 10,
      changeKind: 'modified',
      references: [
        { path: 'src/routes/admin.ts', line: 40, text: 'requireSession(request)' },
        { path: 'src/routes/user.ts', line: 12, text: 'requireSession(request)' }
      ],
      testReferences: [
        { path: 'src/auth/session.test.ts', line: 4, text: 'requireSession' }
      ],
      referencesInDefinitionFile: 0,
      referencesInNonSourceFiles: 0,
      referencesTruncated: false
    },
    {
      name: 'unusedHelper',
      kind: 'declaration',
      language: 'typescript',
      definitionPath: 'src/auth/session.ts',
      definitionLine: 30,
      changeKind: 'new',
      references: [],
      testReferences: [],
      referencesInDefinitionFile: 0,
      referencesInNonSourceFiles: 0,
      referencesTruncated: false
    }
  ],
  warnings: []
}

