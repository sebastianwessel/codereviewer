import {
  supportedSignalLanguageForPath,
  type SupportedSignalLanguage
} from '../../../deterministic-signals/index.js'

const LANGUAGE_DISPLAY_NAME: Readonly<Record<SupportedSignalLanguage, string>> = {
  typescript: 'TypeScript',
  javascript: 'JavaScript',
  python: 'Python',
  go: 'Go',
  rust: 'Rust',
  java: 'Java',
  ruby: 'Ruby'
}

// Generic, language-specific defect patterns to focus the review. These are
// real, common pitfalls per language — NOT benchmark-derived. They sharpen the
// model's attention without making the engine language-specific (the map is
// data, applied generically to whatever languages the change touches).
const LANGUAGE_GUIDANCE: Readonly<
  Record<SupportedSignalLanguage, readonly string[]>
> = {
  typescript: [
    'Floating or unawaited promises (especially async callbacks in forEach/map) that drop errors or break ordering.',
    '`any`/`as` casts and non-null assertions (`!`) that hide real type mismatches or null-at-runtime values.',
    'null vs undefined confusion; optional chaining masking missing data; `==` vs `===` and falsy 0/""/NaN bugs.',
    'Mutation of shared object/array references; shallow-copy (spread) assumptions.',
    'Promise.all error propagation and unhandled rejections.'
  ],
  javascript: [
    'Floating or unawaited promises (especially async callbacks in forEach/map) that drop errors or break ordering.',
    'null/undefined dereference; `==` vs `===`; falsy 0/""/NaN bugs.',
    'Mutation of shared object/array references; shallow-copy (spread) assumptions.',
    'Prototype/this binding mistakes; Promise.all error propagation and unhandled rejections.'
  ],
  python: [
    'Mutable default arguments (def f(x=[])) and other shared default/global state.',
    'Bare `except:` or broad `except Exception` that swallows errors; silent `pass`.',
    'Aliasing of lists/dicts and in-place mutation of shared objects; generator/iterator exhaustion.',
    'async/await misuse: missing await, blocking calls inside async code.',
    'Off-by-one and negative-index slicing surprises; truthiness of 0/empty.'
  ],
  go: [
    'Unchecked or ignored errors (missing `if err != nil`); swallowed errors.',
    'Nil map writes and nil pointer dereferences (panics).',
    'Goroutine leaks, missing context cancellation, and channel deadlocks.',
    '`defer` inside loops (resource accumulation); slice aliasing via append reusing the backing array.',
    'Data races on shared state without synchronization; copying sync types by value.'
  ],
  java: [
    'NullPointerException from unchecked nulls and Optional misuse.',
    'Broken equals/hashCode contract; using `==` to compare objects.',
    'Resource leaks: missing try-with-resources / close on the failure path.',
    'Swallowed or overly broad exception handling.',
    'Concurrency: missing synchronized/volatile, non-atomic compound operations; integer overflow and autoboxing NPEs.'
  ],
  ruby: [
    'nil handling leading to NoMethodError; gaps where safe navigation (&.) is missing.',
    'Mutation of shared/global state; frozen-string and shared-default assumptions.',
    'Symbol vs string hash-key mismatches.',
    'Exception swallowing (rescue => e then nil) or rescuing too broadly.',
    'Truthiness pitfalls (only nil/false are falsey); monkeypatch/method-override conflicts.'
  ],
  rust: [
    'unwrap()/expect()/panic on Err or None that is reachable at runtime.',
    'Integer overflow and arithmetic on untrusted input.',
    'Error handling: ignoring Result, incorrect `?` propagation.',
    'unsafe block invariants and aliasing/lifetime assumptions.',
    'Index-out-of-bounds/slicing panics; shared-state concurrency (Mutex/Arc) misuse.'
  ]
}

// Build a language-focus section for the languages the change actually touches.
// Returns '' when no supported language is detected (e.g. config-only changes),
// keeping the engine generic. The result is stable per task, so it is safe to
// place in the cacheable prompt prefix.
export const languageReviewGuidance = (
  paths: readonly string[]
): string => {
  const languages: SupportedSignalLanguage[] = []
  for (const path of paths) {
    const language = supportedSignalLanguageForPath(path)
    if (language !== undefined && !languages.includes(language)) {
      languages.push(language)
    }
  }

  if (languages.length === 0) {
    return ''
  }

  const sections = languages.map((language) =>
    [
      `### ${LANGUAGE_DISPLAY_NAME[language]}`,
      ...LANGUAGE_GUIDANCE[language].map((item) => `- ${item}`)
    ].join('\n')
  )

  return [
    `\n## Language-specific focus (${languages
      .map((language) => LANGUAGE_DISPLAY_NAME[language])
      .join(', ')})`,
    'Apply the general defect taxonomy, and additionally watch for these common',
    'pitfalls of the language(s) in this change (only report concrete, code-backed instances):',
    ...sections
  ].join('\n')
}
