// Deciding which changed files are reviewable: the include/exclude glob scoping
// and the text/binary test that gate a path before its content is hashed.
//
// The binary test is deliberately NOT "contains a NUL byte". A NUL byte is the
// first signal, but a source file in a text language may legitimately contain
// one — an embedded `\0` in a string or fixture literal — and treating that as
// binary would silently drop a reviewable file from the change set. So a NUL is
// only decisive for a path that either has no known text-source extension or
// fails a UTF-8 round trip. Tools that classify on NUL alone skip such files
// entirely, which is how this capability nearly got deleted as unreachable.
import path from 'node:path'
import { matchesAnyGlob } from '../../shared/glob/glob-matcher.js'

const textSourceExtensions = new Set([
  '.cjs',
  '.cts',
  '.go',
  '.java',
  '.js',
  '.jsx',
  '.mjs',
  '.mts',
  '.py',
  '.rb',
  '.rs',
  '.ts',
  '.tsx'
])

const hasTextSourceExtension = (portablePath: string): boolean =>
  textSourceExtensions.has(path.posix.extname(portablePath).toLowerCase())

const isUtf8Text = (content: Buffer): boolean =>
  Buffer.from(content.toString('utf8'), 'utf8').equals(content)

export const isBinaryContent = (portablePath: string, content: Buffer): boolean => {
  if (!content.includes(0)) {
    return false
  }

  return !(hasTextSourceExtension(portablePath) && isUtf8Text(content))
}

export const isExcluded = (
  portablePath: string,
  matchers: readonly RegExp[]
): boolean => matchesAnyGlob(portablePath, matchers)

// A file is in scope when it matches an `include` glob (an empty include set
// means "include everything", matching the `['**/*']` default). Combined with
// the exclude check, this lets `paths.include` actually narrow the review set.
export const isIncluded = (
  portablePath: string,
  matchers: readonly RegExp[]
): boolean => matchers.length === 0 || matchesAnyGlob(portablePath, matchers)
