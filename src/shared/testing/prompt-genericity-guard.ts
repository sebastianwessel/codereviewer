// Standing guard for the non-negotiable in spec 15 ("Generic, Not Eval-Specific"):
// every rule the engine sends to a model must derive from public, established
// knowledge, never from a case the engine happens to be scored against. Prompt
// tuning is invisible in a diff - a fixture-derived clause reads exactly like a
// principle - so the recurring failure mode is guarded by its observable symptoms
// rather than by review alone. Both symptoms guarded below were found in real
// regressions: a clause naming one stack, and a clause pre-deciding a verdict for
// one narrowly described defect. Anything a prompt legitimately needs can be said
// without them.
//
// This lives in `shared/` rather than inside `review-workflow` because spec 22
// names the same guard as the test for its own language-neutrality requirement,
// and `change-impact` is forbidden from importing `review-workflow`. Spec 01's
// shared-helper policy admits a helper here when a spec identifies it as a stable
// cross-domain contract, which is exactly what specs 15 and 22 jointly do.
//
// It is test-only. `tsconfig.build.json` excludes this directory so it never
// reaches the published build, and nothing at runtime may import it.

export type PromptGenericityViolation = {
  readonly promptName: string
  readonly category: string
  readonly token: string
  readonly message: string
}

// Deliberately narrow: only proper nouns that name a specific implementation
// stack, plus the words for the eval machinery itself. Vocabulary that names a
// defect class or a public standard stays legal - "SQL injection", "CWE-89",
// "TOCTOU", "SSRF" and the canonical unsafe-deserializer sink names are exactly
// the public knowledge the prompts are supposed to be built from. The ambiguous
// language name "Go" is omitted on purpose, because it cannot be told apart from
// the ordinary verb without producing false failures.
export const bannedPromptVocabulary: ReadonlyArray<
  readonly [string, readonly string[]]
> = [
  // A rule that applies to one language is not a general principle; the engine
  // reviews every language it is pointed at.
  [
    'language name',
    [
      'TypeScript',
      'JavaScript',
      'Python',
      'Ruby',
      'Java',
      'Golang',
      'Rust',
      'PHP',
      'C#',
      'Kotlin',
      'Swift',
      'Scala'
    ]
  ],
  // A framework or runtime name means the clause was written while looking at one
  // application rather than at a defect class.
  [
    'framework or runtime name',
    [
      'React',
      'Vue',
      'Angular',
      'Svelte',
      'Next.js',
      'Express',
      'Fastify',
      'NestJS',
      'Django',
      'Flask',
      'Rails',
      'Spring',
      'Laravel',
      'jQuery',
      'Node.js',
      'Deno'
    ]
  ],
  // Product and vendor names are how a corpus slice identifies itself; the
  // repositories review fixtures are cut from are products, so banning the class
  // catches a fixture leak without hardcoding any fixture's identity.
  [
    'product or vendor name',
    [
      'Postgres',
      'PostgreSQL',
      'MySQL',
      'MongoDB',
      'Redis',
      'Prisma',
      'Kubernetes',
      'Docker',
      'GitHub',
      'GitLab',
      'AWS'
    ]
  ],
  // A rule restricted to one architectural layer describes somebody's application,
  // not a property of code; the reviewer is pointed at both sides of every system.
  ['architecture-layer narrowing', ['frontend', 'front-end', 'backend', 'back-end']],
  // A prompt that knows it is being measured is the definition of the violation.
  [
    'evaluation machinery',
    ['fixture', 'benchmark', 'eval set', 'corpus', 'expected finding', 'answer key']
  ]
]

// Word-bounded on identifier characters rather than `\b`, so "Next.js" and "C#"
// are matched as written instead of being split by the regex word boundary.
const boundedTokenPattern = (token: string): RegExp =>
  new RegExp(
    `(?<![A-Za-z0-9])${token.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(?![A-Za-z0-9])`,
    'iu'
  )

/**
 * Returns every banned-vocabulary violation in the given prompt. An empty array
 * means the prompt is clean. Returning the violations (rather than asserting)
 * keeps this module free of any test-framework dependency, so each domain can
 * report them in whatever shape its own suite prefers.
 */
export const findPromptGenericityViolations = (input: {
  readonly promptName: string
  readonly prompt: string
}): readonly PromptGenericityViolation[] => {
  const violations: PromptGenericityViolation[] = []

  for (const [category, tokens] of bannedPromptVocabulary) {
    for (const token of tokens) {
      if (boundedTokenPattern(token).test(input.prompt)) {
        violations.push({
          promptName: input.promptName,
          category,
          token,
          message: `${input.promptName} prompt mentions "${token}"; prompt rules must derive from public, language-neutral knowledge (spec 15)`
        })
      }
    }
  }

  return violations
}
