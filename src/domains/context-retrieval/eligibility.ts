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
//    verification agent investigates the same reviewable surface. `include`
//    scopes FILES, so a DIRECTORY passes it when an included file could live
//    beneath it — otherwise scoping the review to a subtree would leave no
//    directory a traversal could start from.
//
// The predicate never throws; callers decide how to react (reject an
// explicit request, silently prune a traversal candidate).
import { z } from 'zod'
import { defaultReviewExcludePatterns } from '../../shared/contracts/index.js'
import {
  compileGlobAncestorMatchers,
  compileGlobMatchers,
  matchesAnyGlob
} from '../../shared/glob/glob-matcher.js'

// Both lists are `| undefined` rather than merely optional so a caller that
// carried this shape through a schema (`ContextRetrievalEligibilityConfigSchema`
// below) can hand it straight over: the project runs `exactOptionalPropertyTypes`,
// under which a parsed `include?: string[] | undefined` is not assignable to a
// plainly optional one, and rebuilding the object field by field at every call
// site to work around that would be four copies of the same conditional.
export type ContextRetrievalEligibilityConfig = {
  readonly include?: readonly string[] | undefined
  readonly exclude?: readonly string[] | undefined
}

// The same shape as a validated contract field, for the one caller that carries
// the configured scope across a schema boundary (the review workflow input,
// spec 16). Both lists stay optional so the absent case keeps meaning "no scope
// was configured, use this module's defaults" rather than "an empty scope",
// which for `include` would be a gate that admits nothing.
export const ContextRetrievalEligibilityConfigSchema = z.strictObject({
  include: z.array(z.string().min(1)).optional(),
  exclude: z.array(z.string().min(1)).optional()
})

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

// What the caller is asking about. `paths.include` scopes FILES (spec 04), so a
// directory is judged on what may live BENEATH it rather than on its own name;
// without that distinction an include list naming a subtree matches no directory
// to start a traversal from and refuses every `list` and `grep`.
//
// The default is `file`, the strict rule, so a caller that has not thought about
// directories cannot widen the gate by omission.
export type EligibilityEntryKind = 'file' | 'directory'

export type CompiledEligibilityConfig = {
  readonly includeMatchers: readonly RegExp[]
  // The same include patterns, compiled to match the directories a matching file
  // could live beneath. Compiled once alongside the file matchers because the
  // gate is consulted for every entry of every traversal.
  readonly includeAncestorMatchers: readonly RegExp[]
  readonly excludeMatchers: readonly RegExp[]
}

export const compileEligibilityConfig = (
  config: ContextRetrievalEligibilityConfig = {}
): CompiledEligibilityConfig => {
  const includePatterns = config.include ?? ['**/*']

  return {
    includeMatchers: compileGlobMatchers(includePatterns),
    includeAncestorMatchers: compileGlobAncestorMatchers(includePatterns),
    excludeMatchers: compileGlobMatchers(
      config.exclude ?? [...defaultReviewExcludePatterns]
    )
  }
}

// The repository root, which every repository-relative path is beneath, so it is
// an ancestor of every includable file by construction and no pattern has to say
// so. `normalizeRepositoryRelativePath` renders it as `.`.
const repositoryRootPath = '.'

// Whether the include layer admits this path. For a file that is the plain glob
// test. For a directory it is the ancestor test: the directory is admitted when
// an included file could live beneath it, which is what makes it traversable.
const matchesIncludeLayer = (
  portablePath: string,
  compiledConfig: CompiledEligibilityConfig,
  entryKind: EligibilityEntryKind
): boolean => {
  if (entryKind === 'file') {
    return matchesAnyGlob(portablePath, compiledConfig.includeMatchers)
  }

  return (
    portablePath === repositoryRootPath ||
    // A directory that is itself included (`src/domains` under `src/**/*`) is
    // traversable without consulting the ancestor matchers at all.
    matchesAnyGlob(portablePath, compiledConfig.includeMatchers) ||
    matchesAnyGlob(portablePath, compiledConfig.includeAncestorMatchers)
  )
}

// Evaluates a repository-relative, POSIX-style path (as produced by
// `normalizeRepositoryRelativePath`) against the hard floor and the compiled
// configuration.
//
// The hard floor and `paths.exclude` apply identically to files and directories,
// so a traversal still prunes an excluded or hidden directory without descending
// into it. Only the include layer distinguishes them, and only in the widening
// direction — see `EligibilityEntryKind`. That widening is safe only because
// every entry a traversal yields is gated here again, individually, as the file
// it is (spec 07, *Mediated Read Eligibility*).
export const evaluatePathEligibility = (
  portablePath: string,
  compiledConfig: CompiledEligibilityConfig,
  entryKind: EligibilityEntryKind = 'file'
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
    !matchesIncludeLayer(portablePath, compiledConfig, entryKind)
  ) {
    return {
      eligible: false,
      reason:
        entryKind === 'directory'
          ? 'no configured paths.include pattern can match a file beneath this path'
          : 'path does not match any configured paths.include pattern'
    }
  }

  return { eligible: true }
}
