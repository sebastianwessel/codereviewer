export {
  runDriftCheck,
  DriftCheckResultSchema,
  DriftFindingSchema,
  DriftGateSchema,
  type DriftCheckResult,
  type DriftFinding,
  type DriftGate
} from './drift-checker.js'
export {
  checkConfigExamples,
  checkConfigExamplesInFile,
  configExampleScanRoots,
  extractJsonBlocks,
  renderConfigExampleIssues,
  ConfigExampleCheckResultSchema,
  ConfigExampleIssueKindSchema,
  ConfigExampleIssueSchema,
  type ConfigExampleCheckResult,
  type ConfigExampleIssue,
  type ConfigExampleIssueKind,
  type JsonBlock
} from './config-example-checker.js'
export { type TextFile } from './markdown-sources.js'
