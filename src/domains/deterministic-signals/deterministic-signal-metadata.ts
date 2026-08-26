import { astGrepVersion } from './ast-grep/ast-grep-parser.js'
import type { SupportedSignalLanguage } from './shared/deterministic-signal-types.js'

const astGrepVersionLabel = `ast-grep@${astGrepVersion}`

// Every supported language reports the same extractor version, because every
// supported language runs through the same engine. TypeScript and JavaScript used
// to report `ts.version` from a separate compiler-based extractor; that engine is
// gone, so naming a TypeScript version here would attribute the signals to a tool
// that no longer produces them.
export const deterministicSignalExtractorVersions = {
  typescript: astGrepVersionLabel,
  javascript: astGrepVersionLabel,
  python: astGrepVersionLabel,
  go: astGrepVersionLabel,
  rust: astGrepVersionLabel,
  java: astGrepVersionLabel,
  ruby: astGrepVersionLabel
} as const satisfies Record<SupportedSignalLanguage, string>
