import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { loggingCliOptions } from './args.js'
import { runCli } from './index.js'

// `docs/06-reference/cli.md` is a hand-written restatement of what this dispatcher
// and these parsers do, and on 2026-08-17 it had drifted in both of the ways a
// restatement drifts:
//
//   - its Commands table and the prose around it were written when there were seven
//     commands; there are twelve, and `eval impact` / `eval intent` had no section
//     at all;
//   - its argument-parsing table said the logging flags were "declared by `review`
//     and `eval run` alone", while four commands declare them.
//
// Nothing caught either. The drift checker reads links and fenced JSON blocks, and
// `exit-code-documentation.test.ts` — whose shape this file copies — pins one table
// on a different page. So this test pins the two facts that had actually rotted,
// each against the code rather than against a second copy of the list:
//
//   1. the Commands table, against the dispatcher's own usage message, which is the
//      CLI's single enumeration of what it dispatches;
//   2. which commands declare `--debug` / `--log-level` / `--log-file`, against what
//      those commands DO with the flag — a probe, not a list.
//
// It deliberately checks nothing else on the page. A checker broad enough to be
// interesting is one people start exempting.
//
// The usage-message parse is duplicated from `drift-checker-cli-inventory.test.ts`
// rather than shared: that file keeps only the first word of each entry (the
// inventory the drift domain matches documentation on), this one needs the whole
// command phrase, and a test helper exported from `src/` to serve two tests would
// put test scaffolding in the package's public surface.
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
)

const documentPath = path.join('docs', '06-reference', 'cli.md')

const readReference = async (): Promise<string> =>
  await readFile(path.join(repositoryRoot, documentPath), 'utf8')

const cliOptions = { cwd: process.cwd(), environment: {} } as const

type CliErrorEnvelope = { readonly code: string; readonly message: string }

const errorEnvelope = async (
  args: readonly string[]
): Promise<CliErrorEnvelope> => {
  const result = await runCli(args, cliOptions)

  return JSON.parse(result.stderr) as CliErrorEnvelope
}

// Every command the CLI dispatches, as the command line spells it — read back out
// of the usage message an unknown command prints. Reading it from there means this
// test cannot pass by agreeing with a stale copy of the list.
const dispatchedCommands = async (): Promise<readonly string[]> => {
  const { message } = await errorEnvelope([])

  return message
    .replace(/^Expected command:\s*/u, '')
    .split(',')
    .map((entry) => entry.trim().replace(/^or\s+/u, ''))
    .filter((entry) => entry.length > 0)
}

// The data rows of the FIRST Markdown table in `text`, as cells. Literal on
// purpose: a row it cannot read is a row the assertions never see, so the
// anti-vacuity checks below assert the parse found something rather than assuming
// it did.
const firstTableRows = (
  text: string,
  label: string
): readonly (readonly string[])[] => {
  const rows: (readonly string[])[] = []

  for (const line of text.split('\n')) {
    const trimmed = line.trim()

    if (!trimmed.startsWith('|')) {
      // The table ends at the first non-row line after it started.
      if (rows.length > 0) {
        break
      }
      continue
    }

    rows.push(
      trimmed
        .slice(1, trimmed.endsWith('|') ? -1 : undefined)
        .split('|')
        .map((cell) => cell.trim())
    )
  }

  // The data rows are the ones after the `| --- |` separator. Located rather than
  // assumed to be "row 2", so a table this cannot read fails loudly here instead
  // of quietly contributing a header row to a comparison.
  const separator = rows.findIndex((cells) =>
    cells.every((cell) => /^:?-{3,}:?$/u.test(cell))
  )

  if (separator === -1) {
    throw new Error(
      `${documentPath}: ${label} holds no Markdown table this test can read.`
    )
  }

  return rows.slice(separator + 1)
}

// Everything under a `##` heading, up to the next one.
const sectionBody = (markdown: string, heading: string): string => {
  const body = markdown.split(`\n${heading}\n`)[1]

  if (body === undefined) {
    throw new Error(
      `${documentPath} has no "${heading}" section; it moved or was renamed.`
    )
  }

  return body.split('\n## ')[0] as string
}

const documentedCommands = (markdown: string): readonly string[] =>
  firstTableRows(sectionBody(markdown, '## Commands'), 'the Commands section').map(
    (cells) => (cells[0] as string).replaceAll('`', '')
  )

// The per-command reference sections, keyed by the command they document.
const commandSections = (markdown: string): ReadonlyMap<string, string> => {
  const sections = new Map<string, string>()

  for (const chunk of markdown.split('\n## ')) {
    const lines = chunk.split('\n')
    const heading = /^`codereviewer ([a-z][a-z-]*(?: [a-z][a-z-]*)*)`$/u.exec(
      (lines[0] ?? '').trim()
    )

    if (heading?.[1] === undefined) {
      continue
    }

    sections.set(heading[1], lines.slice(1).join('\n'))
  }

  return sections
}

// Whether a command DECLARES the logging flags, asked of the command itself.
//
// A command that does not declare an option rejects it before doing any work
// (`usage_error: Unknown option --log-level`). A command that declares it gets as
// far as parsing the value and finds none (`config_error: --log-level requires a
// value`). Both answers are returned before any IO, so this probe is free — and it
// reads the behaviour rather than an exported list, which is the point: an option
// set that is exported but never spread into `unknownCliOption` would still pass a
// list comparison.
const declaresLoggingFlags = async (command: string): Promise<boolean> => {
  const words = command.split(' ')
  const level = await errorEnvelope([...words, '--log-level'])
  const file = await errorEnvelope([...words, '--log-file'])

  if (
    level.code === 'usage_error' &&
    level.message === 'Unknown option --log-level'
  ) {
    expect(file, `${command} rejects --log-file too`).toEqual({
      code: 'usage_error',
      message: 'Unknown option --log-file'
    })

    return false
  }

  // Anything other than the two documented answers means this probe stopped
  // measuring what it claims to, so it fails rather than guessing.
  expect(level, `${command} parses --log-level`).toEqual({
    code: 'config_error',
    message: '--log-level requires a value'
  })
  expect(file, `${command} parses --log-file`).toEqual({
    code: 'config_error',
    message: '--log-file requires a path'
  })

  return true
}

describe('CLI reference documentation', () => {
  test('the Commands table lists exactly what the dispatcher dispatches', async () => {
    const markdown = await readReference()
    const documented = documentedCommands(markdown)
    const dispatched = await dispatchedCommands()

    // Anti-vacuity: a parse that matched nothing, or that matched only single-word
    // entries, must not be able to agree with anything.
    expect(documented.length).toBeGreaterThan(1)
    expect(documented).toContain('review')
    expect(documented).toContain('eval run')
    expect(dispatched).toContain('review')
    expect(dispatched).toContain('eval run')

    expect([...documented].sort()).toEqual([...dispatched].sort())
  })

  test('the logging flags are documented for exactly the commands that declare them', async () => {
    const markdown = await readReference()
    const sections = commandSections(markdown)
    const dispatched = await dispatchedCommands()

    // The three flags are one unit in the code, so probing two of them speaks for
    // `--debug` as well — which cannot be probed the same way, having no value to
    // be missing and therefore no early failure to observe.
    expect([...loggingCliOptions].sort()).toEqual(
      ['--debug', '--log-file', '--log-level'].sort()
    )

    // Anti-vacuity: every dispatched command must have a section, or a section
    // scan that silently found none would agree with an empty documented set.
    expect([...sections.keys()].sort()).toEqual([...dispatched].sort())

    const declaring: string[] = []
    const documenting: string[] = []

    for (const command of dispatched) {
      if (await declaresLoggingFlags(command)) {
        declaring.push(command)
      }

      // The section's own FLAG TABLE, not its prose: every section's usage block
      // is free to mention `--log-level` — and the ones that do not accept it say
      // so in words — so a substring search over the whole section would call a
      // section that documents nothing documented.
      const flagRows = firstTableRows(
        sections.get(command) ?? '',
        `the \`${command}\` section`
      )

      // Anti-vacuity, per section: a section whose table this cannot read must not
      // be silently counted as "documents no logging flag".
      expect(
        flagRows.length,
        `the \`${command}\` section has a readable flag table`
      ).toBeGreaterThan(0)

      if (flagRows.some((cells) => (cells[0] ?? '').includes('--log-level'))) {
        documenting.push(command)
      }
    }

    // Anti-vacuity again: the split has to be a real split. A probe that answered
    // "no" everywhere, or a page that documented the flags nowhere, would otherwise
    // agree trivially.
    expect(declaring.length).toBeGreaterThan(0)
    expect(declaring.length).toBeLessThan(dispatched.length)
    expect([...documenting].sort()).toEqual([...declaring].sort())

    // And the rules table, which states the same fact in prose one screen above the
    // sections. This is the sentence that had gone stale, so it is pinned as the
    // literal list it renders — naming a subset of the declaring commands is
    // exactly the failure that shipped, and a positive `toContain` per command
    // cannot catch it while the row also names them in a correction note.
    const rulesRow = firstTableRows(
      sectionBody(markdown, '## Argument-parsing rules (apply to every command)'),
      'the argument-parsing rules section'
    ).find((cells) => cells[0] === 'Unknown flags')

    expect(rulesRow, 'the "Unknown flags" row of the rules table').toBeDefined()

    const quoted = declaring.map((command) => `\`${command}\``)
    const clause = `${quoted.slice(0, -1).join(', ')} and ${quoted.at(-1)}`

    const renderedRow = (rulesRow as readonly string[]).join(' ')

    expect(
      renderedRow,
      'the rules table names the commands that declare the logging flags'
    ).toContain(clause)

    // The COUNT WORDS beside that list, pinned separately. The list above and the
    // numbers are two statements of one fact, and only the list was checked — so
    // "the **four** commands" could be edited to "the **two** commands" while the
    // four names stayed correct beneath it, and nothing failed. That is the same
    // shape as the stale sentence this whole test exists to prevent, one clause
    // to the left.
    const numberWords = [
      'zero',
      'one',
      'two',
      'three',
      'four',
      'five',
      'six',
      'seven',
      'eight',
      'nine',
      'ten',
      'eleven',
      'twelve'
    ] as const
    const wordFor = (count: number): string => {
      const word = numberWords[count]

      if (word === undefined) {
        throw new Error(
          `the command inventory grew past ${numberWords.length - 1}; extend this list`
        )
      }

      return word
    }

    expect(
      renderedRow,
      'the rules table states how many commands declare the logging flags'
    ).toContain(`**${wordFor(declaring.length)}** commands`)
    expect(
      renderedRow,
      'the rules table states how many commands reject them, out of how many'
    ).toContain(
      `**${wordFor(dispatched.length - declaring.length)}** of the ${wordFor(dispatched.length)}`
    )
  })
})
