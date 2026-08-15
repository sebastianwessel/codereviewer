export {
  runDriftCheck,
  type DriftCheckResult,
  type DriftFinding
} from './drift-checker.js'
export {
  artifactContracts,
  artifactContractTags,
  artifactScanRoots,
  checkArtifactExamples,
  checkArtifactExamplesInFile,
  findArtifactExampleProblems,
  renderArtifactExampleIssues
} from './artifact-example-checker.js'
export {
  checkConfigDocumentFile,
  isConfigExampleValue,
  checkConfigExamples,
  checkConfigExamplesInFile,
  configScanRoots,
  extractJsonBlocks,
  renderConfigExampleIssues,
  type JsonBlock
} from './config-example-checker.js'
export type {
  TextFile
} from './markdown-sources.js'
