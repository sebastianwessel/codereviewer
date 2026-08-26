import type { ContextChangedFilesProviderSchema } from '../../shared/contracts/config/config.schema.js'
import type { z } from 'zod'
import type { ContextFragment, ContextProvider } from './contracts.js'
import {
  compileGlobMatchers,
  matchesAnyGlob
} from '../../shared/glob/glob-matcher.js'
import { truncateToUtf8Bytes } from './text.js'

type ChangedFilesConfig = z.infer<typeof ContextChangedFilesProviderSchema>

/**
 * Surfaces repository files changed in the reviewed diff that match the
 * configured globs (for example changed specs/docs) as intent context for the
 * code-review tasks. Within-repo, no network. Built on the changed-file set the
 * intake already produced.
 */
export const createChangedFilesProvider = (
  config: ChangedFilesConfig
): ContextProvider => {
  const matchers = compileGlobMatchers(config.include)

  return {
    id: 'changed-files',
    gather: async (input) => {
      const matched = input.changedFiles.filter((file) =>
        matchesAnyGlob(file.path, matchers)
      )
      // Diff order, then a plain slice: the survivors are the files the diff
      // happened to list first, not the ones most likely to state the intent.
      // The caller is told the pre-cap count so it can say so out loud.
      const selected = matched.slice(0, config.maxFiles)

      return {
        fragments: selected.map<ContextFragment>((file) => {
          const body = truncateToUtf8Bytes(file.content, config.maxFileBytes)

          return {
            origin: `changed-file:${file.path}`,
            kind: 'changed-file',
            title: file.path,
            body,
            // A spec whose acceptance criteria sit past byte 64 000 reaches the
            // reviewer headless. Recorded here because this is the last point
            // where the full length is still known.
            truncated: body.length < file.content.length,
            metadata: { path: file.path }
          }
        }),
        matchedCount: matched.length
      }
    }
  }
}
