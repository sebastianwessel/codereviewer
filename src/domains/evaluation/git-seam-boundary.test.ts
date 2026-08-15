// Structural enforcement of spec 01's *Known Divergence: The Evaluation
// Harness's Git Seam*.
//
// The Ownership Rules give git to `repository-intake` and grant `evaluation`
// none. Two seams are accepted as exceptions, each for a stated reason:
// `report/engine-identity.ts` reads the ENGINE's own checkout, and
// `corpus/git-corpus-plumbing.ts` checks out UPSTREAM corpus repositories.
// Neither repository is the subject of a review, which is why routing them
// through `repository-intake` would widen that domain rather than tidy this one.
//
// WHY THIS IS A TEST AND NOT A PARAGRAPH. The paragraph said "two" while FOUR
// modules held a `child_process` import: each of the three corpus hydrators had
// grown its own copy of the git runner, and the divergence record silently
// understated itself as the copies multiplied. A divergence allowed to spread is
// not the divergence that was accepted, and prose cannot notice spreading.
//
// The invariant is therefore not the NUMBER but ONE MODULE PER REASON. A third
// `child_process` import inside this domain is a change to an architectural
// decision and needs one — this test is where that conversation starts, rather
// than a footnote nobody re-reads.

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const domainDirectory = path.dirname(fileURLToPath(import.meta.url))

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

// Same expression the domain import-boundary tests use, so a banned dependency
// cannot hide behind a dynamic `import()` either.
const moduleSpecifiersIn = (source: string): readonly string[] =>
  [...source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/gu)].map(
    (match) => match[1] ?? ''
  )

// The accepted seams, by repository-relative path, each with the reason spec 01
// records. Adding an entry here is the deliberate act; it should be as visible
// in review as the import itself.
const acceptedGitSeams = new Map([
  [
    'evaluation/report/engine-identity.ts',
    "stamps the ENGINE's own commit and working-tree cleanliness onto eval reports"
  ],
  [
    'evaluation/corpus/git-corpus-plumbing.ts',
    'checks out UPSTREAM corpus repositories for all three git-backed corpora'
  ]
])

const processModules = new Set(['node:child_process', 'child_process'])

describe('evaluation git seam', () => {
  test('has production sources to check', async () => {
    // ANTI-VACUITY: every assertion below passes trivially against an empty file
    // list, which is exactly how a check survives its directory being renamed.
    const files = (await collectTypeScriptFiles(domainDirectory)).filter(
      (file) => !file.endsWith('.test.ts')
    )

    expect(files.length).toBeGreaterThan(30)
  })

  test('shells out to git from the accepted seams and nowhere else', async () => {
    const files = (await collectTypeScriptFiles(domainDirectory)).filter(
      (file) => !file.endsWith('.test.ts')
    )
    const shellingOut = (
      await Promise.all(
        files.map(async (file) => {
          const source = await readFile(file, 'utf8')
          const usesProcess = moduleSpecifiersIn(source).some((specifier) =>
            processModules.has(specifier)
          )
          const relative = path
            .relative(path.dirname(domainDirectory), file)
            .split(path.sep)
            .join('/')

          return usesProcess ? [relative] : []
        })
      )
    ).flat()

    expect([...shellingOut].sort()).toEqual([...acceptedGitSeams.keys()].sort())
  })

  test('each accepted seam still exists, so the list cannot rot into a permit for nothing', async () => {
    // The mirror of the assertion above. That one catches a NEW seam; this one
    // catches an entry that outlived the file it names, which would otherwise sit
    // here looking like an active exemption.
    const files = new Set(
      (await collectTypeScriptFiles(domainDirectory)).map((file) =>
        path
          .relative(path.dirname(domainDirectory), file)
          .split(path.sep)
          .join('/')
      )
    )

    for (const seam of acceptedGitSeams.keys()) {
      expect(files.has(seam)).toBe(true)
    }
  })
})
