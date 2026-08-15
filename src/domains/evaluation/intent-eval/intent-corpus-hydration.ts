import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  resolveExistingPathInsideRoot,
  resolveWritePathInsideRoot
} from '../../../platform/path-service.js'
import { selectCorpusCases } from '../corpus/real-repo-corpus.schema.js'
import { pruneUnknownCaseDirectories } from '../corpus/git-corpus-hydration.js'
import {
  defaultCorpusGitRunner,
  gitCheckoutArgs,
  gitDisableAutoCrlfArgs,
  gitFetchArgs,
  gitInitArgs,
  gitRemoteArgs,
  type CorpusGitCommandRunner
} from '../corpus/git-corpus-plumbing.js'
import {
  countOutstandingExpectationsByArm,
  parseIntentCorpusManifestJson,
  type IntentArmCounts,
  type IntentCorpusCase,
  type IntentCorpusManifest
} from './intent-corpus.schema.js'

// Hydration for the intent-fulfilment corpus (spec 23 §Evaluation).
//
// IT MAKES NO NETWORK REQUEST AND SPENDS NOTHING. The fixture repository is the
// one being hydrated FROM: every commit a case names is in this repository's own
// history, so `origin` is a local path. That is the whole reason this corpus is
// reproducible from a clean checkout while spec 22's needs upstream fetches.
//
// It produces three things per case, and each answers a different question:
//   `repo/`             the working tree at the change's head commit, so the
//                       head-side bytes the lane reads are the bytes the diff
//                       produced rather than whatever is checked out today;
//   `repo/.codereviewer/intent-case/intent.md`
//                       the stated intent, assembled verbatim from the declared
//                       slices of the declared document at the declared commit.
//                       It lives INSIDE the work tree because spec 11's inbox
//                       provider resolves its directory under the repository root
//                       and refuses to escape it. Being untracked, it cannot enter
//                       the diff the lane reviews: `git diff base head` is computed
//                       from two commits and never from the working tree;
//   `case.json`         the case definition as hydrated, including the map from
//                       assembled-body lines back to source-document lines. The
//                       scorer joins on source lines and must never have to
//                       reproduce how the body was joined.
//
// THE PRE-WRITTEN GUARANTEE IS ASSERTED HERE, not asserted in prose. A document
// slice whose commit is not a strict ancestor of the change's base could have been
// written to describe the change, which is the defect of a corpus built from commit
// messages and the exact thing this corpus exists to avoid. Hydration throws rather
// than materialise one.

export const defaultIntentManifestPath =
  'eval/corpora/intent-fulfilment/manifest.json'

// Its own root, and deliberately not a sibling of either the spec 17 slice root or
// the change-impact case root. Three corpora answering three different questions
// under one parent directory is one mistyped flag away from scoring one with
// another's instrument.
export const defaultIntentOutputRoot =
  '.codereviewer/eval/intent-cases/intent-fulfilment'

export const intentHydrationSource = 'intent-local-history-checkout-v1'

export const INTENT_CASE_ARTIFACT_NAME = 'case.json'
export const INTENT_CASE_WORK_TREE = 'repo'
// Repository-relative, inside the work tree — see the header for why it cannot sit
// beside it. This is the exact string the run's `contextSources` inbox provider is
// pointed at, so it is declared once and imported by the runner rather than spelled
// twice.
export const INTENT_CASE_CONTEXT_DIRECTORY = '.codereviewer/intent-case'
export const INTENT_CASE_INTENT_DOCUMENT = 'intent.md'

/**
 * One assembled-intent line and the source-document line it was taken from.
 *
 * The map exists because the two numbering systems genuinely differ: slices are
 * joined with a blank line between them and each slice has its trailing whitespace
 * removed, so assembled line 57 is not source line 57. The answer key addresses
 * source lines, a reported obligation cites an assembled line, and this is the only
 * place that knows both.
 */
export type IntentLineMapEntry = {
  readonly bodyLine: number
  readonly sourceLine: number
}

export type AssembledIntent = {
  readonly body: string
  readonly lineMap: readonly IntentLineMapEntry[]
}

/**
 * Joins the declared slices of a document into the stated intent, verbatim.
 *
 * The rule is the one the corpus was originally built with and is preserved
 * exactly: each slice keeps its own lines, loses its trailing whitespace, and the
 * slices are separated by one blank line. Changing it would renumber every
 * assembled line and silently move every join.
 */
export const assembleIntentBody = (input: {
  readonly documentText: string
  readonly lineRanges: readonly (readonly [number, number])[]
}): AssembledIntent => {
  const documentLines = input.documentText.split(/\r\n|\n|\r/u)
  const bodyLines: string[] = []
  const lineMap: IntentLineMapEntry[] = []

  for (const [from, to] of input.lineRanges) {
    if (bodyLines.length > 0) {
      // The blank separator belongs to no source line, so it gets no map entry. A
      // citation landing on it cannot resolve — `resolveIntentCitation` rejects a
      // blank line — so there is nothing to lose by leaving it unmapped.
      bodyLines.push('')
    }

    const sliceStart = bodyLines.length
    const sliceLines = documentLines.slice(from - 1, to)
    const sliceText = sliceLines.join('\n').replace(/\s+$/u, '')
    const keptLines = sliceText.length === 0 ? [] : sliceText.split('\n')

    keptLines.forEach((line, offset) => {
      bodyLines.push(line)
      lineMap.push({
        bodyLine: sliceStart + offset + 1,
        sourceLine: from + offset
      })
    })
  }

  return { body: bodyLines.join('\n'), lineMap }
}

/**
 * The intent document as the inbox provider will read it: frontmatter, then the
 * assembled body.
 *
 * The frontmatter is stripped before the body is line-addressed, so it costs no
 * line numbers — `parseFrontmatter` returns the body alone and the body is then
 * trimmed. That is why `lineMap` above is indexed from the body's first line and
 * not from the file's.
 */
export const renderIntentDocument = (input: {
  readonly sourceLabel: string
  readonly id: string
  readonly title: string
  readonly body: string
}): string =>
  `---\nsource: ${input.sourceLabel}\nid: ${input.id}\ntitle: ${input.title.replace(/\n/gu, ' ')}\n---\n${input.body}\n`

export type HydratedIntentCase = {
  readonly id: string
  readonly arm: IntentCorpusCase['arm']
  readonly hydrationSource: string
  readonly baseSha: string
  readonly headSha: string
  readonly intentCommit: string
  readonly intentTitle: string
  readonly maxObligations: number
  readonly lineMap: readonly IntentLineMapEntry[]
  readonly outstandingExpectations: IntentCorpusCase['outstandingExpectations']
}

export type IntentCaseResult = {
  readonly id: string
  readonly status: 'hydrated' | 'reused'
  readonly caseDirectory: string
}

export type HydrateIntentCorpusOptions = {
  readonly repositoryRoot: string
  readonly manifestPath?: string
  readonly outputRoot?: string
  readonly caseFilters?: readonly string[]
  readonly force?: boolean
  readonly log?: (message: string) => void
  readonly runGit?: CorpusGitCommandRunner
}

export type HydrateIntentCorpusResult = {
  readonly outputRoot: string
  readonly hydratedCaseCount: number
  readonly cachedCaseCount: number
  readonly prunedCaseIds: readonly string[]
  readonly outstandingExpectationCount: number
  readonly outstandingExpectationsByArm: IntentArmCounts
  readonly cases: readonly IntentCaseResult[]
}

const readTextIfPresent = async (
  filePath: string
): Promise<string | undefined> => {
  try {
    return await readFile(filePath, 'utf8')
  } catch {
    return undefined
  }
}

// A hydrated case carries a copy of its own answer key. Editing the manifest leaves
// every existing checkout describing the previous one, and this project has already
// had to void a published recall figure that was scored against an answer key which
// had changed underneath it.
const storedCaseIsCurrent = (input: {
  readonly stored: HydratedIntentCase
  readonly corpusCase: IntentCorpusCase
  readonly lineMap: readonly IntentLineMapEntry[]
}): boolean =>
  input.stored.hydrationSource === intentHydrationSource &&
  input.stored.headSha === input.corpusCase.change.headCommit &&
  input.stored.baseSha === input.corpusCase.change.baseCommit &&
  input.stored.maxObligations === input.corpusCase.maxObligations &&
  JSON.stringify(input.stored.outstandingExpectations) ===
    JSON.stringify(input.corpusCase.outstandingExpectations) &&
  JSON.stringify(input.stored.lineMap) === JSON.stringify(input.lineMap)

/**
 * Hydrates every selected case of the intent corpus.
 *
 * Git only: no provider is resolved, no model is called, and nothing is fetched
 * over a network. A case is re-used when its checkout is at the declared head and
 * its stored answer key still matches the manifest, so re-running is cheap and
 * editing the manifest re-materialises exactly the cases that changed.
 */
export const hydrateIntentCorpus = async (
  options: HydrateIntentCorpusOptions
): Promise<HydrateIntentCorpusResult> => {
  const runGit = options.runGit ?? defaultCorpusGitRunner
  const manifestPath = options.manifestPath ?? defaultIntentManifestPath
  const outputRoot = options.outputRoot ?? defaultIntentOutputRoot
  const manifest: IntentCorpusManifest = parseIntentCorpusManifestJson(
    await readFile(
      await resolveExistingPathInsideRoot(options.repositoryRoot, manifestPath),
      'utf8'
    )
  )
  const selectedCases = selectCorpusCases(
    manifest.cases,
    options.caseFilters ?? []
  )
  const outputRootPath = await resolveWritePathInsideRoot(
    options.repositoryRoot,
    outputRoot
  )

  await mkdir(outputRootPath, { recursive: true })

  const results: IntentCaseResult[] = []
  let hydratedCaseCount = 0
  let cachedCaseCount = 0

  for (const corpusCase of selectedCases) {
    const caseDirectory = path.posix.join(outputRoot, corpusCase.id)
    const caseDirectoryPath = await resolveWritePathInsideRoot(
      options.repositoryRoot,
      caseDirectory
    )
    const documentText =
      corpusCase.intent.kind === 'document-slice'
        ? await runGit({
            args: [
              'show',
              `${corpusCase.intent.commit}:${corpusCase.intent.path}`
            ],
            cwd: options.repositoryRoot
          })
        : await runGit({
            args: ['log', '-1', '--format=%B', corpusCase.intent.commit],
            cwd: options.repositoryRoot
          })

    // THE PRE-WRITTEN ASSERTION. `merge-base --is-ancestor` exits non-zero when the
    // relation does not hold, so the throw is the git exit code surfacing rather
    // than a comparison this file invented.
    if (corpusCase.intent.kind === 'document-slice') {
      try {
        await runGit({
          args: [
            'merge-base',
            '--is-ancestor',
            corpusCase.intent.commit,
            corpusCase.change.baseCommit
          ],
          cwd: options.repositoryRoot
        })
      } catch {
        throw new Error(
          `Intent case "${corpusCase.id}": the intent document is sliced at ${corpusCase.intent.commit}, which is not an ancestor of the change's base ${corpusCase.change.baseCommit}. The intent is therefore not pre-written and the case must not be materialised.`
        )
      }
    }

    const assembled =
      corpusCase.intent.kind === 'document-slice'
        ? assembleIntentBody({
            documentText,
            lineRanges: corpusCase.intent.lineRanges
          })
        : assembleIntentBody({
            documentText: documentText.trim(),
            // A commit message has no slice: the whole body is the intent, so the
            // range is the whole body and the map is the identity.
            lineRanges: [
              [1, Math.max(1, documentText.trim().split(/\r\n|\n|\r/u).length)]
            ]
          })
    const storedPath = path.join(caseDirectoryPath, INTENT_CASE_ARTIFACT_NAME)
    const storedText = await readTextIfPresent(storedPath)
    const stored: HydratedIntentCase | undefined =
      storedText === undefined
        ? undefined
        : (JSON.parse(storedText) as HydratedIntentCase)
    const headSha = await readTextIfPresent(
      path.join(caseDirectoryPath, INTENT_CASE_WORK_TREE, '.git')
    ).then(async () =>
      runGit({
        args: ['rev-parse', '--verify', 'HEAD'],
        cwd: path.join(caseDirectoryPath, INTENT_CASE_WORK_TREE)
      }).catch(() => undefined)
    )

    if (
      options.force !== true &&
      stored !== undefined &&
      storedCaseIsCurrent({
        stored,
        corpusCase,
        lineMap: assembled.lineMap
      }) &&
      headSha?.trim() === corpusCase.change.headCommit
    ) {
      cachedCaseCount += 1
      results.push({ id: corpusCase.id, status: 'reused', caseDirectory })
      options.log?.(`Reused intent case ${corpusCase.id}.`)
      continue
    }

    await rm(caseDirectoryPath, { recursive: true, force: true })

    const workTreeDirectory = path.join(
      caseDirectoryPath,
      INTENT_CASE_WORK_TREE
    )
    const gitDirectory = path.join(caseDirectoryPath, 'git')

    await mkdir(workTreeDirectory, { recursive: true })
    await runGit({
      args: gitInitArgs({ gitDirectory, workTreeDirectory }),
      cwd: options.repositoryRoot
    })
    // `file://` rather than a bare path so the shallow fetch below is honoured:
    // git silently ignores `--depth` for a local path and would copy the whole
    // history of this repository into every case directory.
    await runGit({
      args: gitRemoteArgs(`file://${options.repositoryRoot}`),
      cwd: workTreeDirectory
    })
    await runGit({
      args: gitDisableAutoCrlfArgs(),
      cwd: workTreeDirectory
    })

    // Both endpoints, each at depth 2. The lane diffs base against head and intake
    // resolves their merge base, so a checkout holding only one of them would fail
    // at run time rather than at hydration time — which is the wrong place for a
    // corpus problem to surface.
    for (const commit of new Set([
      corpusCase.change.headCommit,
      corpusCase.change.baseCommit
    ])) {
      await runGit({
        args: gitFetchArgs({ commit }),
        cwd: workTreeDirectory
      })
    }

    await runGit({
      args: gitCheckoutArgs(corpusCase.change.headCommit),
      cwd: workTreeDirectory
    })

    // AFTER the checkout: `checkout --force` would not remove an untracked file,
    // but writing the intent before the tree exists would.
    const contextDirectory = path.join(
      workTreeDirectory,
      ...INTENT_CASE_CONTEXT_DIRECTORY.split('/')
    )

    await mkdir(contextDirectory, { recursive: true })
    await writeFile(
      path.join(contextDirectory, INTENT_CASE_INTENT_DOCUMENT),
      renderIntentDocument({
        sourceLabel:
          corpusCase.intent.kind === 'document-slice' ? 'spec' : 'git',
        id: corpusCase.intent.commit.slice(0, 7),
        title:
          corpusCase.intent.kind === 'document-slice'
            ? corpusCase.intent.title
            : (documentText.trim().split(/\r\n|\n|\r/u)[0] ?? corpusCase.id),
        body: assembled.body
      })
    )

    const hydrated: HydratedIntentCase = {
      id: corpusCase.id,
      arm: corpusCase.arm,
      hydrationSource: intentHydrationSource,
      baseSha: corpusCase.change.baseCommit,
      headSha: corpusCase.change.headCommit,
      intentCommit: corpusCase.intent.commit,
      intentTitle:
        corpusCase.intent.kind === 'document-slice'
          ? corpusCase.intent.title
          : corpusCase.id,
      maxObligations: corpusCase.maxObligations,
      lineMap: assembled.lineMap,
      outstandingExpectations: corpusCase.outstandingExpectations
    }

    await writeFile(storedPath, `${JSON.stringify(hydrated, null, 2)}\n`)

    hydratedCaseCount += 1
    results.push({ id: corpusCase.id, status: 'hydrated', caseDirectory })
    options.log?.(`Hydrated intent case ${corpusCase.id}.`)
  }

  const prunedCaseIds =
    (options.caseFilters ?? []).length > 0
      ? []
      : await pruneUnknownCaseDirectories(
          outputRootPath,
          new Set(manifest.cases.map((corpusCase) => corpusCase.id))
        )

  return {
    outputRoot,
    hydratedCaseCount,
    cachedCaseCount,
    prunedCaseIds,
    outstandingExpectationCount: selectedCases.reduce(
      (total, corpusCase) => total + corpusCase.outstandingExpectations.length,
      0
    ),
    outstandingExpectationsByArm:
      countOutstandingExpectationsByArm(selectedCases),
    cases: results
  }
}
