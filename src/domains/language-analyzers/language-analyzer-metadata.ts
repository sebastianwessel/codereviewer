import ts from 'typescript'
import { astGrepVersion } from './ast-grep/ast-grep-parser.js'
import type { FirstClassLanguage } from './shared/language-analyzer-types.js'

const astGrepVersionLabel = `ast-grep@${astGrepVersion}`

export const languageAnalyzerVersions = {
  typescript: ts.version,
  javascript: ts.version,
  python: astGrepVersionLabel,
  go: astGrepVersionLabel,
  rust: astGrepVersionLabel,
  java: astGrepVersionLabel
} as const satisfies Record<FirstClassLanguage, string>
