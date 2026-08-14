import type { ZodType } from 'zod'
import { z } from 'zod'
import { BaselineFileSchema } from '../admission/baseline-writer.js'
import { ChangeImpactReferenceReportSchema } from '../change-impact/impact-report.js'
import { ChangeImpactCorpusManifestSchema } from '../evaluation/change-impact-eval/change-impact-corpus.schema.js'
import {
  EvalCaseSchema,
  EvalSliceCaseSchema,
  ExpectedFindingSchema,
  ExpectedNoFindingZoneSchema
} from '../evaluation/corpus/eval-fixture.schema.js'
import { EvalSliceManifestSchema } from '../evaluation/corpus/eval-slice-manifest.js'
import {
  RealRepoCorpusManifestSchema,
  RemovedCommentDisclosureReviewSchema
} from '../evaluation/corpus/real-repo-corpus.schema.js'
import { EvalReportSchema } from '../evaluation/report/eval-report-contracts.js'
import { IntentFulfilmentReportSchema } from '../intent-fulfilment/intent-fulfilment-report.js'
import { RunIndexSchema } from '../reporting/run-index.js'
import {
  BaselineWriteStdoutEnvelopeSchema,
  CliErrorEnvelopeSchema,
  ReviewStdoutEnvelopeSchema,
  RunErrorArtifactSchema
} from '../../shared/contracts/cli/cli-output.schema.js'
import { ReviewCommentDraftSchema } from '../../shared/contracts/report/review-comment.schema.js'
import {
  ReviewReportSchema,
  RunSummarySchema
} from '../../shared/contracts/report/review-report.schema.js'
import {
  extractJsonBlocks,
  isConfigExampleValue,
  type JsonBlock
} from './config-example-checker.js'
import { collectTextFiles, type TextFile } from './markdown-sources.js'

// Validates every JSON ARTIFACT example printed in this repository's Markdown
// against the contract whose producer actually emits it. It is the sibling of
// `config-example-checker.ts`, which does the same for CONFIGURATION examples,
// and it exists because that checker's scope was the only scope anything had.
//
// `docs/02-getting-started/install-and-run.md` printed an `impact check` report
// with a three-key summary for a week after the producer had moved to a
// seventeen-field one (the version literals involved have since been reset to
// `"1.0"`; the shape drift is the part that mattered). That is the page a new
// user reads first, and nothing in the suite, the drift check or the schema
// generator looked at it. A documented artifact shape a consumer cannot receive
// is worse than no example: it is a contract handed to somebody who trusted the
// page, and they only find out when their parser returns undefined.
//
// The producer contracts are the ONLY authority here. This module never restates
// a key, a version literal or an enum member — it resolves a tag to an exported
// Zod schema and walks the example against it.

// WHY THIS DOES NOT PARSE THE EXAMPLE AGAINST THE SCHEMA, which is the obvious
// implementation and the wrong one.
//
// A documented artifact example is almost always an EXCERPT. A page showing how
// to read `summary.impactFindingCount` prints the three counters it is talking
// about, not all seventeen; a page showing an obligation prints one, not the
// report around it; and the strings in an excerpt are `"…"`, `"9f1c2ab..."` and
// `"<runId>"` rather than real ISO timestamps and hex object names. A strict
// parse rejects every one of those, so the check would fail on nearly every
// honest example, and whoever ran it next would bulk-add opt-outs until the
// check meant nothing.
//
// So COMPLETENESS IS NOT REQUIRED and neither is well-formedness of leaf values.
// Three things are checked, and they are exactly the ones that caught the real
// defect:
//
//   1. every key in the example EXISTS in the contract, recursively, including
//      inside nested objects and array elements;
//   2. a `schemaVersion` shown equals the producer's current literal;
//   3. a value in a closed-enum position is one of that enum's members.
//
// An excerpt is legitimate. A key the producer cannot emit is not. The stale
// impact example failed all three at once: `1.1` was not `3.0`, and its summary
// keys had been renamed.

// Every classification decision this module can reach, so a caller never has to
// infer one from an empty issue list.
export const ArtifactExampleIssueKindSchema = z.enum([
  // The block declares no contract and is not a configuration example, so
  // nothing checks it. See "Why an untagged block fails" below.
  'undeclared',
  // The block's tag names no registered contract.
  'unknown-contract',
  // A `no-contract` declaration carries no usable reason.
  'unexplained-exemption',
  // The block declares a contract and is not valid JSON.
  'unparseable',
  // A key the contract cannot emit at that position.
  'unknown-key',
  // A `schemaVersion` that is not the literal the producer emits today. Kept
  // apart from `unknown-enum-value` because it is the first line of the example
  // a reader copies, so a wrong value there discredits the whole block —
  // NOT because anything branches on it. No code in this repository dispatches
  // on the value, which is why spec 06 withdrew the bump-on-every-change rule
  // and pinned every artifact at `"1.0"` while the product is unreleased.
  'stale-schema-version',
  // A value outside a closed enum (or a literal other than a discriminator's).
  'unknown-enum-value',
  // An object where the contract has an array, or the reverse. Reported because
  // the key walk cannot descend through a container it does not recognise, and
  // descending into nothing would pass silently.
  'shape-mismatch'
])

export const ArtifactExampleIssueSchema = z.strictObject({
  kind: ArtifactExampleIssueKindSchema,
  // Repository-relative, POSIX-separated, so a message is copy-pasteable on any
  // platform.
  path: z.string().min(1),
  // 1-based line of the block's OPENING fence.
  line: z.int().min(1),
  message: z.string().min(1)
})

export const ArtifactExampleCheckResultSchema = z.strictObject({
  // Fenced blocks whose info string starts with `json`, across every scanned
  // root. Re-derivable by a plain line scan, which is what makes an extractor
  // that quietly stops matching detectable.
  jsonBlockCount: z.int().min(0),
  // Of those, the ones that declared a contract and were walked against it.
  checkedExampleCount: z.int().min(0),
  // Blocks that declared, with a reason, that no contract describes them.
  exemptedBlockCount: z.int().min(0),
  // Blocks the configuration checker owns. Counted so this checker's own
  // accounting adds up to `jsonBlockCount` and a reader can see where each
  // block went.
  configBlockCount: z.int().min(0),
  issues: z.array(ArtifactExampleIssueSchema)
})

export type ArtifactExampleIssueKind = z.infer<
  typeof ArtifactExampleIssueKindSchema
>
export type ArtifactExampleIssue = z.infer<typeof ArtifactExampleIssueSchema>
export type ArtifactExampleCheckResult = z.infer<
  typeof ArtifactExampleCheckResultSchema
>

// THE DECLARATION MECHANISM: a tag in the fence's info string, after `json`.
//
//     ```json impact-report
//     ```json no-contract <why nothing describes this block>
//
// It is a fence tag rather than a preceding HTML comment or a registry keyed by
// file and heading, for three reasons.
//
// It CANNOT DRIFT FROM THE BLOCK. A comment marker is a separate line that a
// later edit can insert a block under, and a registry keyed by heading breaks
// the moment somebody renames the heading — both fail by silently pointing at
// the wrong block, which is the failure this check exists to stop.
//
// IT IS THE MECHANISM THAT IS ALREADY HERE. `config-example-checker.ts` already
// reads `json config` and `json not-config` from the same slot. A second way of
// saying the same kind of thing about the same fenced block would be two
// vocabularies for one decision.
//
// AN UNTAGGED BLOCK FAILS LOUDLY. Content classification is what the
// configuration checker can afford — a configuration example is recognisable
// from a top-level key. An artifact excerpt is not: `{ "path": …, "line": … }`
// could belong to six contracts, and a wrong guess validates against the wrong
// one. So every `json` block in the scanned roots must be ACCOUNTED FOR — a
// configuration example (which the sibling checker classifies by content and
// owns), a declared contract, or a declared exemption with a reason — and a
// block that is none of those is reported. That is what stops this check from
// quietly covering nothing: somebody adding an example does not have to know
// this mechanism exists, because CI tells them, names the block and lists the
// tags. The cost is paid once, on the blocks that were here when it landed.
const exemptionTag = 'no-contract'

// A reason short enough to be a shrug is not a reason. `no-contract x` would
// make the escape hatch a silent skip list with extra characters, which is
// exactly what this must not become.
const minimumExemptionReasonLength = 20

type ArtifactContract = {
  readonly schema: ZodType
  // Where a reader meets this artifact, for the failure message. A tag is only
  // useful if the message tells the next person which producer to open.
  readonly producedBy: string
}

/**
 * The artifact contracts a documented example may declare.
 *
 * Every entry is a REAL EXPORTED SCHEMA imported from the domain that produces
 * it, never a transcription: a contract that changes shape changes this check in
 * the same commit, with nothing to keep in step.
 *
 * Fragment contracts (`expected-finding`, `no-finding-zone`,
 * `removed-comment-disclosure-review`) are registered beside the whole-document
 * ones on purpose. A page frequently shows one element of a list, and the
 * alternative — a path syntax naming a position inside a parent contract — would
 * be a second addressing scheme for something the exports already name.
 *
 * SARIF IS DELIBERATELY ABSENT. It is a third-party format this repository does
 * not define: `sarif-validation.ts` asserts a handful of structural invariants
 * before writing, not a key set, so a `sarif` tag could only be backed by a
 * hand-written transcription of the OASIS schema — the one thing this module
 * refuses to hold. No page prints a SARIF document today; one that does must
 * declare `no-contract` and say so, which keeps the gap visible instead of
 * inventing an authority for it.
 */
export const artifactContracts: Readonly<Record<string, ArtifactContract>> = {
  'review-report': {
    schema: ReviewReportSchema,
    producedBy: 'the review report written to `report.json`'
  },
  'run-summary': {
    schema: RunSummarySchema,
    producedBy: 'the `run` block of a review report'
  },
  'run-index': {
    schema: RunIndexSchema,
    producedBy: 'the run index at `<artifactDir>/index.json`'
  },
  'review-comment': {
    schema: ReviewCommentDraftSchema,
    producedBy: 'a platform-neutral inline review comment draft'
  },
  baseline: {
    schema: BaselineFileSchema,
    producedBy: '`baseline write`'
  },
  // The CLI's own output. These four were the whole of this checker's exemption
  // list — nine examples across `README.md`, `docs/` and `skills/` that nothing
  // validated, though `scripts/github/` parses two of them — until the envelopes
  // gained exported contracts in `shared/contracts/cli/`.
  'review-stdout': {
    schema: ReviewStdoutEnvelopeSchema,
    producedBy: '`review` on stdout'
  },
  'baseline-write-stdout': {
    schema: BaselineWriteStdoutEnvelopeSchema,
    producedBy: '`baseline write` on stdout'
  },
  'cli-error': {
    schema: CliErrorEnvelopeSchema,
    producedBy: 'any failing command, on stderr'
  },
  'run-error': {
    schema: RunErrorArtifactSchema,
    producedBy: 'a failed run, at `<artifactDir>/error.json`'
  },
  'impact-report': {
    schema: ChangeImpactReferenceReportSchema,
    producedBy: '`impact check`'
  },
  'intent-report': {
    schema: IntentFulfilmentReportSchema,
    producedBy: '`intent check`'
  },
  'eval-report': {
    schema: EvalReportSchema,
    producedBy: '`eval run`'
  },
  'eval-slice-manifest': {
    schema: EvalSliceManifestSchema,
    producedBy: '`eval slice-manifest`'
  },
  'eval-case': {
    schema: EvalCaseSchema,
    producedBy: 'an entry of `eval/fixtures/sample-eval-cases.json`'
  },
  'eval-slice-case': {
    schema: EvalSliceCaseSchema,
    producedBy: 'a slice pack `slice.json`'
  },
  'expected-finding': {
    schema: ExpectedFindingSchema,
    producedBy: 'an `expectedFindings` entry of an evaluation case'
  },
  'no-finding-zone': {
    schema: ExpectedNoFindingZoneSchema,
    producedBy: 'an `expectedNoFindingZones` entry of an evaluation case'
  },
  'corpus-manifest': {
    schema: RealRepoCorpusManifestSchema,
    producedBy: 'a real-repository corpus `manifest.json`'
  },
  'corpus-case': {
    schema: RealRepoCorpusManifestSchema.shape.cases.element,
    producedBy: 'a case of a real-repository corpus manifest'
  },
  'removed-comment-disclosure-review': {
    schema: RemovedCommentDisclosureReviewSchema,
    producedBy: 'the disclosure judgement recorded on a corpus case'
  },
  'impact-corpus-manifest': {
    schema: ChangeImpactCorpusManifestSchema,
    producedBy: 'the change-impact corpus `manifest.json`'
  },
  'impact-corpus-case': {
    schema: ChangeImpactCorpusManifestSchema.shape.cases.element,
    producedBy: 'a case of the change-impact corpus manifest'
  }
}

export const artifactContractTags = Object.keys(artifactContracts).sort()

// Zod's internal node shape, read rather than reimplemented. Only the fields
// this walk needs are named; every schema class exposes its structure through
// `_zod.def` and there is no public accessor that covers unwrapping, unions and
// catchalls uniformly.
type SchemaDef = {
  readonly type: string
  readonly innerType?: ZodType
  readonly getter?: () => ZodType
  readonly in?: ZodType
  readonly shape?: Readonly<Record<string, ZodType>>
  readonly catchall?: ZodType
  readonly element?: ZodType
  readonly items?: readonly ZodType[]
  readonly rest?: ZodType
  readonly valueType?: ZodType
  readonly options?: readonly ZodType[]
  readonly discriminator?: string
  readonly entries?: Readonly<Record<string, string | number>>
  readonly values?: readonly unknown[]
  readonly left?: ZodType
  readonly right?: ZodType
}

const definitionOf = (schema: ZodType): SchemaDef =>
  (schema as unknown as { readonly _zod: { readonly def: SchemaDef } })._zod.def

// Wrappers that add a rule without adding or removing a key: unwrapping them
// leaves the shape the example has to match.
//
// A `pipe` is unwrapped to its INPUT side, which matters for the two evaluation
// case contracts: `EvalSliceCaseSchema` is a raw object plus a transform that
// derives tags, and a documented `slice.json` is the file an author writes, not
// the value the loader hands on.
const unwrapSchema = (schema: ZodType): ZodType => {
  let node = schema

  for (;;) {
    const def = definitionOf(node)

    if (def.type === 'lazy' && def.getter !== undefined) {
      node = def.getter()
      continue
    }

    if (def.type === 'pipe' && def.in !== undefined) {
      node = def.in
      continue
    }

    if (def.innerType === undefined) {
      return node
    }

    switch (def.type) {
      case 'optional':
      case 'nullable':
      case 'nonoptional':
      case 'default':
      case 'prefault':
      case 'catch':
      case 'readonly':
        node = def.innerType
        break
      default:
        return node
    }
  }
}

type Problem = {
  readonly kind: ArtifactExampleIssueKind
  readonly path: readonly string[]
  readonly message: string
}

const isPlainObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

// `(root)` rather than an empty string, so a message about the top level reads
// like a location instead of a missing one.
const describePath = (path: readonly string[]): string =>
  path.length === 0 ? '(root)' : path.join('.')

const describeValue = (value: unknown): string =>
  typeof value === 'string' ? `"${value}"` : String(value)

const shapeMismatch = (
  value: unknown,
  path: readonly string[],
  expected: string
): Problem => ({
  kind: 'shape-mismatch',
  path,
  message: `${describePath(path)} is ${Array.isArray(value) ? 'an array' : typeof value} in the example but ${expected} in the contract`
})

// The closed set a value at this position may take, or undefined when the
// position is not closed. A literal is a one-member closed set, which is why
// `schemaVersion` needs no special case in the walk.
const closedValuesOf = (node: ZodType): readonly unknown[] | undefined => {
  const def = definitionOf(node)

  if (def.type === 'enum' && def.entries !== undefined) {
    return Object.values(def.entries)
  }

  if (def.type === 'literal' && def.values !== undefined) {
    return def.values
  }

  return undefined
}

const walkValue = (
  value: unknown,
  schema: ZodType,
  path: readonly string[]
): readonly Problem[] => {
  // A null in an example says "this field can be empty here", which carries no
  // keys to check and no enum member to be wrong about.
  if (value === null || value === undefined) {
    return []
  }

  const node = unwrapSchema(schema)
  const def = definitionOf(node)
  const closedValues = closedValuesOf(node)

  if (closedValues !== undefined) {
    if (closedValues.includes(value)) {
      return []
    }

    const isSchemaVersion = path[path.length - 1] === 'schemaVersion'

    return [
      {
        kind: isSchemaVersion ? 'stale-schema-version' : 'unknown-enum-value',
        path,
        message: isSchemaVersion
          ? `${describePath(path)} is ${describeValue(value)} but the producer emits ${closedValues.map(describeValue).join(' or ')}`
          : `${describePath(path)} is ${describeValue(value)}, which is not one of ${closedValues.map(describeValue).join(', ')}`
      }
    ]
  }

  switch (def.type) {
    case 'object':
      return walkObject(value, def, path)
    case 'array':
      return def.element === undefined
        ? []
        : Array.isArray(value)
          ? value.flatMap((entry, index) =>
              walkValue(entry, def.element as ZodType, [...path, String(index)])
            )
          : [shapeMismatch(value, path, 'a list')]
    case 'tuple':
      return walkTuple(value, def, path)
    case 'record':
      return def.valueType === undefined
        ? []
        : isPlainObject(value)
          ? Object.entries(value).flatMap(([key, entry]) =>
              walkValue(entry, def.valueType as ZodType, [...path, key])
            )
          : [shapeMismatch(value, path, 'an object')]
    case 'union':
      return walkUnion(value, def, path)
    case 'intersection':
      return [
        ...(def.left === undefined ? [] : walkValue(value, def.left, path)),
        ...(def.right === undefined ? [] : walkValue(value, def.right, path))
      ]
    // Everything else is a leaf rule about a value — a length bound, a format, a
    // numeric range. Excerpts elide those deliberately (`"…"` for a timestamp,
    // `"<runId>"` for an identifier) and holding them to it is the strict parse
    // this check exists to avoid.
    default:
      return []
  }
}

const walkObject = (
  value: unknown,
  def: SchemaDef,
  path: readonly string[]
): readonly Problem[] => {
  const shape = def.shape

  if (shape === undefined) {
    return []
  }

  if (!isPlainObject(value)) {
    return [shapeMismatch(value, path, 'an object')]
  }

  // `strictObject` records a `never` catchall and a plain object records none;
  // both mean the contract has no room for a key it does not name. A real
  // catchall (a loose object) means any key is allowed, and the value is checked
  // against it instead.
  const catchall =
    def.catchall === undefined || definitionOf(def.catchall).type === 'never'
      ? undefined
      : def.catchall

  return Object.entries(value).flatMap(([key, entry]) => {
    const property = shape[key]

    if (property !== undefined) {
      return walkValue(entry, property, [...path, key])
    }

    if (catchall !== undefined) {
      return walkValue(entry, catchall, [...path, key])
    }

    return [
      {
        kind: 'unknown-key' as const,
        path: [...path, key],
        message: `${describePath([...path, key])} is not a key the contract has${
          Object.keys(shape).length === 0
            ? ''
            : ` (it has ${Object.keys(shape).join(', ')})`
        }`
      }
    ]
  })
}

const walkTuple = (
  value: unknown,
  def: SchemaDef,
  path: readonly string[]
): readonly Problem[] => {
  if (!Array.isArray(value)) {
    return [shapeMismatch(value, path, 'a list')]
  }

  const items = def.items ?? []

  return value.flatMap((entry, index) => {
    const position = items[index] ?? def.rest

    return position === undefined
      ? []
      : walkValue(entry, position, [...path, String(index)])
  })
}

// The member of a discriminated union a value declares itself to be, so an
// example is judged against the branch it claims rather than against whichever
// branch complains least.
const discriminatorAccepts = (
  option: ZodType,
  discriminator: string,
  value: unknown
): boolean => {
  const shape = definitionOf(unwrapSchema(option)).shape

  if (shape === undefined) {
    return false
  }

  const property = shape[discriminator]

  if (property === undefined) {
    return false
  }

  const closedValues = closedValuesOf(unwrapSchema(property))

  return closedValues === undefined || closedValues.includes(value)
}

const walkUnion = (
  value: unknown,
  def: SchemaDef,
  path: readonly string[]
): readonly Problem[] => {
  const options = def.options ?? []

  if (options.length === 0) {
    return []
  }

  if (def.discriminator !== undefined && isPlainObject(value)) {
    const discriminator = def.discriminator
    const declared = value[discriminator]
    const matching = options.filter((option) =>
      discriminatorAccepts(option, discriminator, declared)
    )
    const first = matching[0]

    if (first !== undefined && matching.length === 1) {
      return walkValue(value, first, path)
    }

    if (matching.length === 0) {
      return [
        {
          kind: 'unknown-enum-value',
          path: [...path, discriminator],
          message: `${describePath([...path, discriminator])} is ${describeValue(declared)}, which selects no member of the contract's union`
        }
      ]
    }
  }

  // An undiscriminated union: the example is fine if ANY member accepts every
  // key it shows. When none does, the shortest complaint is reported, because a
  // reader chasing one branch's objection has a chance and a merged list of all
  // of them has none.
  const attempts = options.map((option) => walkValue(value, option, path))
  const clean = attempts.find((problems) => problems.length === 0)

  return (
    clean ??
    attempts.reduce((best, problems) =>
      problems.length < best.length ? problems : best
    )
  )
}

/**
 * Walks one already-parsed example against one registered contract.
 *
 * Exported so the walk can be exercised on values whose defects are known: a
 * checker whose walk silently descends into nothing would otherwise report a
 * clean result for a repository full of stale examples.
 */
export const findArtifactExampleProblems = (
  value: unknown,
  contractTag: string
): readonly ArtifactExampleIssue[] => {
  const contract = artifactContracts[contractTag]

  if (contract === undefined) {
    return [
      {
        kind: 'unknown-contract',
        path: contractTag,
        line: 1,
        message: `No contract named ${contractTag}`
      }
    ]
  }

  return walkValue(value, contract.schema, []).map((problem) => ({
    kind: problem.kind,
    path: contractTag,
    line: 1,
    message: problem.message
  }))
}

const parseJson = (
  body: string
): { readonly value: unknown } | { readonly error: string } => {
  try {
    return { value: JSON.parse(body) as unknown }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'not valid JSON' }
  }
}

// The tag list is deliberately NOT in this message. It is the same twenty-two
// names on every undeclared block, and an author who guesses gets the list from
// `unknown-contract`, which is where a guess lands.
const undeclaredMessage = `Block declares no contract, and its content is not a configuration example, so nothing checks it. Tag the opening fence with the artifact it shows (\`\`\`json <contract-tag>) or, if no contract describes it, with \`\`\`json ${exemptionTag} <reason>. See docs/09-contributing/running-tests-and-checks.md.`

const checkBlock = (block: JsonBlock): readonly ArtifactExampleIssue[] => {
  const at = (
    kind: ArtifactExampleIssueKind,
    message: string
  ): ArtifactExampleIssue => ({
    kind,
    path: block.path,
    line: block.line,
    message
  })
  const parsed = parseJson(block.body)

  if ('error' in parsed) {
    return [
      at(
        'unparseable',
        `Block is tagged \`json ${block.marker}\` but is not valid JSON: ${parsed.error}. An artifact example must be a document a reader can paste into a parser; elide a value, not the syntax.`
      )
    ]
  }

  const contract = artifactContracts[block.marker]

  if (contract === undefined) {
    return [
      at(
        'unknown-contract',
        `Block is tagged \`json ${block.marker}\`, which names no contract. Use one of: ${artifactContractTags.join(', ')}.`
      )
    ]
  }

  return findArtifactExampleProblems(parsed.value, block.marker).map((issue) =>
    at(
      issue.kind,
      `Example of ${contract.producedBy} does not match its contract — ${issue.message}`
    )
  )
}

type FileResult = {
  readonly jsonBlockCount: number
  readonly checkedExampleCount: number
  readonly exemptedBlockCount: number
  readonly configBlockCount: number
  readonly issues: readonly ArtifactExampleIssue[]
}

/**
 * Accounts for every `json` block in one Markdown file.
 *
 * Each block leaves exactly one way: owned by the configuration checker, walked
 * against a declared contract, exempted with a reason, or reported.
 */
export const checkArtifactExamplesInFile = (file: TextFile): FileResult => {
  const blocks = extractJsonBlocks(file)
  const issues: ArtifactExampleIssue[] = []
  let checkedExampleCount = 0
  let exemptedBlockCount = 0
  let configBlockCount = 0

  for (const block of blocks) {
    if (block.marker === 'config' || block.marker === 'not-config') {
      configBlockCount += 1
      continue
    }

    if (block.marker.startsWith(exemptionTag)) {
      const reason = block.marker.slice(exemptionTag.length).trim()

      if (reason.length < minimumExemptionReasonLength) {
        issues.push({
          kind: 'unexplained-exemption',
          path: block.path,
          line: block.line,
          message: `Block is tagged \`json ${exemptionTag}\` without saying why no contract describes it. State the reason on the fence, so the next reader can tell a deliberate exemption from an unchecked example.`
        })
        continue
      }

      exemptedBlockCount += 1
      continue
    }

    if (block.marker === '') {
      const parsed = parseJson(block.body)

      // The configuration checker classifies its own examples by content and
      // validates them; a block it owns is accounted for and is not this
      // checker's business. Everything else that carries no tag is.
      if ('value' in parsed && isConfigExampleValue(parsed.value)) {
        configBlockCount += 1
        continue
      }

      issues.push({
        kind: 'undeclared',
        path: block.path,
        line: block.line,
        message: undeclaredMessage
      })
      continue
    }

    checkedExampleCount += 1
    issues.push(...checkBlock(block))
  }

  return {
    jsonBlockCount: blocks.length,
    checkedExampleCount,
    exemptedBlockCount,
    configBlockCount,
    issues
  }
}

// The roots whose Markdown a reader copies an artifact shape out of.
//
// `specs/` is here although `configScanRoots` deliberately excludes it: a spec
// quotes a configuration fragment to argue about it, but a spec that prints an
// artifact is printing the contract itself, and a stale one there misleads the
// next implementer rather than the next user. It holds no `json` block today, so
// the cost is zero and the coverage is there when one lands.
//
// Checked-in `*.json` FILES are deliberately not scanned. The configuration
// checker walks them because a configuration document had nothing else
// validating it; every artifact document this repository commits — the eval
// corpora manifests, the generated JSON Schemas — is already parsed by the
// loader or hydration test that owns it.
export const artifactScanRoots = [
  'README.md',
  'docs',
  'skills',
  'specs'
] as const

/**
 * Accounts for every `json` block under the scanned roots.
 *
 * There is no "found nothing" guard per root here, and the asymmetry with
 * `checkConfigExamples` is deliberate: a root may legitimately hold nothing but
 * configuration examples, so a per-root floor would fire on the normal case.
 * The exhaustiveness rule does that work instead — every block is accounted for
 * or reported — and `artifact-example-checker.test.ts` re-derives the block
 * count by a second, dumber method so an extractor that stops matching cannot
 * turn this green.
 */
export const checkArtifactExamples = async (input: {
  readonly repositoryRoot: string
  readonly roots?: readonly string[]
}): Promise<ArtifactExampleCheckResult> => {
  const roots = input.roots ?? artifactScanRoots
  const issues: ArtifactExampleIssue[] = []
  let jsonBlockCount = 0
  let checkedExampleCount = 0
  let exemptedBlockCount = 0
  let configBlockCount = 0

  for (const root of roots) {
    const files = (await collectTextFiles(input.repositoryRoot, root)).filter(
      (file) => file.path.endsWith('.md')
    )

    for (const file of files) {
      const fileResult = checkArtifactExamplesInFile(file)

      jsonBlockCount += fileResult.jsonBlockCount
      checkedExampleCount += fileResult.checkedExampleCount
      exemptedBlockCount += fileResult.exemptedBlockCount
      configBlockCount += fileResult.configBlockCount
      issues.push(...fileResult.issues)
    }
  }

  return ArtifactExampleCheckResultSchema.parse({
    jsonBlockCount,
    checkedExampleCount,
    exemptedBlockCount,
    configBlockCount,
    issues
  })
}

/** One human-readable line per issue, for a test failure message or a console. */
export const renderArtifactExampleIssues = (
  issues: readonly ArtifactExampleIssue[]
): string =>
  issues
    .map((issue) => `${issue.path}:${issue.line} [${issue.kind}] ${issue.message}`)
    .join('\n')
