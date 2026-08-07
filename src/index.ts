export const projectName = '@sebastianwessel/codereviewer'

export {
  currentFileSystemFlavor,
  normalizeFileSystemPath,
  resolveExistingPathInsideRoot,
  resolveWritePathInsideRoot,
  toPortablePath,
  type FileSystemFlavor,
  type PathServiceOptions
} from './platform/path-service.js'

// `stableJsonDigest` used to reach this entrypoint through the `evaluation`
// barrel. It is a generic canonical-JSON hash with no evaluation semantics and
// now lives in `shared/json/`, so it is named here directly rather than dropped:
// moving a module must not silently remove a symbol from the package's public
// surface.
export { stableJsonDigest } from './shared/json/stable-json-digest.js'

export * from './shared/contracts/index.js'
export * from './domains/configuration/index.js'
export * from './domains/repository-intake/index.js'
export * from './domains/review-planning/index.js'
export * from './domains/context-retrieval/index.js'
export * from './domains/shared-context/index.js'
export * from './domains/deterministic-signals/index.js'
export * from './domains/provider-resolution/index.js'
export * from './domains/admission/index.js'
export * from './domains/review-workflow/index.js'
export * from './domains/reporting/index.js'
export * from './domains/evaluation/index.js'
export * from './domains/drift/index.js'
