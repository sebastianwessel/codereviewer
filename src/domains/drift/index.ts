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
  type ArtifactExampleProblem
} from './artifact-example-checker.js'
export {
  checkConfigDocumentFile,
  isConfigExampleValue,
  checkConfigExamples,
  checkConfigExamplesInFile,
  configScanRoots,
  extractJsonBlocks,
  parseJson,
  type JsonBlock
} from './config-example-checker.js'
export {
  checkConfigDefaultTables,
  checkDocumentedDefaultRow,
  configDefaultTableScanRoots,
  configSchemaInventory,
  countKeyTables,
  extractDocumentedDefaultRows,
  type DocumentedDefaultRow,
  type SchemaInventory,
  type SchemaLeaf
} from './config-default-table-checker.js'
// One renderer for all three checkers' issues, which share one shape.
export {
  renderDocumentIssues,
  type DocumentIssue
} from './document-issue.js'
export type {
  TextFile
} from './markdown-sources.js'
