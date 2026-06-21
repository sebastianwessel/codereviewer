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

export * from './shared/contracts/index.js'
export * from './domains/configuration/index.js'
export * from './domains/repository-intake/index.js'
export * from './domains/review-planning/index.js'
export * from './domains/shared-context/index.js'
export * from './domains/language-analyzers/index.js'
export * from './domains/provider-resolution/index.js'
export * from './domains/admission/index.js'
export * from './domains/review-workflow/index.js'
export * from './domains/reporting/index.js'
export * from './domains/evaluation/index.js'
export * from './domains/drift/index.js'

export const runtimeBaseline = {
  harnessVersion: '1.5.1'
} as const
