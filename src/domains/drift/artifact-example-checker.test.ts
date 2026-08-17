import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import {
  artifactContracts,
  artifactContractTags,
  artifactScanRoots,
  checkArtifactExamples,
  checkArtifactExamplesInFile,
  findArtifactExampleProblems
} from './artifact-example-checker.js'
import { extractJsonBlocks } from './config-example-checker.js'
import { renderDocumentIssues } from './document-issue.js'
import { collectTextFiles } from './markdown-sources.js'

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..'
)

const markdown = (
  filePath: string,
  lines: readonly string[]
): { path: string; content: string } => ({
  path: filePath,
  content: lines.join('\n')
})

describe('documented artifact examples', () => {
  // THE GATE. Every JSON artifact example printed in `README.md`, `docs/`,
  // `skills/` or `specs/` shows a shape its producer can actually emit, and
  // every `json` block in those roots is accounted for by one of the two
  // checkers rather than by nobody.
  test('every artifact example in the scanned roots matches the contract it declares', async () => {
    const result = await checkArtifactExamples({ repositoryRoot })

    expect(renderDocumentIssues(result.issues)).toBe('')
    expect(result.issues).toEqual([])
  })

  // THE DEFECT THIS EXISTS FOR, reproduced from the page it shipped on.
  // `docs/02-getting-started/install-and-run.md` printed this `impact check`
  // output for a week after 434473a reshaped the contract, while the GitHub
  // digest downstream of the same contract rendered an empty section. Nothing
  // looked at the block; this is what looking at it says. The literals have
  // since been reset to `"1.0"` repository-wide (spec 06, 2026-08-14), so the
  // stale value here is now stale against `"1.0"` — the drift is the point,
  // not the particular numbers.
  test('the stale impact-report example this check was built for is reported', () => {
    const result = checkArtifactExamplesInFile(
      markdown('docs/02-getting-started/install-and-run.md', [
        '```json impact-report',
        '{',
        '  "schemaVersion": "1.1",',
        '  "status": "disabled",',
        '  "warnings": ["Change-impact review is disabled."]',
        '}',
        '```'
      ])
    )

    expect(result.checkedExampleCount).toBe(1)
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]?.kind).toBe('stale-schema-version')
    expect(result.issues[0]?.line).toBe(1)
    expect(result.issues[0]?.message).toContain('"1.0"')
  })

  // ANTI-VACUITY, guard 1. Every assertion above is satisfied by an extractor
  // that finds nothing. So the block count is re-derived by a second,
  // deliberately dumber method — a plain line scan for the opening fence — and
  // the two must agree.
  test('the checker sees exactly as many json blocks as a plain line scan finds', async () => {
    const files = (
      await Promise.all(
        artifactScanRoots.map((root) => collectTextFiles(repositoryRoot, root))
      )
    )
      .flat()
      .filter((file) => file.path.endsWith('.md'))

    expect(files.length).toBeGreaterThan(0)

    const independentCount = files.reduce(
      (total, file) =>
        total +
        file.content
          .split('\n')
          .filter((line) => /^\s*`{3,}json(\s|$)/u.test(line)).length,
      0
    )
    const result = await checkArtifactExamples({ repositoryRoot })

    expect(independentCount).toBeGreaterThan(0)
    expect(result.jsonBlockCount).toBe(independentCount)
  })

  // ANTI-VACUITY, guard 2. The exhaustiveness rule is only worth having if the
  // four buckets partition the blocks: a block that fell out of the walk
  // entirely would leave the sum short while every other assertion stayed green.
  test('every json block lands in exactly one bucket, and the buckets sum to the blocks', async () => {
    const result = await checkArtifactExamples({ repositoryRoot })

    expect(
      result.checkedExampleCount +
        result.exemptedBlockCount +
        result.configBlockCount +
        result.issues.length
    ).toBe(result.jsonBlockCount)
  })

  // ANTI-VACUITY, guard 3. A floor on the examples actually walked, so a
  // registry lookup that silently stopped resolving — or a tag renamed on one
  // side only — fails here rather than reporting a clean sweep of nothing. The
  // floor sits under the real count so ordinary editing does not trip it.
  test('the docs really do carry artifact examples, in the numbers they contain', async () => {
    const result = await checkArtifactExamples({ repositoryRoot })

    expect(result.checkedExampleCount).toBeGreaterThanOrEqual(20)
    // NOTHING in this repository is exempt any more. The nine exemptions this
    // floor used to guard were all the same gap — the CLI's own stdout, stderr
    // and `error.json` envelopes were inline object literals with no exported
    // contract to check them against — and they were closed by giving those
    // envelopes contracts, not by loosening the check.
    //
    // An exact zero rather than a floor, because the next exemption should be
    // an argued decision: adding one means editing this line and saying in the
    // commit why no contract can describe the block. That is the bar the escape
    // hatch was always meant to have.
    expect(result.exemptedBlockCount).toBe(0)
  })

  // ANTI-VACUITY, guard 4. The walk must reach INSIDE the examples this
  // repository ships, not just their top level. Every checked example gains one
  // key the contract cannot have, at the deepest object in it, and every one of
  // them must be reported. This is what catches an unwrap that quietly returns a
  // node the walk treats as a leaf.
  test('a foreign key added at the deepest point of each shipped example is caught', async () => {
    const examples = (
      await Promise.all(
        artifactScanRoots.map((root) => collectTextFiles(repositoryRoot, root))
      )
    )
      .flat()
      .filter((file) => file.path.endsWith('.md'))
      .flatMap((file) => extractJsonBlocks(file))
      .filter((block) => artifactContractTags.includes(block.marker))

    expect(examples.length).toBeGreaterThanOrEqual(8)

    for (const example of examples) {
      const value = JSON.parse(example.body) as unknown
      const deepest = deepestObjectPath(value)
      const mutated = withKeyAt(value, deepest, 'thisKeyCannotExist')
      const problems = findArtifactExampleProblems(mutated, example.marker)

      expect({
        at: `${example.path}:${example.line}`,
        depth: deepest.length,
        kinds: problems.map((problem) => problem.kind)
      }).toEqual({
        at: `${example.path}:${example.line}`,
        depth: deepest.length,
        kinds: ['unknown-key']
      })
    }
  })
})

// The deepest nested plain object in a value, as a key path. Used to plant a
// foreign key where only a walk that descends the whole way can find it.
const deepestObjectPath = (value: unknown): readonly string[] => {
  const isObject = (candidate: unknown): candidate is Record<string, unknown> =>
    typeof candidate === 'object' &&
    candidate !== null &&
    !Array.isArray(candidate)
  const walk = (
    node: unknown,
    at: readonly string[]
  ): readonly (readonly string[])[] =>
    typeof node !== 'object' || node === null
      ? []
      : Object.entries(node).flatMap(([key, entry]) => [
          ...(isObject(entry) ? [[...at, key]] : []),
          ...walk(entry, [...at, key])
        ])
  const paths = [...walk(value, [])].sort((left, right) => right.length - left.length)

  return paths[0] ?? []
}

const withKeyAt = (
  value: unknown,
  at: readonly string[],
  key: string
): unknown => {
  const clone = structuredClone(value) as Record<string, unknown>
  let node: Record<string, unknown> = clone

  for (const step of at) {
    node = node[step] as Record<string, unknown>
  }

  node[key] = 1

  return clone
}

describe('the contract registry', () => {
  // Each tag must resolve to a schema the walk can actually descend. A tag
  // pointing at a schema whose internals this module cannot read would report a
  // clean result for every example under it.
  test('every registered tag resolves to a schema the walk recognises', () => {
    for (const tag of artifactContractTags) {
      const problems = findArtifactExampleProblems(
        { thisKeyCannotExist: 1 },
        tag
      )

      // `baseline` is a list, so an object is a shape mismatch rather than an
      // unknown key — either answer proves the walk reached the contract.
      expect({ tag, kinds: problems.map((problem) => problem.kind) }).toEqual({
        tag,
        kinds: [tag === 'baseline' ? 'shape-mismatch' : 'unknown-key']
      })
    }
  })

  test('an unregistered tag is reported rather than treated as unchecked', () => {
    const result = checkArtifactExamplesInFile(
      markdown('docs/example.md', ['```json review-summary', '{}', '```'])
    )

    // NOT counted as a checked example. `checkedExampleCount` is the blocks
    // walked against a contract, and this one reached no contract to be walked
    // against; it was counted on entry to the walk until 2026-08-17, which said
    // a block nothing could check had been checked.
    expect(result.checkedExampleCount).toBe(0)
    expect(result.issues[0]?.kind).toBe('unknown-contract')
    expect(result.issues[0]?.message).toContain('review-report')
  })

  test('every contract names the producer a reader would open', () => {
    for (const tag of artifactContractTags) {
      expect(artifactContracts[tag]?.producedBy.length ?? 0).toBeGreaterThan(5)
    }
  })
})

describe('what an example is held to', () => {
  test('an excerpt is validated as far as it goes and never reported for what it omits', () => {
    const result = checkArtifactExamplesInFile(
      markdown('docs/example.md', [
        '```json impact-report',
        '{ "summary": { "impactFindingCount": 1 } }',
        '```'
      ])
    )

    expect(result.checkedExampleCount).toBe(1)
    expect(result.issues).toEqual([])
  })

  // The elisions a real page is full of. Holding a `"…"` to `z.iso.datetime()`
  // would fail nearly every honest excerpt, which is how a check becomes a
  // thing people switch off.
  test('an elided leaf value is left alone, because an excerpt is not a parse', () => {
    const result = checkArtifactExamplesInFile(
      markdown('docs/example.md', [
        '```json run-index',
        '{ "runs": [{ "runId": "…", "startedAt": "…", "status": "failed" }] }',
        '```'
      ])
    )

    expect(result.issues).toEqual([])
  })

  test('a key the contract cannot emit is reported, naming the path and the keys it has', () => {
    const result = checkArtifactExamplesInFile(
      markdown('docs/example.md', [
        '```json impact-report',
        '{ "summary": { "impactedSymbolCount": 1 } }',
        '```'
      ])
    )

    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]?.kind).toBe('unknown-key')
    expect(result.issues[0]?.message).toContain('summary.impactedSymbolCount')
    expect(result.issues[0]?.message).toContain('impactFindingCount')
  })

  test('a value outside a closed enum is reported', () => {
    const result = checkArtifactExamplesInFile(
      markdown('docs/example.md', [
        '```json impact-report',
        '{ "status": "skipped" }',
        '```'
      ])
    )

    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]?.kind).toBe('unknown-enum-value')
    expect(result.issues[0]?.message).toContain('completed')
  })

  // A discriminated union must be judged against the branch the value CLAIMS,
  // not against whichever branch complains least — otherwise a key belonging to
  // a sibling branch passes.
  test('a union member is judged against the branch its discriminator selects', () => {
    const evidenced = checkArtifactExamplesInFile(
      markdown('docs/example.md', [
        '```json intent-report',
        '{ "obligations": [{ "status": "evidenced", "evidence": [] }] }',
        '```'
      ])
    )
    const notEvidenced = checkArtifactExamplesInFile(
      markdown('docs/example.md', [
        '```json intent-report',
        '{ "obligations": [{ "status": "not-evidenced", "evidence": [] }] }',
        '```'
      ])
    )

    expect(evidenced.issues).toEqual([])
    expect(notEvidenced.issues).toHaveLength(1)
    expect(notEvidenced.issues[0]?.message).toContain('obligations.0.evidence')
  })

  test('an object where the contract has a list is reported rather than descended into', () => {
    const result = checkArtifactExamplesInFile(
      markdown('docs/example.md', [
        '```json impact-report',
        '{ "impactFindings": { "path": "src/a.ts" } }',
        '```'
      ])
    )

    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]?.kind).toBe('shape-mismatch')
  })

  // An artifact tag is a claim that a reader can paste the block into a parser.
  // An unmarked block may elide syntax; a block that says what it is may not.
  test('a block that declares a contract gets no benefit of the doubt when it does not parse', () => {
    const result = checkArtifactExamplesInFile(
      markdown('docs/example.md', [
        '```json impact-report',
        '{ "impactFindings": [ … ] }',
        '```'
      ])
    )

    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]?.kind).toBe('unparseable')
  })
})

describe('accounting for every block', () => {
  test('an untagged block that is not configuration is reported, not passed over', () => {
    const result = checkArtifactExamplesInFile(
      markdown('docs/example.md', [
        '```json',
        '{ "runId": "abc", "qualityGatePassed": true }',
        '```'
      ])
    )

    expect(result.jsonBlockCount).toBe(1)
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]?.kind).toBe('undeclared')
  })

  // The two checkers share one fence slot and must not both claim a block. A
  // configuration example is classified by content by the sibling checker, so
  // this one leaves it alone and counts it.
  test('a configuration example is left to the configuration checker', () => {
    const result = checkArtifactExamplesInFile(
      markdown('docs/example.md', [
        '```json',
        '{ "review": { "maxCostUsd": 5 } }',
        '```',
        '```json config',
        '{}',
        '```'
      ])
    )

    expect(result.configBlockCount).toBe(2)
    expect(result.issues).toEqual([])
  })

  test('an exemption is accounted for when it says why', () => {
    const result = checkArtifactExamplesInFile(
      markdown('docs/example.md', [
        '```json no-contract a third-party webhook payload this repository never produces',
        '{ "action": "opened" }',
        '```'
      ])
    )

    expect(result.exemptedBlockCount).toBe(1)
    expect(result.issues).toEqual([])
  })

  // The escape hatch must cost more than a skip list would, or it becomes one.
  test('an exemption without a reason is reported', () => {
    const result = checkArtifactExamplesInFile(
      markdown('docs/example.md', ['```json no-contract n/a', '{}', '```'])
    )

    expect(result.exemptedBlockCount).toBe(0)
    expect(result.issues[0]?.kind).toBe('unexplained-exemption')
  })

  // `checkedExampleCount` says "declared a contract and was walked against it",
  // and the buckets are asserted above to partition the blocks. Counting a block
  // on entry broke both at once: an unparseable block and one naming no contract
  // were reported AND counted as walked, so they sat in two buckets each.
  test('a block that reached no contract is reported without being counted as walked', () => {
    const result = checkArtifactExamplesInFile(
      markdown('docs/example.md', [
        '```json impact-report',
        '{ "impactFindings": [ … ] }',
        '```',
        '```json review-summary',
        '{}',
        '```',
        '```json impact-report',
        '{ "summary": { "impactFindingCount": 1 } }',
        '```'
      ])
    )

    expect(result.issues.map((issue) => issue.kind)).toEqual([
      'unparseable',
      'unknown-contract'
    ])
    expect(result.checkedExampleCount).toBe(1)
    expect(
      result.checkedExampleCount +
        result.exemptedBlockCount +
        result.configBlockCount +
        result.issues.length
    ).toBe(result.jsonBlockCount)
  })

  test('a root with no markdown at all reports nothing, because there was nothing to extract', async () => {
    const result = await checkArtifactExamples({
      repositoryRoot,
      roots: ['no-such-directory']
    })

    expect(result).toEqual({
      jsonBlockCount: 0,
      checkedExampleCount: 0,
      exemptedBlockCount: 0,
      configBlockCount: 0,
      issues: []
    })
  })
})

describe('what the walk hands back', () => {
  // A VALUE HAS NO FILE AND NO LINE. The walk reports the path INSIDE the
  // example, which is the only location it knows.
  //
  // It used to return `ArtifactExampleIssue`s with `path` set to the contract tag
  // and `line` set to 1 — two fields whose schema says "repository-relative,
  // POSIX-separated" and "the block's OPENING fence" — while dropping the
  // structural path it had just computed, which survived only inside the prose
  // message. `checkBlock` overwrote both fields immediately, so the lie was
  // invisible there and shipped to every other caller.
  test('a problem is located by its path inside the example, not by a file and a line', () => {
    expect(
      findArtifactExampleProblems(
        { summary: { impactedSymbolCount: 1 } },
        'impact-report'
      )
    ).toEqual([
      {
        kind: 'unknown-key',
        path: ['summary', 'impactedSymbolCount'],
        message: expect.stringContaining('summary.impactedSymbolCount') as string
      }
    ])
  })

  test('an unknown contract tag is a problem at the root of the example', () => {
    expect(findArtifactExampleProblems({}, 'review-summary')).toEqual([
      {
        kind: 'unknown-contract',
        path: [],
        message: 'No contract named review-summary'
      }
    ])
  })

  // The file and the fence line come from the block, and `checkBlock` is the one
  // thing that holds one — which is why it is the only constructor of an issue.
  test('the file and the fence line are the block’s, on every issue', () => {
    const result = checkArtifactExamplesInFile(
      markdown('docs/06-reference/example.md', [
        '# Heading',
        '',
        '```json impact-report',
        '{ "summary": { "impactedSymbolCount": 1 } }',
        '```'
      ])
    )

    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]?.path).toBe('docs/06-reference/example.md')
    expect(result.issues[0]?.line).toBe(3)
  })
})

describe('the checked corpus', () => {
  // The convention this check relies on, asserted where a reader of the code
  // will see it: the documentation says what the checker does, so the two cannot
  // drift into disagreeing about how a block declares itself.
  test('the contributing guide documents the declaration mechanism', async () => {
    const guide = await readFile(
      path.join(
        repositoryRoot,
        'docs',
        '09-contributing',
        'running-tests-and-checks.md'
      ),
      'utf8'
    )

    expect(guide).toContain('artifact-example-checker')
    expect(guide).toContain('no-contract')
    expect(guide).toContain('impact-report')
  })

  // The guide prints the tag list. A tag added to the registry and not to the
  // page leaves an author guessing at a vocabulary CI enforces.
  test('the guide lists every registered tag', async () => {
    const guide = await readFile(
      path.join(
        repositoryRoot,
        'docs',
        '09-contributing',
        'running-tests-and-checks.md'
      ),
      'utf8'
    )

    expect(
      artifactContractTags.filter((tag) => !guide.includes(`\`${tag}\``))
    ).toEqual([])
  })
})
