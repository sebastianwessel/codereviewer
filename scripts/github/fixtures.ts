// Report fixtures shared by the digest, comment and pipeline tests.
//
// They are hand-built rather than captured from a paid run, and they are
// deliberately shaped like what the engine actually emits: a model-origin
// finding carries `side: "file"` (not `"new"`), which is the shape spec 13
// records having been got wrong once before, and `fingerprints` is populated,
// because inline-comment identity depends on it.

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
  refutationResults: [],
  providerIssues: [],
  artifacts: []
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

export const conformanceReportFixture = {
  schemaVersion: '1.0',
  status: 'completed',
  generatedAt: '2026-07-31T09:04:00.000Z',
  scope: {
    baseRef: 'origin/main',
    headRef: 'HEAD',
    changedFileCount: 3,
    peerFileCount: 12,
    peerFilesTruncated: false
  },
  summary: {
    changedDeclarationCount: 5,
    changedDeclarationsTruncated: false,
    peerSetCount: 2,
    changeAttributedDivergenceCount: 1,
    preExistingDivergenceCount: 2,
    changeAttributedDivergencesTruncated: false,
    preExistingDivergencesTruncated: false,
    adjudication: {
      mode: 'deterministic',
      requestedCount: 0,
      conventionCount: 0,
      incidentalCount: 0,
      undeterminedCount: 0,
      failedCount: 0,
      unadjudicatedCount: 0
    }
  },
  changeAttributedDivergences: [
    {
      id: 'd1',
      attribution: 'change-attributed',
      declaration: {
        path: 'src/routes/admin.ts',
        line: 38,
        name: 'handleAdmin',
        kind: 'export',
        language: 'typescript',
        endLine: 60
      },
      pattern: { kind: 'guard', symbol: 'requireSession' },
      peerScope: 'directory',
      peerCount: 9,
      citedPeerCount: 8,
      citedPeers: [
        { path: 'src/routes/user.ts', line: 12, name: 'handleUser' },
        { path: 'src/routes/order.ts', line: 9, name: 'handleOrder' },
        { path: 'src/routes/cart.ts', line: 7, name: 'handleCart' }
      ],
      peersTruncated: false,
      statement: '8 of 9 route handlers in this directory call requireSession in a guard position; handleAdmin does not.',
      question: 'Is the guard intentionally absent here?'
    }
  ],
  preExistingDivergences: [],
  warnings: []
}
