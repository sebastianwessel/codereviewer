// Reading the corpus manifest an advisory eval run is pointed at, with the
// failures said in the operator's vocabulary rather than the filesystem's.
//
// Both eval commands resolved the manifest through `resolveExistingPathInsideRoot`
// and let whatever it threw escape. Two ordinary mistakes came out unusable:
//
//   `--manifest /abs/path.json`  -> config_error: "Path value must be relative to
//                                   the root." — which names no flag, no file, and
//                                   never says what "the root" is.
//   `--manifest eval/typo.json`  -> repository_error: "ENOENT: no such file or
//                                   directory, realpath '<absolute host path>'",
//                                   a category that means the repository under
//                                   review is broken, for a mistyped CLI argument.
//
// Neither is the engine's fault and neither should read as one. This is the same
// shape `baseline-source.ts` already fixed for `--report`: one message per cause,
// each naming the offending value and the remedy.
//
// The default path gets its own wording. A caller who never passed `--manifest`
// has not made a typo — they are missing a hydration step — so pointing them at
// the flag would send them to fix something they did not set.

import { readFile } from 'node:fs/promises'
import { resolveExistingPathInsideRoot } from '../platform/path-service.js'
import {
  createStructuredError,
  isFileNotFoundError
} from '../shared/errors/error-normalizer.js'

/**
 * Reads a corpus manifest, or throws a `config_error` naming the path, the cause
 * and what to do about it.
 */
export const readCorpusManifest = async (input: {
  readonly cwd: string
  readonly manifestPath: string
  /** `impact` or `intent`, so the message can name the hydration script. */
  readonly commandName: string
  /** True when no `--manifest` was passed and the descriptor's default is in use. */
  readonly isDefaultPath: boolean
}): Promise<string> => {
  const remedy = input.isDefaultPath
    ? `This is the default manifest for \`eval ${input.commandName}\`, so nothing pointed at it — the corpus is probably not hydrated yet. Run \`npm run eval:${input.commandName}-corpus:hydrate\`, or pass --manifest at a manifest you already have.`
    : 'Pass --manifest at a repository-relative path to an existing corpus manifest.'

  try {
    return await readFile(
      await resolveExistingPathInsideRoot(input.cwd, input.manifestPath),
      'utf8'
    )
  } catch (error) {
    // A path outside the repository is refused BEFORE the filesystem is touched,
    // so it cannot be told apart by errno — it is the containment refusal, and it
    // is the one an absolute path produces. Named separately because the remedy is
    // not "check the spelling": the path may exist and still not be readable here.
    if (error instanceof TypeError) {
      throw createStructuredError({
        code: 'config_error',
        message: `The corpus manifest "${input.manifestPath}" is not a repository-relative path inside this repository, so it was not read. ${remedy}`,
        category: 'config',
        details: { manifestPath: input.manifestPath, cause: 'outside_repository' }
      })
    }

    if (isFileNotFoundError(error)) {
      throw createStructuredError({
        code: 'config_error',
        message: `The corpus manifest "${input.manifestPath}" does not exist. ${remedy}`,
        category: 'config',
        details: { manifestPath: input.manifestPath, cause: 'missing' }
      })
    }

    // Anything else — a permission failure, a directory where a file belongs —
    // keeps its own cause rather than being flattened into "missing", which would
    // send the reader to check a spelling that is already correct.
    throw createStructuredError({
      code: 'config_error',
      message: `The corpus manifest "${input.manifestPath}" could not be read (${error instanceof Error ? error.message : 'unknown error'}). ${remedy}`,
      category: 'config',
      details: { manifestPath: input.manifestPath, cause: 'unreadable' }
    })
  }
}
