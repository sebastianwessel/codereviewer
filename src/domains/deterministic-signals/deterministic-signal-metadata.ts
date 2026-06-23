import ts from 'typescript'
import { astGrepVersion } from './ast-grep/ast-grep-parser.js'
import type { SupportedSignalLanguage } from './shared/deterministic-signal-types.js'

const astGrepVersionLabel = `ast-grep@${astGrepVersion}`

export const deterministicSignalExtractorVersions = {
  typescript: ts.version,
  javascript: ts.version,
  python: astGrepVersionLabel,
  go: astGrepVersionLabel,
  rust: astGrepVersionLabel,
  java: astGrepVersionLabel,
  ruby: astGrepVersionLabel
} as const satisfies Record<SupportedSignalLanguage, string>
