import type { AnchorTextResolver } from './admission-gate.js'

export type AnchorSourceFile = {
  readonly path: string
  readonly content: string
}

const splitLines = (content: string): readonly string[] =>
  content.split(/\r\n|\r|\n/u)

/**
 * Builds the resolver the admission gate uses to anchor fingerprints on source
 * content instead of line numbers.
 *
 * Files are indexed by their head-side content, so `old`-side locations resolve
 * to nothing: line N of the head file is not the line the finding refers to,
 * and an anchor taken from the wrong revision would be worse than no anchor.
 */
export const createSourceAnchorResolver = (
  files: readonly AnchorSourceFile[]
): AnchorTextResolver => {
  const linesByPath = new Map<string, readonly string[]>(
    files.map((file) => [file.path, splitLines(file.content)])
  )

  return (location) => {
    if (location.side === 'old') {
      return undefined
    }

    return linesByPath.get(location.path)?.[location.startLine - 1]
  }
}

/**
 * Reassembles anchor sources from review-context documents. Context assembly
 * splits a file into ordered byte-bounded chunks, so concatenating the chunks
 * for a path in array order restores the original content.
 */
export const anchorSourceFilesFromChunks = (
  chunks: readonly {
    readonly kind: string
    readonly path?: string | undefined
    readonly content: string
  }[]
): readonly AnchorSourceFile[] => {
  const contentByPath = new Map<string, string>()

  for (const chunk of chunks) {
    if (chunk.kind !== 'file' || chunk.path === undefined) {
      continue
    }

    contentByPath.set(
      chunk.path,
      `${contentByPath.get(chunk.path) ?? ''}${chunk.content}`
    )
  }

  return [...contentByPath].map(([path, content]) => ({ path, content }))
}
