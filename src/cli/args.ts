// Pure command-line argument parsers shared by the CLI command handlers. Each
// takes the raw `args` array and returns a typed value (or throws a TypeError
// with an actionable message). No IO or runtime state lives here.
import { ReviewLogLevelSchema } from '../domains/observability/index.js'

// Options every command accepts, wherever it appears in the argument list.
export const globalCliOptions: readonly string[] = [
  '--config',
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
// `--option=value` is accepted as a spelling and checked on the name alone, so a
// command whose parsers only understand the space-separated form still rejects
// the joined form by name rather than mistaking it for an unknown option.
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
  const configIndex = args.indexOf('--config')

  if (configIndex === -1) {
    return undefined
  }

  const configPath = args[configIndex + 1]
  if (
    configPath === undefined ||
    configPath.length === 0 ||
    configPath.startsWith('-')
  ) {
    throw new TypeError('--config requires a path')
  }

  return configPath
}

export const parseOptionValue = (
  args: readonly string[],
  optionName: string
): string | undefined => {
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

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== optionName) {
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

  const logLevelIndex = args.indexOf('--log-level')
  if (logLevelIndex === -1) {
    return {
      args
    }
  }

  const value = args[logLevelIndex + 1]
  if (value === undefined || value.length === 0 || value.startsWith('-')) {
    throw new TypeError('--log-level requires a value')
  }

  return {
    level: ReviewLogLevelSchema.parse(value),
    args: args.filter(
      (_arg, index) => index !== logLevelIndex && index !== logLevelIndex + 1
    )
  }
}

export const parseLogFileOverride = (
  args: readonly string[]
): { readonly logFile?: string; readonly args: readonly string[] } => {
  const logFileIndex = args.indexOf('--log-file')
  if (logFileIndex === -1) {
    return {
      args
    }
  }

  const value = args[logFileIndex + 1]
  if (value === undefined || value.length === 0 || value.startsWith('-')) {
    throw new TypeError('--log-file requires a path')
  }

  return {
    logFile: value,
    args: args.filter(
      (_arg, index) => index !== logFileIndex && index !== logFileIndex + 1
    )
  }
}

export const parseExplicitFiles = (
  args: readonly string[]
): readonly string[] | undefined => {
  const files: string[] = []

  for (const [index, value] of args.entries()) {
    if (value === '--file') {
      const file = args[index + 1]
      if (file === undefined || file.length === 0) {
        throw new TypeError('--file requires a path')
      }
      files.push(file)
    }
  }

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
