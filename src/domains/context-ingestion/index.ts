// Public API of the context-ingestion domain. Providers and text helpers are
// internal to the domain (composed by `runContextIngestion`) and are imported
// directly by their colocated tests.
//
// `parseFrontmatter` is the one exception, and it became one when something
// outside this domain started AUTHORING inbox documents: the intent-fulfilment
// corpus assembles a stated intent whose obligations are addressed by line, and
// the line numbering it publishes is the numbering this parser produces. That
// makes the parse rule a contract between two domains rather than an internal
// detail, and a contract only one side can see is one nobody can test.
export {
  parseFrontmatter
} from './frontmatter.js'
export type {
  ChangeIntentBrief,
  ContextFragment,
  ContextGatherOutput,
  ContextProvider,
  ContextSummarizer
} from './contracts.js'
export {
  createDigestSummarizer
} from './digest-summarizer.js'
export {
  createModelSummarizer
} from './model-summarizer.js'
export {
  gatherContextFragments,
  runContextIngestion,
  type ContextIngestionResult
} from './ingest.js'
