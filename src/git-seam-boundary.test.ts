// Structural enforcement of who is allowed to shell out, across ALL of `src/`.
//
// The Ownership Rules give "Git refs" to `repository-intake`. Three other
// modules nevertheless spawn a process, each for a stated reason, and this test
// is the complete list. Spec 01's *Known Divergence: The Evaluation Harness's
// Git Seam* records them in prose.
//
// WHY THIS IS A TEST, AND WHY IT IS REPO-WIDE.
//
// The prose said "two evaluation modules" while FOUR files held a
// `child_process` import: each corpus hydrator had grown its own copy of the git
// runner, and the divergence record silently understated itself as the copies
// multiplied. A divergence allowed to spread is not the divergence that was
// accepted, and a paragraph cannot notice spreading.
//
// The first version of this test was scoped to `domains/evaluation/`, which
// reproduced the same mistake one level up: it enforced the evaluation seams and
// was structurally blind to `reporting/review-comment-platform.ts`, a third git
// call nobody had recorded. A guard that only looks where the last problem was
// found will keep finding only that problem. So the scope is `src/`.
//
// The invariant is not the COUNT but ONE MODULE PER REASON. A new entry here is
// a change to an architectural decision and should be as visible in review as
// the import it permits.

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const sourceRoot = path.dirname(fileURLToPath(import.meta.url))

const collectTypeScriptFiles = async (
  directory: string
): Promise<readonly string[]> => {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name)

      if (entry.isDirectory()) {
        return collectTypeScriptFiles(entryPath)
      }

      return entry.isFile() && entry.name.endsWith('.ts') ? [entryPath] : []
    })
  )

  return files.flat()
}

// The same expression the domain import-boundary tests use, so a spawn cannot
// hide behind a dynamic `import()` either.
const moduleSpecifiersIn = (source: string): readonly string[] =>
  [...source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/gu)].map(
    (match) => match[1] ?? ''
  )

// Every module permitted to spawn a process, with the reason it is permitted.
// The reason is the point: two entries that share one are a duplication to
// consolidate, not two exceptions to accept.
const acceptedProcessSeams = new Map([
  [
    'domains/repository-intake/intake-service.ts',
    'THE OWNER: reads the repository under review at a run\'s refs, behind the read-only argument allowlist in git-command-safety.ts'
  ],
  [
    'domains/evaluation/report/engine-identity.ts',
    "reads the ENGINE's own checkout to stamp its commit and working-tree cleanliness onto eval reports"
  ],
  [
    'domains/evaluation/corpus/git-corpus-plumbing.ts',
    'checks out UPSTREAM corpus repositories for all three git-backed corpora'
  ],
  [
    'domains/reporting/review-comment-platform.ts',
    'reads `remote.origin.url` with a constant argument array to pick the comment platform; no ref and no interpolation reach git'
  ]
])

const processModules = new Set(['node:child_process', 'child_process'])

describe('process seams', () => {
  test('has production sources to check', async () => {
    // ANTI-VACUITY: every assertion below passes trivially against an empty file
    // list, which is how a check survives its directory being renamed.
    const files = (await collectTypeScriptFiles(sourceRoot)).filter(
      (file) => !file.endsWith('.test.ts')
    )

    expect(files.length).toBeGreaterThan(300)
  })

  test('spawn a process from the accepted seams and nowhere else', async () => {
    const files = (await collectTypeScriptFiles(sourceRoot)).filter(
      (file) => !file.endsWith('.test.ts')
    )
    const spawning = (
      await Promise.all(
        files.map(async (file) => {
          const source = await readFile(file, 'utf8')
          const spawns = moduleSpecifiersIn(source).some((specifier) =>
            processModules.has(specifier)
          )

          return spawns
            ? [path.relative(sourceRoot, file).split(path.sep).join('/')]
            : []
        })
      )
    ).flat()

    expect(spawning.sort()).toEqual([...acceptedProcessSeams.keys()].sort())
  })

  test('every accepted seam still exists, so the list cannot rot into a permit for nothing', async () => {
    // The mirror of the assertion above. That one catches a NEW seam; this one
    // catches an entry that outlived the file it names, which would otherwise sit
    // here looking like an active exemption for code that is gone.
    const files = new Set(
      (await collectTypeScriptFiles(sourceRoot)).map((file) =>
        path.relative(sourceRoot, file).split(path.sep).join('/')
      )
    )

    for (const seam of acceptedProcessSeams.keys()) {
      expect(files.has(seam)).toBe(true)
    }
  })
})
