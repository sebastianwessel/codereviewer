// Eligibility gate the mediated context-retrieval tools (`read`, `list`,
// `grep`) consult before touching a file or directory. It combines two
// layers:
//
// 1. A hard-coded floor that no configuration can widen: dotfiles (`.env`,
//    `.env.local`, `.git`, `.codereviewer`, ...) and well-known
//    dependency/build/artifact directories (`node_modules`, `dist`) are
//    always ineligible, anywhere in the path.
// 2. The configured `paths.include` / `paths.exclude` globs (spec 04),
//    mirroring the general review's file-discovery scoping so the
//    verification agent investigates the same reviewable surface.
//
// The predicate never throws; callers decide how to react (reject an
// explicit request, silently prune a traversal candidate).
import { defaultReviewExcludePatterns } from '../../shared/contracts/index.js'
import { compileGlobMatchers, matchesAnyGlob } from '../../shared/glob/glob-matcher.js'

export type ContextRetrievalEligibilityConfig = {
  readonly include?: readonly string[]
  readonly exclude?: readonly string[]
}

export type EligibilityResult =
  | { readonly eligible: true }
  | { readonly eligible: false; readonly reason: string }

// Directory names that are always ineligible, anywhere in a path, regardless
// of configuration. These are not dotfiles, so the dotfile rule below does not
// already cover them.
const alwaysExcludedDirectorySegments: ReadonlySet<string> = new Set([
  'node_modules',
  'dist'
])

const isDotfileSegment = (segment: string): boolean =>
  segment.startsWith('.') && segment !== '.' && segment !== '..'

const hardExclusionReason = (
  pathSegments: readonly string[]
): string | undefined => {
  for (const segment of pathSegments) {
    // Case-fold the segment: on case-insensitive filesystems (macOS/Windows)
    // `NODE_MODULES` resolves to `node_modules`, so a re-cased segment must not
    // slip past this floor that no configuration can widen.
    if (alwaysExcludedDirectorySegments.has(segment.toLowerCase())) {
      return `path contains the always-excluded directory "${segment}"`
    }

    if (isDotfileSegment(segment)) {
      return `path contains the dotfile/hidden segment "${segment}"`
    }
  }

  return undefined
}

export type CompiledEligibilityConfig = {
  readonly includeMatchers: readonly RegExp[]
  readonly excludeMatchers: readonly RegExp[]
}

export const compileEligibilityConfig = (
  config: ContextRetrievalEligibilityConfig = {}
): CompiledEligibilityConfig => ({
  includeMatchers: compileGlobMatchers(config.include ?? ['**/*']),
  excludeMatchers: compileGlobMatchers(
    config.exclude ?? [...defaultReviewExcludePatterns]
  )
})

// Evaluates a repository-relative, POSIX-style path (as produced by
// `normalizeRepositoryRelativePath`) against the hard floor and the compiled
// configuration. Applies equally to files and directories so a traversal can
// prune an ineligible directory without descending into it.
export const evaluatePathEligibility = (
  portablePath: string,
  compiledConfig: CompiledEligibilityConfig
): EligibilityResult => {
  const segments = portablePath.split('/')
  const hardReason = hardExclusionReason(segments)

  if (hardReason !== undefined) {
    return { eligible: false, reason: hardReason }
  }

  if (matchesAnyGlob(portablePath, compiledConfig.excludeMatchers)) {
    return {
      eligible: false,
      reason: 'path matches a configured paths.exclude pattern'
    }
  }

  if (
    compiledConfig.includeMatchers.length > 0 &&
    !matchesAnyGlob(portablePath, compiledConfig.includeMatchers)
  ) {
    return {
      eligible: false,
      reason: 'path does not match any configured paths.include pattern'
    }
  }

  return { eligible: true }
}
