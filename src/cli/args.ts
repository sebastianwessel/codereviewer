// Pure command-line argument parsers shared by the CLI command handlers. Each
// takes the raw `args` array and returns a typed value (or throws a TypeError
// with an actionable message). No IO or runtime state lives here.
import { ReviewLogLevelSchema } from '../domains/observability/index.js'

// Options every command accepts, wherever they appear in the argument list.
//
// Only `--config` is genuinely global: every command loads configuration. The
// logging flags used to sit here too, which made all twelve commands ACCEPT
// them while only `review` and `eval run` read them -- so `intent check
// --log-level debug` exited 0 having logged nothing, the accept-and-ignore
// failure the comment below says this project has already paid for twice.
// They are declared by the commands that implement them instead, which is now
// four of the twelve: `review`, `eval run`, and `eval impact`/`eval intent`
// through the shared advisory-eval body. (This comment said "all seven
// commands" and "the two commands that implement them"; both counts were
// stale, and `src/cli/cli-reference.test.ts` now pins the second one against
// the code so it cannot drift again.)
export const globalCliOptions: readonly string[] = ['--config']

// The logging flags, for the commands that honour them. A command that does not
// call `parseLogLevelOverride`/`parseLogFileOverride` must NOT list these: being
// told an option is unknown is strictly better than being silently ignored.
export const loggingCliOptions: readonly string[] = [
  '--debug',
  '--log-level',
  '--log-file'
]

// The first `--option` in `args` that is not recognized, or undefined when they
// all are.
//
// Every parser in this file locates its option by exact token match and silently
// ignores anything it does not recognize. That is the right behaviour for a
// parser and the wrong behaviour for a command line: a mistyped or unsupported
// flag then changes nothing and the run proceeds as though it had been honoured.
// This project has already paid for that twice — an A/B whose config flag never
// reached the run and cost roughly $11.50 for a comparison of a build against
// itself, and `eval run --help`, which ran a full default evaluation instead of
// printing usage. A measurement harness that accepts a flag it does not
// implement cannot be trusted, so unknown options are rejected before any
// command does work.
//
// `--option=value` is checked on the name alone. That used to be a mitigation:
// the value parsers understood only the space-separated form, so this at least
// rejected an unknown flag by name instead of mistaking the joined spelling for
// one. Every parser now understands both spellings, so it is simply the name
// check it looks like.
//
// Note what is deliberately NOT treated as an option: a bare `-` or a token
// starting with a single dash. Those are values (a git ref cannot start with
// `-`, and paths are validated by their own parsers), and rejecting them here
// would duplicate a check that already reports a better message.
export const unknownCliOption = (
  args: readonly string[],
  commandOptions: readonly string[]
): string | undefined => {
  const known = new Set([...globalCliOptions, ...commandOptions])

  for (const arg of args) {
    if (!arg.startsWith('--')) {
      continue
    }

    // `--` alone is the conventional end-of-options marker, not an option.
    if (arg === '--') {
      continue
    }

    const name = arg.split('=')[0] ?? arg

    if (!known.has(name)) {
      return name
    }
  }

  return undefined
}

export const parseConfigPath = (args: readonly string[]): string | undefined => {
  const configPath = parseOptionValue(args, '--config')

  if (configPath === undefined) {
    return undefined
  }

  if (configPath.startsWith('-')) {
    throw new TypeError('--config requires a path')
  }

  return configPath
}

// `--name=value` is accepted everywhere `--name value` is.
//
// The unknown-option check has always tolerated the `=` form (it compares the part
// before `=`), while the value parsers matched whole tokens only. So
// `--slice-root=some/path` passed validation and was then IGNORED, and the run
// silently scored the DEFAULT corpus instead. A measurement that quietly answers a
// different question than the one asked is the exact failure this project keeps
// finding; an unsupported spelling must fail loudly, not be dropped.
const inlineOptionValue = (
  args: readonly string[],
  optionName: string
): string | undefined => {
  const prefix = `${optionName}=`
  const match = args.find((arg) => arg.startsWith(prefix))

  return match === undefined ? undefined : match.slice(prefix.length)
}

export const parseOptionValue = (
  args: readonly string[],
  optionName: string
): string | undefined => {
  const inline = inlineOptionValue(args, optionName)

  if (inline !== undefined) {
    if (inline.length === 0) {
      throw new TypeError(`${optionName} requires a value`)
    }

    return inline
  }

  const optionIndex = args.indexOf(optionName)

  if (optionIndex === -1) {
    return undefined
  }

  const value = args[optionIndex + 1]
  if (value === undefined || value.length === 0) {
    throw new TypeError(`${optionName} requires a value`)
  }

  return value
}

export const parseOptionValues = (
  args: readonly string[],
  optionName: string
): readonly string[] => {
  const values: string[] = []
  const prefix = `${optionName}=`

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] as string

    if (arg.startsWith(prefix)) {
      const inline = arg.slice(prefix.length)

      if (inline.length === 0) {
        throw new TypeError(`${optionName} requires a value`)
      }

      values.push(inline)
      continue
    }

    if (arg !== optionName) {
      continue
    }

    const value = args[index + 1]
    if (
      value === undefined ||
      value.length === 0 ||
      value.startsWith('-')
    ) {
      throw new TypeError(`${optionName} requires a value`)
    }

    values.push(value)
    index += 1
  }

  return values
}

// Reads an option's value AND returns the arguments with that option removed,
// accepting `--name value` and `--name=value` alike.
//
// The consuming parsers strip the option before handing the rest to a command,
// so they cannot use `parseOptionValue`: they need to know WHICH tokens to drop,
// and that differs between the two spellings (two tokens or one). Locating the
// option by `indexOf` alone -- which is what they did -- made the joined form
// invisible to them while `unknownCliOption` accepted it by name, so
// `--config=path` passed validation and was then dropped, and the run proceeded
// on defaults at exit 0. That is the same silent drop the comment above
// `inlineOptionValue` describes, in the four parsers that did not go through it.
const takeOptionValue = (
  args: readonly string[],
  optionName: string,
  missingValueMessage: string
): { readonly value?: string; readonly args: readonly string[] } => {
  const prefix = `${optionName}=`
  const inlineIndex = args.findIndex((arg) => arg.startsWith(prefix))

  if (inlineIndex !== -1) {
    const value = (args[inlineIndex] as string).slice(prefix.length)

    if (value.length === 0) {
      throw new TypeError(missingValueMessage)
    }

    return {
      value,
      args: args.filter((_arg, index) => index !== inlineIndex)
    }
  }

  const optionIndex = args.indexOf(optionName)

  if (optionIndex === -1) {
    return { args }
  }

  const value = args[optionIndex + 1]

  if (value === undefined || value.length === 0 || value.startsWith('-')) {
    throw new TypeError(missingValueMessage)
  }

  return {
    value,
    args: args.filter(
      (_arg, index) => index !== optionIndex && index !== optionIndex + 1
    )
  }
}

export const parseIntegerOption = (
  args: readonly string[],
  optionName: string,
  input: {
    readonly min: number
    readonly max: number
  }
): number | undefined => {
  const value = parseOptionValue(args, optionName)

  if (value === undefined) {
    return undefined
  }

  if (value.startsWith('-')) {
    throw new TypeError(`${optionName} requires a value`)
  }

  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < input.min || parsed > input.max) {
    throw new TypeError(
      `${optionName} must be an integer from ${input.min} to ${input.max}`
    )
  }

  return parsed
}

export const parseEnumOption = <T extends string>(
  args: readonly string[],
  optionName: string,
  allowedValues: readonly T[]
): T | undefined => {
  const value = parseOptionValue(args, optionName)

  if (value === undefined) {
    return undefined
  }

  if (value.startsWith('-') || !allowedValues.includes(value as T)) {
    throw new TypeError(
      `${optionName} must be one of ${allowedValues.join(', ')}`
    )
  }

  return value as T
}

export const parseLogLevelOverride = (
  args: readonly string[]
): { readonly level?: string; readonly args: readonly string[] } => {
  if (args.includes('--debug')) {
    return {
      level: 'debug',
      args: args.filter((arg) => arg !== '--debug')
    }
  }

  const taken = takeOptionValue(
    args,
    '--log-level',
    '--log-level requires a value'
  )

  if (taken.value === undefined) {
    return { args: taken.args }
  }

  return {
    level: ReviewLogLevelSchema.parse(taken.value),
    args: taken.args
  }
}

export const parseLogFileOverride = (
  args: readonly string[]
): { readonly logFile?: string; readonly args: readonly string[] } => {
  const taken = takeOptionValue(args, '--log-file', '--log-file requires a path')

  if (taken.value === undefined) {
    return { args: taken.args }
  }

  return { logFile: taken.value, args: taken.args }
}

export const parseExplicitFiles = (
  args: readonly string[]
): readonly string[] | undefined => {
  // `parseOptionValues` understands both spellings; the hand-rolled loop that
  // stood here understood only `--file path`, so `--file=path` was accepted by
  // name and then dropped, and the run reviewed the whole diff instead of the
  // one file that was asked for.
  const files: string[] = [...parseOptionValues(args, '--file')]

  const filesValue = parseOptionValue(args, '--files')
  if (filesValue !== undefined) {
    files.push(
      ...filesValue
        .split(',')
        .map((file) => file.trim())
        .filter((file) => file.length > 0)
    )
  }

  return files.length === 0 ? undefined : files
}
