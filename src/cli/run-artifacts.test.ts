// Spec 13 "Observability And Errors": drafting review comments records a
// no-content step — draft count, suggestion count, the resolved platform, and what
// resolved it. Nothing recorded it before, and the artifact writer read the
// detection `source` only to throw it away, so a run that resolved `generic` and
// produced zero drafts was byte-identical in the observability artifact to one
// where the feature never ran at all.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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

  // The fixture's finding proposes an edit to `src/app.ts:4`. A suggestion is only
  // counted once that edit has been apply-checked against the file's real bytes,
  // so the file has to exist in the repository root under test.
  const writeReviewedFile = async (lineCount: number): Promise<void> => {
    await mkdir(path.join(root, 'src'), { recursive: true })
    await writeFile(
      path.join(root, 'src', 'app.ts'),
      Array.from({ length: lineCount }, (_, index) => `const l${index} = ${index}`)
        .join('\n')
    )
  }

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
    await writeReviewedFile(10)
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

  // The wiring proof for the apply-check: the ONLY difference from the test above
  // is the file the edit targets. Same report, same platform, same drafting — one
  // draft either way, and the suggestion count is what moves. Without the reader
  // reaching the real working tree, both runs would report the same count.
  test('a suggestion whose target file no longer has those lines is not counted', async () => {
    await writeReviewedFile(2)
    const events = await runWith({ enabled: true, platform: 'github' })

    expect(events[0]).toMatchObject({
      attributes: { draftCount: 1, suggestionCount: 0 }
    })
  })

  test('a suggestion whose target file is gone is not counted either', async () => {
    // Nothing written: the repository root under test has no `src/app.ts` at all.
    const events = await runWith({ enabled: true, platform: 'github' })

    expect(events[0]).toMatchObject({
      attributes: { draftCount: 1, suggestionCount: 0 }
    })
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
