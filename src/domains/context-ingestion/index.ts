// Public API of the context-ingestion domain. Providers, the frontmatter
// parser, and text helpers are internal to the domain (composed by
// `runContextIngestion`) and are imported directly by their colocated tests.
export type {
  ChangeIntentBrief,
  ContextFragment,
  ContextFragmentKind,
  ContextGatherInput,
  ContextProvider,
  ContextSummarizer,
  SummarizeInput
} from './contracts.js'
export { createDigestSummarizer } from './digest-summarizer.js'
export { createModelSummarizer } from './model-summarizer.js'
export {
  runContextIngestion,
  type ContextIngestionResult,
  type ProviderGatherMetric
} from './ingest.js'
