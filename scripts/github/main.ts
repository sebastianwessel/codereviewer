#!/usr/bin/env node
// Entry point for the GitHub pull-request review workflow.
//
// This file is the IO boundary and nothing else: it resolves the environment,
// builds the four side-effecting dependencies, and hands them to `runPipeline`.
// Every decision — fork handling, credential checks, stage classification,
// comment identity, inline-comment deduplication — lives in the modules beside
// it, where it is unit-tested.
import { spawn } from 'node:child_process'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { resolveExistingPathInsideRoot } from '../../src/platform/path-service.js'
import { createGithubApi } from './github-api.js'
import { parsePullRequestEvent } from './pull-request-context.js'
import { runPipeline } from './pipeline.js'
import type { StageResult } from './stage-outcomes.js'

const repositoryRoot = process.cwd()

const requireEnvironment = (name: string): string => {
  const value = process.env[name]

  if (value === undefined || value.trim().length === 0) {
    throw new TypeError(`${name} is required but not set.`)
  }

  return value
}

const exists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * How to invoke the CLI.
 *
 * A built `dist/` is preferred when present — it is what a published install
 * runs — and the TypeScript entry through `tsx` is the fallback, matching the
 * repository's own `npm run cli` script. Neither form goes through a shell.
 */
const resolveCliInvocation = async (): Promise<readonly string[]> => {
  const built = path.join(repositoryRoot, 'dist', 'cli', 'main.js')

  return (await exists(built))
    ? [built]
    : ['--import', 'tsx', path.join(repositoryRoot, 'src', 'cli', 'main.ts')]
}

const runCli = (
  invocation: readonly string[],
  args: readonly string[]
): Promise<StageResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...invocation, ...args], {
      cwd: repositoryRoot,
      env: process.env,
      // No shell. Every argument is passed as its own array element, so a branch
      // name or a title can never be interpreted as a command.
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      stderr += text
      // Mirrored to the job log so a failed stage is debuggable from the run
      // page without downloading artifacts.
      process.stderr.write(text)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr })
    })
  })

/**
 * Reads a run artifact, refusing any path that escapes the repository root.
 *
 * Uses the repository's own containment helper rather than a local check. The
 * previous version compared `path.relative` output only, which accepts a symlink
 * inside the artifact directory that points outside the repository — the case
 * `resolveExistingPathInsideRoot` exists to refuse, since it compares realpaths.
 * A second, weaker copy of a security guard is worth less than no copy, because it
 * reads as though the guard is in place.
 */
const readArtifact = async (
  relativePath: string
): Promise<string | undefined> => {
  try {
    const resolved = await resolveExistingPathInsideRoot(
      repositoryRoot,
      relativePath
    )

    return await readFile(resolved, 'utf8')
  } catch {
    return undefined
  }
}

const parsePositiveInteger = (
  value: string | undefined,
  fallback: number
): number => {
  if (value === undefined) {
    return fallback
  }

  const parsed = Number(value)

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

const main = async (): Promise<void> => {
  const eventPath = requireEnvironment('GITHUB_EVENT_PATH')
  const context = parsePullRequestEvent({
    eventPayload: await readFile(eventPath, 'utf8'),
    repository: requireEnvironment('GITHUB_REPOSITORY')
  })
  const token = process.env.GITHUB_TOKEN ?? ''
  const contextDirectory =
    process.env.CODEREVIEWER_CONTEXT_DIR ?? '.codereviewer/context'
  const serverUrl = process.env.GITHUB_SERVER_URL ?? 'https://github.com'
  const runId = process.env.GITHUB_RUN_ID
  const invocation = await resolveCliInvocation()

  const result = await runPipeline({
    context,
    environment: process.env,
    options: {
      markerKey: process.env.CODEREVIEWER_COMMENT_KEY ?? 'default',
      ...(process.env.CODEREVIEWER_GITHUB_CONFIG === undefined
        ? {}
        : { configPath: process.env.CODEREVIEWER_GITHUB_CONFIG }),
      maxInlineComments: parsePositiveInteger(
        process.env.CODEREVIEWER_MAX_INLINE_COMMENTS,
        25
      ),
      ...(runId === undefined
        ? {}
        : {
            runUrl: `${serverUrl}/${context.owner}/${context.repo}/actions/runs/${runId}`
          }),
      commentAuthorLogin:
        process.env.CODEREVIEWER_COMMENT_AUTHOR ?? 'github-actions[bot]'
    },
    runStage: (args) => runCli(invocation, args),
    readArtifact,
    writeChangeIntent: async (fileName, content) => {
      const directory = path.resolve(repositoryRoot, contextDirectory)
      await mkdir(directory, { recursive: true })
      await writeFile(path.join(directory, fileName), content, 'utf8')
    },
    // No token, or a fork pull request, means nothing can be written back. The
    // pipeline still produces the body; it lands in the job summary only.
    ...(token.length === 0 || context.fromFork
      ? {}
      : {
          api: createGithubApi({
            token,
            owner: context.owner,
            repo: context.repo,
            ...(process.env.GITHUB_API_URL === undefined
              ? {}
              : { baseUrl: process.env.GITHUB_API_URL })
          })
        }),
    log: (message) => {
      process.stdout.write(`${message}\n`)
    }
  })

  const summaryPath = process.env.GITHUB_STEP_SUMMARY

  if (summaryPath !== undefined && summaryPath.length > 0) {
    await writeFile(summaryPath, `${result.commentBody}\n`, {
      encoding: 'utf8',
      flag: 'a'
    })
  }

  if (!result.posted) {
    process.stdout.write(
      'No comment was posted: this run cannot write to the pull request.\n'
    )
  }

  process.exitCode = result.exitCode
}

try {
  await main()
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  )
  process.exitCode = 2
}
