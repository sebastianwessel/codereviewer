import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { resolveExistingPathInsideRoot } from '../../platform/path-service.js'
import type { ContextInboxProviderSchema } from '../../shared/contracts/config/config.schema.js'
import type { z } from 'zod'
import type { ContextFragment, ContextProvider } from './contracts.js'
import { parseFrontmatter } from './frontmatter.js'
import { truncateToUtf8Bytes } from './text.js'

type InboxConfig = z.infer<typeof ContextInboxProviderSchema>

/**
 * Reads frontmatter-markdown context files a pipeline wrote into a directory
 * before the review. This is the decoupled path for issue-tracker and other
 * external content: the pipeline owns the fetch and its credentials, and the
 * product never integrates those systems.
 *
 * The directory and every file resolve under the repository root through
 * path-service. A missing directory yields no fragments rather than an error.
 */
export const createInboxProvider = (config: InboxConfig): ContextProvider => ({
  id: `inbox:${config.dir}`,
  gather: async (input) => {
    const directory = await resolveExistingPathInsideRoot(
      input.repositoryRoot,
      config.dir
    ).catch(() => undefined)

    if (directory === undefined) {
      return []
    }

    const entries = await readdir(directory, { withFileTypes: true })
    const fileNames = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => entry.name)
      .sort()
      .slice(0, config.maxFiles)

    const fragments: ContextFragment[] = []

    for (const name of fileNames) {
      const filePath = await resolveExistingPathInsideRoot(
        input.repositoryRoot,
        path.posix.join(config.dir, name)
      )
      const raw = await readFile(filePath, 'utf8')
      const { metadata, body } = parseFrontmatter(raw)
      const boundedBody = truncateToUtf8Bytes(body.trim(), config.maxFileBytes)

      if (boundedBody.length === 0) {
        continue
      }

      const source = metadata.source ?? 'file'
      const id = metadata.id ?? name
      const title = metadata.title

      fragments.push({
        origin: `inbox:${source}/${id}`,
        kind: 'inbox',
        ...(title === undefined || title.length === 0 ? {} : { title }),
        body: boundedBody,
        metadata
      })
    }

    return fragments
  }
})
