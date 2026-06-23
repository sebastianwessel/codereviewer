import { describe, expect, test } from 'vitest'
import { createReviewSharedContext } from './shared-context.js'

describe('review shared context', () => {
  test('records append-only entries and snapshots without mutation leaks', () => {
    const context = createReviewSharedContext()

    context.appendSupportSignalFact({
      id: 'fact_abc',
      language: 'typescript',
      kind: 'import',
      path: 'src/app.ts',
      name: 'dep',
      moduleSpecifier: './dep.js',
      line: 1,
      summary: 'Imports dep.',
      contentHash:
        '1111111111111111111111111111111111111111111111111111111111111111'
    })
    context.appendTask({
      id: 'task_abc',
      kind: 'file',
      round: 1,
      paths: ['src/app.ts'],
      state: 'planned'
    })
    context.transitionTask('task_abc', 'running')
    context.transitionTask('task_abc', 'completed')

    const snapshot = context.snapshot()

    expect(snapshot.supportSignalFacts).toHaveLength(1)
    expect('tasks' in snapshot).toBe(false)
    expect(snapshot.taskEvents.map((task) => task.state)).toEqual([
      'planned',
      'running',
      'completed'
    ])
    expect(snapshot.currentTasks.map((task) => task.state)).toEqual([
      'completed'
    ])

    snapshot.taskEvents.push({
      id: 'task_abc',
      kind: 'file',
      round: 1,
      paths: ['src/app.ts'],
      state: 'failed'
    })

    expect(context.snapshot().taskEvents.map((task) => task.state)).toEqual([
      'planned',
      'running',
      'completed'
    ])
    expect(context.snapshot().currentTasks.map((task) => task.state)).toEqual([
      'completed'
    ])
  })

  test('renders compact digest entries and unfolds backing evidence by reference', () => {
    const context = createReviewSharedContext()

    context.appendEvidenceRecord({
      id: 'evidence_abc',
      kind: 'diagnostic',
      summary: 'Syntax parse diagnostic.',
      location: {
        path: 'src/app.ts',
        startLine: 1,
        side: 'file'
      },
      source: 'typescript-support-signal',
      contentHash:
        '1111111111111111111111111111111111111111111111111111111111111111',
      redactionApplied: true
    })
    context.appendCandidateFinding({
      id: 'cand_abc',
      taskId: 'task_abc',
      category: 'bug',
      severity: 'high',
      title: 'Syntax issue blocks review',
      description: 'The file has a syntax parse diagnostic.',
      location: {
        path: 'src/app.ts',
        startLine: 1,
        side: 'file'
      },
      evidenceIds: ['evidence_abc'],
      proposedBy: 'typescript-support-signal'
    })

    const digestEntry = context
      .digest()
      .find((entry) => entry.kind === 'candidate-finding')

    expect(digestEntry).toMatchObject({
      summary: 'Syntax issue blocks review',
      evidenceIds: ['evidence_abc'],
      refIds: ['cand_abc']
    })
    expect(context.unfoldEvidence(digestEntry!.id)).toEqual([
      expect.objectContaining({
        id: 'evidence_abc'
      })
    ])
  })

  test('deduplicates evidence records by id in snapshots and unfolded evidence', () => {
    const context = createReviewSharedContext()

    context.appendEvidenceRecord({
      id: 'evidence_abc',
      kind: 'diagnostic',
      summary: 'First diagnostic copy.',
      location: {
        path: 'src/app.ts',
        startLine: 1,
        side: 'file'
      },
      source: 'typescript-support-signal',
      redactionApplied: true
    })
    context.appendEvidenceRecord({
      id: 'evidence_abc',
      kind: 'diagnostic',
      summary: 'Duplicate later diagnostic copy.',
      location: {
        path: 'src/app.ts',
        startLine: 1,
        side: 'file'
      },
      source: 'typescript-support-signal',
      redactionApplied: true
    })
    context.appendCandidateFinding({
      id: 'cand_abc',
      taskId: 'task_abc',
      category: 'bug',
      severity: 'high',
      title: 'Syntax issue blocks review',
      description: 'The file has a syntax parse diagnostic.',
      location: {
        path: 'src/app.ts',
        startLine: 1,
        side: 'file'
      },
      evidenceIds: ['evidence_abc'],
      proposedBy: 'typescript-support-signal'
    })

    const digestEntry = context
      .digest()
      .find((entry) => entry.kind === 'candidate-finding')

    expect(context.snapshot().evidenceRecords).toEqual([
      expect.objectContaining({
        id: 'evidence_abc',
        summary: 'First diagnostic copy.'
      })
    ])
    expect(context.unfoldEvidence(digestEntry!.id)).toEqual([
      expect.objectContaining({
        id: 'evidence_abc',
        summary: 'First diagnostic copy.'
      })
    ])
  })

  test('deduplicates candidate findings by id in snapshots and digest entries', () => {
    const context = createReviewSharedContext()

    context.appendCandidateFinding({
      id: 'cand_abc',
      taskId: 'task_abc',
      category: 'bug',
      severity: 'high',
      title: 'First candidate title',
      description: 'The first candidate copy.',
      location: {
        path: 'src/app.ts',
        startLine: 1,
        side: 'file'
      },
      evidenceIds: ['evidence_abc'],
      proposedBy: 'review-agent'
    })
    context.appendCandidateFinding({
      id: 'cand_abc',
      taskId: 'task_abc',
      category: 'bug',
      severity: 'high',
      title: 'Duplicate candidate title',
      description: 'The duplicate candidate copy.',
      location: {
        path: 'src/app.ts',
        startLine: 1,
        side: 'file'
      },
      evidenceIds: ['evidence_abc'],
      proposedBy: 'review-agent'
    })

    expect(context.snapshot().candidateFindings).toEqual([
      expect.objectContaining({
        id: 'cand_abc',
        title: 'First candidate title'
      })
    ])
    expect(
      context.digest().filter((entry) => entry.kind === 'candidate-finding')
    ).toEqual([
      expect.objectContaining({
        summary: 'First candidate title',
        refIds: ['cand_abc']
      })
    ])
  })
})
