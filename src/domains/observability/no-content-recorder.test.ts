import { describe, expect, test } from 'vitest'
import { createNoContentEventRecorder } from './no-content-recorder.js'

describe('no-content event recorder', () => {
  test('records run, step, task, and error events without content fields', () => {
    const recorder = createNoContentEventRecorder()

    recorder.startRun({
      runId: 'run-1',
      mode: 'local',
      prompt: 'do not keep',
      sourceContent: 'do not keep',
      secretKey: 'sk-proj-secret'
    })
    const step = recorder.startStep('repository_intake', {
      changedFileCount: 2,
      rawOutput: 'do not keep'
    })
    step.end({
      skippedFileCount: 1,
      headers: ['do not keep']
    })
    recorder.recordTaskEvent({
      taskId: 'task_a',
      state: 'completed',
      pathCount: 1,
      source: 'do not keep'
    })
    recorder.recordError({
      code: 'provider_error',
      category: 'provider',
      recoverable: true
    })

    const snapshot = recorder.snapshot()
    const serialized = JSON.stringify(snapshot)

    expect(snapshot.events.map((event) => event.type)).toEqual([
      'run-started',
      'step-started',
      'step-ended',
      'task-event',
      'run-error'
    ])
    expect(serialized).toContain('run-1')
    expect(serialized).toContain('changedFileCount')
    expect(serialized).not.toContain('do not keep')
    expect(serialized).not.toContain('sk-proj-secret')
  })

  // A refused attribute used to be removed outright, so an event that lost one was
  // indistinguishable from an event whose step had nothing to say — the same silent
  // absence this recorder exists to prevent, turned on itself. The key stays and the
  // value is replaced; nothing about the value is disclosed.
  test('states that a refused attribute was dropped instead of removing it', () => {
    const recorder = createNoContentEventRecorder()

    recorder.startStep('probe', {
      keptCount: 3,
      rawOutput: 'do not keep',
      nested: { deep: 'do not keep' } as never
    })

    const [event] = recorder.snapshot().events

    expect(event?.type === 'step-started' ? event.attributes : undefined).toEqual({
      keptCount: 3,
      rawOutput: '[dropped: attribute name is not no-content safe]',
      nested: '[dropped: value is not a bounded scalar]'
    })
    expect(JSON.stringify(recorder.snapshot())).not.toContain('do not keep')
  })

  // A count is not the thing counted. `inputTokens` matches the key pattern on
  // "token", so these were dropped from every run this recorder ever wrote while
  // the counts themselves were correct and reached the run summary — the step
  // simply reported nothing.
  test('carries a count whose key the pattern would refuse, when the value is a number', () => {
    const recorder = createNoContentEventRecorder()

    recorder.startStep('provider_workflow', {
      inputTokens: 1200,
      outputTokens: 340,
      cachedInputTokens: 900
    })

    const [event] = recorder.snapshot().events

    expect(event?.type === 'step-started' ? event.attributes : undefined).toEqual({
      inputTokens: 1200,
      outputTokens: 340,
      cachedInputTokens: 900
    })
  })

  // The exemption is by exact key AND numeric value, so it cannot be turned into
  // a channel by parking a string under an exempt name, and no new name is
  // admitted by resembling one.
  test('refuses an exempt count key whose value is not a number, and refuses lookalike names', () => {
    const recorder = createNoContentEventRecorder()

    recorder.startStep('probe', {
      inputTokens: 'sk-do-not-keep' as never,
      inputTokensRemaining: 5 as never
    })

    const [event] = recorder.snapshot().events

    expect(event?.type === 'step-started' ? event.attributes : undefined).toEqual({
      inputTokens: '[dropped: attribute name is not no-content safe]',
      inputTokensRemaining: '[dropped: attribute name is not no-content safe]'
    })
    expect(JSON.stringify(recorder.snapshot())).not.toContain('do-not-keep')
  })

  // Spec 11 needs a step whose duration was measured where the work happened: the
  // ingestion loop times each context provider itself, and re-opening a step around
  // the reporting would time the reporting.
  test('records a completed step with the duration its caller measured', () => {
    const recorder = createNoContentEventRecorder()

    recorder.recordCompletedStep({
      name: 'context_ingestion_provider',
      durationMs: 42,
      attributes: { originLabel: 'inbox:.codereviewer/context', status: 'included' }
    })

    expect(recorder.snapshot().events).toEqual([
      {
        type: 'step-ended',
        at: expect.any(String),
        step: 'context_ingestion_provider',
        durationMs: 42,
        attributes: {
          originLabel: 'inbox:.codereviewer/context',
          status: 'included'
        }
      }
    ])
  })
})
