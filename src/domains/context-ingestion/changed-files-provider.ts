import type { ContextChangedFilesProviderSchema } from '../../shared/contracts/config/config.schema.js'
import type { z } from 'zod'
import type { ContextFragment, ContextProvider } from './contracts.js'
import { compileGlobMatchers, matchesAnyGlob, truncateToUtf8Bytes } from './text.js'

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
      const selected = input.changedFiles
        .filter((file) => matchesAnyGlob(file.path, matchers))
        .slice(0, config.maxFiles)

      return selected.map<ContextFragment>((file) => ({
        origin: `changed-file:${file.path}`,
        kind: 'changed-file',
        title: file.path,
        body: truncateToUtf8Bytes(file.content, config.maxFileBytes),
        metadata: { path: file.path }
      }))
    }
  }
}
