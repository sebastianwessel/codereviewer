import type { NoContentEventRecorder } from '../observability/index.js'
import type { ReviewSharedContextSnapshot } from '../shared-context/index.js'
import type { StructuredError } from '../../shared/errors/error-normalizer.js'

export const recordObservedTaskEvents = (
  recorder: NoContentEventRecorder,
  taskEvents: ReviewSharedContextSnapshot['taskEvents']
): void => {
  for (const event of taskEvents) {
    recorder.recordTaskEvent({
      taskId: event.id,
      kind: event.kind,
      round: event.round,
      state: event.state,
      pathCount: event.paths.length,
      ...(event.workerId === undefined ? {} : { workerId: event.workerId })
    })
  }
}

export const recordObservedError = (
  recorder: NoContentEventRecorder,
  error: StructuredError
): void => {
  recorder.recordError({
    code: error.code,
    category: error.category,
    recoverable: error.recoverable
  })
}
