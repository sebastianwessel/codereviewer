// The two control fixtures spec 24's adjudication layer is judged against.
//
// They are a matched pair, and the pair is the point. A layer that rejects
// everything passes a rejection-rate check perfectly and is worthless, so the
// fixtures are always used together: one divergence set that MUST be rejected and
// one that MUST survive. Either alone is unfalsifiable.
//
// NEGATIVE CONTROL — the two divergences this repository actually produces.
// Measured over `src/domains/context-retrieval/` with the deterministic core:
// eight module-level exports form one peer set, and two of them are genuine
// members diverging on a low-salience trait ("4 of 7 call `string`", "4 of 7 call
// `min`"). Spec 24 records them as "the honest residue of the majority rule", and
// they are what the adjudication layer exists to remove: a schema builder that
// takes no string field is not violating a practice.
//
// The declarations below are a FROZEN reproduction of those real ones rather than
// a read of the live sources, deliberately. A control has to keep testing the same
// thing: reading the repository as it evolves would let an unrelated edit — one
// more `z.string()` in a sibling schema — silently turn the control into a
// different case, or into no case at all.
//
// POSITIVE CONTROL — three sibling handlers that guard plus a fourth that does not
// while sharing the group's other trait. In a second language, because spec 24's
// verification matrix asks for the control to be in one, and it is the shape the
// capability exists for: a member of the group that dropped what the group does.
//
// This module is test-only (`tsconfig.build.json` excludes this directory). It
// lives in `shared/testing` rather than beside the domain so the domain's own unit
// tests and the end-to-end control suite assert against ONE definition of each
// fixture; a control that exists in two hand-maintained copies is a control that
// will eventually disagree with itself.

export type ConformanceControlFile = {
  readonly path: string
  readonly content: string
}

export type ConformanceControlFixture = {
  readonly files: readonly ConformanceControlFile[]
  // Paths the change is to be treated as having touched. The rest supply peers.
  readonly changedPaths: readonly string[]
  // The divergence statements the deterministic core produces for the changed
  // declarations, verbatim. Asserted directly, so a fixture that stops reproducing
  // its case fails loudly instead of quietly passing an adjudication assertion.
  readonly expectedStatements: readonly string[]
}

const schemaBuilderPeers = `import { z } from 'zod'

export const RepoReadToolInputSchema = z.strictObject({
  path: z.string().min(1).describe('Repository-relative path of the file to read.')
})

export const RepoListToolInputSchema = z.strictObject({
  path: z
    .string()
    .min(1)
    .describe('Repository-relative path of the directory to list.')
})

export const RepoGrepToolInputSchema = z.strictObject({
  query: z.string().min(1).describe('Literal substring to search for.'),
  paths: z
    .array(z.string().min(1))
    .optional()
    .describe('Optional repository-relative paths to search.')
})

export const RepoToolOutputSchema = z.strictObject({
  summary: z.string(),
  content: z.string()
})
`

const budgetSchema = `import { z } from 'zod'

export const ContextRetrievalBudgetSchema = z.strictObject({
  maxReads: z.int().min(0).default(4),
  usedReads: z.int().min(0).default(0),
  maxSearches: z.int().min(0).default(2),
  usedSearches: z.int().min(0).default(0),
  maxBytesPerRead: z.int().min(1).default(20000),
  maxMatches: z.int().min(1).default(20),
  maxDepth: z.int().min(0).default(6)
})
`

// The two declarations spec 24's membership section describes being grouped with
// schema builders because a module's top-level declarations all sit at column 0.
// Neither produces a divergence — they hold no majority trait — but both count
// towards the peer denominator, which is what makes the arithmetic "4 of 7".
const errorAndToolTypes = `export class ToolCallBudgetExceededError extends Error {
  constructor(maxToolCalls: number) {
    super(\`Repository tool-call budget exceeded: at most \${maxToolCalls} calls.\`)
  }
}

export type RetrievalTools = {
  read(input: { readonly path: string }): Promise<ContextRetrievalResult>
  list(input: { readonly path: string }): Promise<ContextRetrievalResult>
  grep(input: { readonly query: string }): Promise<ContextRetrievalResult>
}
`

const symbolLookup = `export const lookupSymbolReferences = async (
  input: LookupSymbolReferencesInput
): Promise<readonly SymbolReferenceResult[]> => {
  const queries = uniqueQueries(input.queries)

  return queries
}
`

/**
 * The negative control: the two real divergences of this repository, reproduced.
 *
 * Both changed declarations are genuine members of their peer set — each holds the
 * group's `strictObject` trait — so the membership precondition does not remove
 * them and the majority rule reports them. They are exactly the case where the
 * deterministic core has done everything it can and the answer still requires
 * knowing that calling `string` is how a schema library is written rather than a
 * practice its declarations owe each other.
 */
export const schemaBuilderNegativeControl: ConformanceControlFixture = {
  files: [
    { path: 'src/context-retrieval/bounded-tools.ts', content: errorAndToolTypes },
    { path: 'src/context-retrieval/index.ts', content: budgetSchema },
    {
      path: 'src/context-retrieval/repo-tool-contracts.ts',
      content: schemaBuilderPeers
    },
    {
      path: 'src/context-retrieval/symbol-reference-lookup.ts',
      content: symbolLookup
    }
  ],
  changedPaths: [
    'src/context-retrieval/index.ts',
    'src/context-retrieval/repo-tool-contracts.ts'
  ],
  expectedStatements: [
    '4 of 7 sibling declarations call min; RepoToolOutputSchema does not.',
    '4 of 7 sibling declarations call string; ContextRetrievalBudgetSchema does not.'
  ]
}

const guardedHandler = (name: string, load: string): string =>
  [
    `func ${name}(w http.ResponseWriter, r *http.Request) {`,
    '\tif !requireAuth(r) {',
    '\t\trespond(w, 401, "unauthorized")',
    '\t\treturn',
    '\t}',
    `\trespond(w, 200, ${load}(r))`,
    '}',
    ''
  ].join('\n')

// The three conforming handlers, plus the added fourth. Kept as separate exports so
// the deterministic-core unit test can build the same content with its own hunk
// arithmetic while the end-to-end control writes it to a file.
export const guardedHandlerPeersSource = [
  'package handlers',
  '',
  guardedHandler('ListUsers', 'loadUsers'),
  guardedHandler('GetUser', 'loadUser'),
  guardedHandler('DeleteUser', 'removeUser')
].join('\n')

export const unguardedHandlerSource = [
  'func ExportUsers(w http.ResponseWriter, r *http.Request) {',
  '\trespond(w, 200, exportAll(r))',
  '}',
  ''
].join('\n')

/**
 * The positive control: a handler that belongs to the group and dropped its guard.
 *
 * `ExportUsers` calls `respond`, which all three peers call, so it is a member of
 * the set rather than an unrelated declaration that landed in it — the distinction
 * the membership precondition draws. The trait it lacks is the group's
 * authorization check.
 *
 * THIS IS THE CONTROL THAT MATTERS. A layer that answers "incidental" to everything
 * removes the negative control perfectly and is worth nothing; only this fixture
 * can tell the difference.
 */
export const handlerPositiveControl: ConformanceControlFixture = {
  files: [
    {
      path: 'handlers/users.go',
      content: `${guardedHandlerPeersSource}\n${unguardedHandlerSource}`
    }
  ],
  changedPaths: ['handlers/users.go'],
  expectedStatements: [
    '3 of 3 sibling declarations call requireAuth; ExportUsers does not.'
  ]
}
