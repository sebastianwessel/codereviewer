import { type ContextRequestArtifacts } from './model-context-artifacts.js'

export const proofFollowUpArtifactsAreUsable = (
  artifacts: ContextRequestArtifacts | undefined
): artifacts is ContextRequestArtifacts =>
  artifacts !== undefined &&
  (artifacts.evidence.length > 0 || artifacts.reviewContext.length > 0)
