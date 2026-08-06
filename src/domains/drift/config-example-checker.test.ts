import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { CodeReviewerConfigSchema } from '../../shared/contracts/index.js'
import {
  checkConfigDocumentFile,
  checkConfigExamples,
  checkConfigExamplesInFile,
  configScanRoots,
  extractJsonBlocks,
  renderConfigExampleIssues
} from './config-example-checker.js'
import { collectTextFiles } from './markdown-sources.js'

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..'
)

const markdown = (path: string, lines: readonly string[]): { path: string; content: string } => ({
  path,
  content: lines.join('\n')
})

describe('documented configuration examples', () => {
  // THE GATE. Every JSON configuration example printed in `docs/` or `skills/`
  // must be one a reader can paste into `.codereviewer/config.json` without
  // `config validate` exiting 2. This failed before the fix that introduced it:
  // `skills/codereviewer-setup/references/tuning-decisions.md` documented
  // `instructions.files` as an array of path strings, three days after the schema
  // moved to `{ path, scope }`.
  test('every configuration example and document in the scanned roots validates against the real schema', async () => {
    const result = await checkConfigExamples({ repositoryRoot })

    expect(renderConfigExampleIssues(result.issues)).toBe('')
    expect(result.issues).toEqual([])
  })

  // README.md IS THE FIRST CONFIGURATION A NEW USER PASTES, and it ships in the
  // npm tarball. It sat outside the scanned roots while every other page was
  // inside them.
  test('the README example is scanned, not just the pages further in', async () => {
    // The default roots, not a root this test supplies: the defect was that the
    // README was outside the scan, and a test that passes its own root would
    // reproduce that defect rather than catch it.
    expect(configScanRoots).toContain('README.md')

    const result = await checkConfigExamples({
      repositoryRoot,
      roots: ['README.md']
    })

    expect(result.configExampleCount).toBeGreaterThanOrEqual(1)
    expect(result.issues).toEqual([])
  })

  // ANTI-VACUITY, guard 1. The assertion above is satisfied by an extractor that
  // finds nothing, which is exactly the "absence produces a confident pass" shape
  // this repository keeps finding. So the block count is re-derived by a second,
  // deliberately dumber method — a plain line scan for the opening fence — and the
  // two must agree. A regex or state-machine change that quietly stops matching
  // fails here rather than turning the gate green.
  test('the extractor sees exactly as many json blocks as a plain line scan finds', async () => {
    const files = (
      await Promise.all(
        configScanRoots.map((root) => collectTextFiles(repositoryRoot, root))
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
    const result = await checkConfigExamples({ repositoryRoot })

    expect(independentCount).toBeGreaterThan(0)
    expect(result.jsonBlockCount).toBe(independentCount)
  })

  // ANTI-VACUITY, guard 2. Both roots really do carry configuration examples, so a
  // floor on each one catches an extractor that degrades without disappearing —
  // for example one that only matches unindented fences, or only the first block
  // in a file. The floors sit well under the real counts so ordinary editing does
  // not trip them; they are a tripwire, not a census.
  test('both scanned roots yield configuration examples, in the numbers they actually contain', async () => {
    const [docs, skills] = await Promise.all([
      checkConfigExamples({ repositoryRoot, roots: ['docs'] }),
      checkConfigExamples({ repositoryRoot, roots: ['skills'] })
    ])

    expect(docs.configExampleCount).toBeGreaterThanOrEqual(30)
    expect(skills.configExampleCount).toBeGreaterThanOrEqual(10)
  })

  // ANTI-VACUITY, guard 3. Finding nothing is itself reported, so a caller can
  // never read an empty issue list as "the examples are fine" when the truth is
  // "no example was seen".
  test('a root that holds markdown but no configuration example is reported, not passed', async () => {
    const result = await checkConfigExamples({
      repositoryRoot,
      // `reports/` is Markdown with no configuration example in it — the same
      // input shape a broken extractor produces on `docs/`.
      roots: ['reports']
    })

    expect(result.configExampleCount).toBe(0)
    expect(result.issues).toEqual([
      expect.objectContaining({ kind: 'no-examples-found', path: 'reports' })
    ])
  })

  test('a root with no markdown at all reports nothing, because there was nothing to extract', async () => {
    const result = await checkConfigExamples({
      repositoryRoot,
      roots: ['no-such-directory']
    })

    expect(result).toEqual({
      jsonBlockCount: 0,
      configExampleCount: 0,
      configDocumentCount: 0,
      issues: []
    })
  })
})

// THIS REPOSITORY'S OWN CONFIGURATION FILE.
//
// `scripts/github/codereviewer.github.json` is a full configuration document: the
// workflow points `CODEREVIEWER_GITHUB_CONFIG` at it and `scripts/github/main.ts`
// loads it. Nothing parsed it in any test — the only grep hit passed the path
// around as an option string. Five configuration keys were deleted against a
// strict schema with no shims in the two days before this test was written, which
// is exactly the change that breaks this file, and the first report of it would
// have been a pull request whose review stage exited 2.
describe('checked-in configuration documents', () => {
  const githubConfigPath = path.join(
    repositoryRoot,
    'scripts',
    'github',
    'codereviewer.github.json'
  )

  test('the GitHub integration config this repository runs is accepted by the real schema', async () => {
    const raw = await readFile(githubConfigPath, 'utf8')
    const result = CodeReviewerConfigSchema.safeParse(JSON.parse(raw) as unknown)

    expect(
      result.success
        ? ''
        : result.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; ')
    ).toBe('')
  })

  // ANTI-VACUITY. The assertion above names one file; the generalised scan is what
  // covers the next one. It is pinned to the root that holds it so a walk that
  // stops seeing `*.json` files fails here rather than reporting a clean sweep of
  // nothing.
  test('the generalised scan classifies that file, and finds it by walking rather than by name', async () => {
    const scripts = await checkConfigExamples({
      repositoryRoot,
      roots: ['scripts']
    })
    const everywhere = await checkConfigExamples({ repositoryRoot })

    expect(scripts.configDocumentCount).toBe(1)
    expect(scripts.issues).toEqual([])
    expect(everywhere.configDocumentCount).toBeGreaterThanOrEqual(1)
  })

  test('a checked-in configuration file the schema rejects is reported at the file', () => {
    const result = checkConfigDocumentFile({
      path: 'scripts/github/codereviewer.github.json',
      content: JSON.stringify({ review: { depth: 'exhaustive' } })
    })

    expect(result.isConfigDocument).toBe(true)
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]?.kind).toBe('schema-rejected')
    expect(result.issues[0]?.message).toContain('review.depth')
  })

  // A whole file is not an illustration. An unmarked fenced block that does not
  // parse is left alone because prose elides; a checked-in `.json` that does not
  // parse is broken whatever it was meant to be, and staying silent would let a
  // corrupted configuration file drop out of the checked set unnoticed.
  test('a checked-in json file that does not parse is reported, not skipped', () => {
    const result = checkConfigDocumentFile({
      path: 'scripts/github/codereviewer.github.json',
      content: '{ "review": { "depth": "balanced", }'
    })

    expect(result.isConfigDocument).toBe(false)
    expect(result.issues[0]?.kind).toBe('unparseable')
  })

  test('a json file carrying no configuration key is not a configuration document', () => {
    const result = checkConfigDocumentFile({
      path: 'scripts/github/tsconfig.json',
      content: JSON.stringify({ compilerOptions: { strict: true } })
    })

    expect(result.isConfigDocument).toBe(false)
    expect(result.issues).toEqual([])
  })
})

describe('configuration example classification', () => {
  test('reports the file, the line and the schema objection for a broken example', () => {
    const result = checkConfigExamplesInFile(
      markdown('docs/example.md', [
        '# Instructions',
        '',
        'Add a file:',
        '',
        '```json',
        '{',
        '  "instructions": {',
        '    "files": [".codereviewer/instructions/house-rules.md"]',
        '  }',
        '}',
        '```'
      ])
    )

    expect(result.configExampleCount).toBe(1)
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]?.kind).toBe('schema-rejected')
    expect(result.issues[0]?.path).toBe('docs/example.md')
    expect(result.issues[0]?.line).toBe(5)
    expect(result.issues[0]?.message).toContain('instructions.files.0')
  })

  test('the same example passes once corrected to the shape the schema accepts', () => {
    const result = checkConfigExamplesInFile(
      markdown('docs/example.md', [
        '```json',
        '{',
        '  "instructions": {',
        '    "files": [',
        '      { "path": ".codereviewer/instructions/house-rules.md" },',
        '      {',
        '        "path": ".codereviewer/instructions/payments.md",',
        '        "scope": ["services/payments/**"]',
        '      }',
        '    ]',
        '  }',
        '}',
        '```'
      ])
    )

    expect(result.configExampleCount).toBe(1)
    expect(result.issues).toEqual([])
  })

  // The fragment rule, which is the whole reason this can be a single schema call:
  // every top-level block is optional, so an excerpt IS a valid configuration
  // document and needs no marker, no merge and no completeness exemption.
  test('a single-block fragment is validated as far as it goes and is not reported as incomplete', () => {
    const result = checkConfigExamplesInFile(
      markdown('docs/example.md', ['```json', '{ "review": { "maxCostUsd": 5 } }', '```'])
    )

    expect(result.configExampleCount).toBe(1)
    expect(result.issues).toEqual([])
  })

  test('a fragment is still held to the schema inside the block it does show', () => {
    const result = checkConfigExamplesInFile(
      markdown('docs/example.md', [
        '```json',
        '{ "qualityGate": { "minProductRecall": 0.5 } }',
        '```'
      ])
    )

    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]?.message).toContain('minProductRecall')
  })

  test('a block carrying no configuration key is not a configuration example', () => {
    const result = checkConfigExamplesInFile(
      markdown('docs/example.md', [
        '```json',
        '{ "runId": "abc", "qualityGatePassed": true }',
        '```'
      ])
    )

    expect(result.jsonBlockCount).toBe(1)
    expect(result.configExampleCount).toBe(0)
    expect(result.issues).toEqual([])
  })

  // `some`, not `every`: a half-updated example that still carries a real
  // configuration key is judged by the strict schema rather than skipped for the
  // foreign key that is itself the defect.
  test('a block mixing configuration keys with foreign ones is judged, not skipped', () => {
    const result = checkConfigExamplesInFile(
      markdown('docs/example.md', [
        '```json',
        '{ "review": { "maxCostUsd": 5 }, "runId": "abc" }',
        '```'
      ])
    )

    expect(result.configExampleCount).toBe(1)
    expect(result.issues[0]?.message).toContain('runId')
  })

  test('an unmarked block that does not parse is an illustration, not a broken example', () => {
    const result = checkConfigExamplesInFile(
      markdown('docs/example.md', [
        '```json',
        '{ "expectedFindings": [ … ] }',
        '```'
      ])
    )

    expect(result.jsonBlockCount).toBe(1)
    expect(result.configExampleCount).toBe(0)
    expect(result.issues).toEqual([])
  })

  test('a block that claims to be configuration gets no benefit of the doubt when it does not parse', () => {
    const result = checkConfigExamplesInFile(
      markdown('docs/example.md', ['```json config', '{ "review": [ … ] }', '```'])
    )

    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]?.kind).toBe('unparseable')
    expect(result.issues[0]?.line).toBe(1)
  })

  test('the config marker forces validation of a block content classification would miss', () => {
    const result = checkConfigExamplesInFile(
      markdown('docs/example.md', ['```json config', '{ "nope": true }', '```'])
    )

    expect(result.configExampleCount).toBe(1)
    expect(result.issues[0]?.message).toContain('nope')
  })

  test('the not-config marker excludes a block a configuration key name would otherwise capture', () => {
    const result = checkConfigExamplesInFile(
      markdown('docs/example.md', [
        '```json not-config',
        '{ "review": "this is a report field, not the config block" }',
        '```'
      ])
    )

    expect(result.jsonBlockCount).toBe(1)
    expect(result.configExampleCount).toBe(0)
    expect(result.issues).toEqual([])
  })
})

describe('json block extraction', () => {
  test('reads an indented fence and strips only the fence indentation', () => {
    const blocks = extractJsonBlocks(
      markdown('docs/example.md', [
        '- Set a budget:',
        '',
        '  ```json',
        '  { "review": { "maxCostUsd": 5 } }',
        '  ```',
        ''
      ])
    )

    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.line).toBe(3)
    expect(blocks[0]?.body).toBe('{ "review": { "maxCostUsd": 5 } }')
  })

  test('ignores fenced blocks in other languages', () => {
    const blocks = extractJsonBlocks(
      markdown('docs/example.md', [
        '```bash',
        '{ "review": {} }',
        '```',
        '```jsonc',
        '{ "review": {} }',
        '```',
        '```yaml',
        'review: {}',
        '```'
      ])
    )

    expect(blocks).toEqual([])
  })

  test('reads every block in a file, not only the first', () => {
    const blocks = extractJsonBlocks(
      markdown('docs/example.md', [
        '```json',
        '{ "a": 1 }',
        '```',
        'prose',
        '```json',
        '{ "b": 2 }',
        '```',
        'prose',
        '```json',
        '{ "c": 3 }',
        '```'
      ])
    )

    expect(blocks.map((block) => block.line)).toEqual([1, 5, 9])
  })

  test('an unterminated fence yields the rest of the file rather than swallowing the next block silently', () => {
    const blocks = extractJsonBlocks(
      markdown('docs/example.md', ['```json', '{ "review": {} }'])
    )

    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.body).toBe('{ "review": {} }')
  })
})

describe('the checked corpus', () => {
  // The convention this check relies on, asserted where a reader of the code will
  // see it: the documentation says what the checker does, so the two cannot drift
  // into disagreeing about which blocks are checked.
  test('the contributing guide documents the convention the checker relies on', async () => {
    const guide = await readFile(
      path.join(repositoryRoot, 'docs', '09-contributing', 'running-tests-and-checks.md'),
      'utf8'
    )

    expect(guide).toContain('CodeReviewerConfigSchema')
    expect(guide).toContain('not-config')
    expect(guide).toContain('config-example-checker')
  })
})
