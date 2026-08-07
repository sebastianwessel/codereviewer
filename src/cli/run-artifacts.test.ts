// Spec 13 "Observability And Errors": drafting review comments records a
// no-content step — draft count, suggestion count, the resolved platform, and what
// resolved it. Nothing recorded it before, and the artifact writer read the
// detection `source` only to throw it away, so a run that resolved `generic` and
// produced zero drafts was byte-identical in the observability artifact to one
// where the feature never ran at all.
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { CodeReviewerConfigSchema } from '../shared/contracts/index.js'
import { createReportFixture } from '../shared/testing/report-fixture.js'
import { writeReviewArtifacts } from './run-artifacts.js'

const artifactRoot = '.codereviewer/runs/test-run'

const emptySnapshot = { events: [] as const }

const emptySharedContext = {
  sharedEntries: [],
  supportSignalFacts: [],
  taskEvents: [],
  currentTasks: [],
  contextLedgerEntries: [],
  evidenceRecords: [],
  candidateFindings: [],
  admissionDecisions: [],
  admittedFindings: [],
  rejectedFindings: []
}

type StepEvent = {
  readonly type: string
  readonly step?: string
  readonly durationMs?: number
  readonly attributes?: Record<string, unknown>
}

describe('writeReviewArtifacts — review-comment observability', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'run-artifacts-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  const runWith = async (reviewComments: Record<string, unknown>) => {
    await writeReviewArtifacts({
      repositoryRoot: root,
      artifactRoot,
      report: createReportFixture(),
      contextLedger: [],
      sharedContext: emptySharedContext,
      observability: emptySnapshot,
      config: CodeReviewerConfigSchema.parse({
        reporting: { formats: ['json'], reviewComments }
      })
    })

    const written = JSON.parse(
      await readFile(path.join(root, artifactRoot, 'observability.json'), 'utf8')
    ) as { readonly events: readonly StepEvent[] }

    return written.events.filter((event) => event.step === 'review_comments')
  }

  test('records the drafts, the suggestions, the platform and what detected it', async () => {
    const events = await runWith({ enabled: true, platform: 'github' })

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'step-ended',
      step: 'review_comments',
      attributes: {
        draftCount: 1,
        suggestionCount: 1,
        platform: 'github',
        // An explicit `platform` setting wins over every detection step, and the
        // record says so: "github because you asked for it" and "github because a
        // CI variable said so" are different facts about the same run.
        platformDetectedFrom: 'config'
      }
    })
    expect(events[0]).toHaveProperty('durationMs')
  })

  test('a run that resolved generic still names the platform it resolved to', async () => {
    // `generic` is a normal outcome, not an error, and it is the one a reader most
    // needs told: it is what a run gets when no signal matched.
    const events = await runWith({ enabled: true, platform: 'generic' })

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      attributes: { platform: 'generic', platformDetectedFrom: 'config' }
    })
  })

  test('emits no step when the feature is disabled', async () => {
    // The counterweight: the step means "drafting ran". A feature that is off did
    // not draft, and reporting zero drafts for it would say it did.
    expect(await runWith({ enabled: false })).toEqual([])
  })
})
