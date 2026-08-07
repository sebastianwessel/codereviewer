// The retriever is only named in a type position here — the commands that need
// one construct it themselves — so the import stays type-only and this module
// pulls no retrieval code into a command that does not read files.
import type { createContextRetriever } from '../domains/context-retrieval/index.js'

// Reads one repository file through the mediated retriever, which is the only
// filesystem seam these commands get: path containment, symlink-realpath
// re-checking, the eligibility gate and redaction all apply. An ineligible,
// missing, or over-budget file is skipped and counted; one unreadable file must
// not fail the whole report.
export const mediatedFileReader =
  (retriever: ReturnType<typeof createContextRetriever>) =>
  async (filePath: string): Promise<string | undefined> => {
    try {
      return (await retriever.readRepositoryFile({ path: filePath })).content
    } catch {
      return undefined
    }
  }
