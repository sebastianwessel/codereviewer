// Failures this domain raises, all of them loud.
//
// AN ARTIFACT THAT CANNOT BE READ IS NEVER "NO SECURITY ISSUES". A missing file, an
// oversized one, a malformed one, or one written in a version this reader does not
// understand each produce an empty alert list, and an empty alert list is
// indistinguishable from a clean scan. So none of them is allowed to return: every
// one throws a configuration-category structured error, which the CLI reports and
// exits 2 on.

import {
  createStructuredError,
  type StructuredError,
  type StructuredErrorDetails
} from '../../shared/errors/error-normalizer.js'

export const analyzerArtifactError = (input: {
  readonly code:
    | 'analyzer_artifact_unreadable'
    | 'analyzer_artifact_too_large'
    | 'analyzer_artifact_invalid'
  readonly message: string
  readonly details?: StructuredErrorDetails
}): StructuredError =>
  createStructuredError({
    code: input.code,
    message: input.message,
    category: 'config',
    ...(input.details === undefined ? {} : { details: input.details })
  })
