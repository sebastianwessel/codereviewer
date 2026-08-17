import { z } from 'zod'

// The one shape a documentation checker in this domain reports a problem in, and
// the one way of rendering it.
//
// `artifact-example-checker.ts`, `config-example-checker.ts` and
// `config-default-table-checker.ts` each report `{ kind, path, line, message }`
// and each had its own copy of a renderer that formatted it identically. Three
// copies of one line is three chances for a failure message to start reading
// differently depending on which checker produced it.
//
// THE `kind` ENUMS STAY WITH THEIR CHECKERS. They are genuinely different
// vocabularies — a stale artifact version is not a thing a table row can be —
// and merging them would offer every checker's callers members no checker of
// theirs can emit. Only the shape and the rendering are shared.

/**
 * The `{ kind, path, line, message }` shape, closed over one checker's own kind
 * enum.
 *
 * `path` is repository-relative and POSIX-separated, so a message is
 * copy-pasteable on any platform. `line` is 1-based; a checker states at its own
 * schema what the line points at, and what it names when it has no line of its
 * own to point at.
 */
export const documentIssueSchema = <Kind extends z.ZodType>(
  kind: Kind
): z.ZodObject<
  {
    kind: Kind
    path: z.ZodString
    line: z.ZodNumber
    message: z.ZodString
  },
  z.core.$strict
> =>
  z.strictObject({
    kind,
    path: z.string().min(1),
    line: z.int().min(1),
    message: z.string().min(1)
  })

/** What every checker's issue is, once its own kind enum is widened away. */
export type DocumentIssue = {
  readonly kind: string
  readonly path: string
  readonly line: number
  readonly message: string
}

/** One human-readable line per issue, for a test failure message or a console. */
export const renderDocumentIssues = (
  issues: readonly DocumentIssue[]
): string =>
  issues
    .map((issue) => `${issue.path}:${issue.line} [${issue.kind}] ${issue.message}`)
    .join('\n')
