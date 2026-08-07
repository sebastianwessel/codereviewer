import { readFile } from 'node:fs/promises'
import type { SkillsConfig } from '@purista/harness'
import { resolveExistingPathInsideRoot } from '../../../../platform/path-service.js'
import type { CodeReviewerConfig } from '../../../../shared/contracts/index.js'
import { redactText } from '../../../../shared/redaction/redactor.js'
import {
  compileGlobMatchers,
  matchesAnyGlob
} from '../../../../shared/glob/glob-matcher.js'
import {
  sliceUtf8Bytes,
  utf8ByteLength
} from '../../../../shared/text/utf8-bytes.js'
import {
  createSkillIndex,
  createTextContextLedgerEntry,
  type ContextLedgerEntry
} from '../../../review-planning/index.js'
import type { ContextDocument } from '../../pipeline/agent-contracts.js'
import type { ReviewWorkflowInput } from '../../harness/workflow.js'

// The workflow's own instruction-document shape. Derived from the contract
// rather than restated so the two cannot drift; it is reached through
// `ContextDocument` now that instructions hang off a task instead of the run.
export type InstructionContextDocument = ContextDocument
export type SkillContextDocument = ReviewWorkflowInput['skills'][number]

// Per-document companion to `instructions`, keyed by the SAME `path` an
// `InstructionContextDocument` carries. Kept as a parallel structure rather
// than a field added to `InstructionContextDocument` itself, because that
// type is `ReviewWorkflowInput['instructions'][number]` — a shared workflow
// contract this module does not own the shape of, sent to both the discovery
// and refutation packets. A parallel, path-keyed lookup lets scoping be
// resolved entirely in this module without widening a contract several other
// call sites parse strictly.
//
// `scope` mirrors `InstructionFileEntry.scope` verbatim: `undefined` means
// repo-wide (today's behaviour, applies to every task); a non-empty glob list
// means "only a task whose files match" (see `instructionAppliesToFiles`).
// The inline instruction document has no entry here — a `Map` lookup miss and
// an explicit `undefined` scope resolve identically to "always applies", so
// one is not written for it (see `InstructionsConfigSchema`'s comment on why
// `inline` does not get scoping).
export type InstructionScope = {
  readonly path: string
  readonly scope?: readonly string[]
}

// Fail-safe, ANY-file semantics for a many-files task packet: an instruction
// applies to a packet the moment ONE reviewed file in it matches ONE scope
// pattern. See `InstructionFileEntrySchema`'s comment in config.schema.ts for
// why this direction (over `every file must match`) is the correct default —
// withheld guidance is invisible, over-included guidance is merely noise. An
// unscoped instruction (`scope === undefined`) always applies, unchanged from
// pre-scoping behaviour.
//
// Reuses the exact glob matcher `paths.include`/`paths.exclude` already
// compile repository-relative patterns with, so a scope pattern and a
// review-scope pattern are the same dialect, matched the same way, by the
// same code — not a second implementation that could drift from the first.
export const instructionAppliesToFiles = (
  scope: readonly string[] | undefined,
  files: readonly string[]
): boolean => {
  if (scope === undefined) {
    return true
  }

  const matchers = compileGlobMatchers(scope)
  return files.some((file) => matchesAnyGlob(file, matchers))
}

// A scoped instruction that does not match a given packet's files must be
// visible in the return value, not merely absent from `included` — an absent
// entry looks identical to "this instruction does not exist", and this
// project has a standing rule against a missing value producing a silently
// plausible answer. `skipped` is the disclosure: the caller (the packet
// assembler, once it selects instructions per task) is expected to record it
// on the context ledger with `decision: 'skipped'`, the same way any other
// deliberate omission is recorded.
export type SkippedInstructionSelection = {
  readonly path: string
  readonly scope: readonly string[]
}

export type InstructionSelection = {
  readonly included: readonly InstructionContextDocument[]
  readonly skipped: readonly SkippedInstructionSelection[]
}

// Filters a run's full instruction set down to the ones that apply to one
// task packet's files. `scopes` is `StaticReviewContext.instructionScopes`;
// `files` is the packet's reviewed paths (a task's file cluster, however task
// clustering produced it). Pure and side-effect free so it can be called once
// per task without re-touching the filesystem, redaction, or the ledger — all
// of that already happened once in `loadInstructionContexts`.
export const selectInstructionsForFiles = (
  instructions: readonly InstructionContextDocument[],
  scopes: readonly InstructionScope[],
  files: readonly string[]
): InstructionSelection => {
  const scopeByPath = new Map(
    scopes.map((entry) => [entry.path, entry.scope] as const)
  )
  const included: InstructionContextDocument[] = []
  const skipped: SkippedInstructionSelection[] = []

  for (const instruction of instructions) {
    const scope = scopeByPath.get(instruction.path)

    if (instructionAppliesToFiles(scope, files)) {
      included.push(instruction)
    } else if (scope !== undefined) {
      skipped.push({ path: instruction.path, scope })
    }
  }

  return { included, skipped }
}

export type StaticReviewContext = {
  readonly instructions: readonly InstructionContextDocument[]
  readonly instructionScopes: readonly InstructionScope[]
  readonly skills: readonly SkillContextDocument[]
  readonly skillDefinitions: SkillsConfig
  readonly skillIds: readonly string[]
  readonly contextLedger: readonly ContextLedgerEntry[]
}

// The budget is computed over the text the model will ACTUALLY receive, which is
// the redacted one. It used to be computed over the raw file and then applied to
// the redacted string, and redaction can LENGTHEN text -- a matched secret becomes
// `prefix + '[REDACTED]'`. So the tail of a model-facing instruction or SKILL.md
// could be cut while the ledger recorded `decision: 'included'` with
// `bytesIncluded === bytesConsidered`: a record asserting no loss while losing.
const maxDocumentBytesFor = (content: string): number => utf8ByteLength(content)

type InstructionContextLoadResult = {
  readonly instructions: readonly InstructionContextDocument[]
  readonly scopes: readonly InstructionScope[]
}

const loadInstructionContexts = async (
  input: {
    readonly repositoryRoot: string
    readonly config: CodeReviewerConfig
    readonly ledger: ContextLedgerEntry[]
  }
): Promise<InstructionContextLoadResult> => {
  const instructions: InstructionContextDocument[] = []
  const scopes: InstructionScope[] = []

  for (const fileEntry of input.config.instructions.files) {
    if (fileEntry.scope !== undefined) {
      // Compiled eagerly so an invalid pattern fails the run now, the same
      // way a missing instruction file does below, rather than silently
      // never matching once this scope is actually checked against a task's
      // files.
      compileGlobMatchers(fileEntry.scope)
      scopes.push({ path: fileEntry.path, scope: fileEntry.scope })
    }

    const content = await readFile(
      await resolveExistingPathInsideRoot(input.repositoryRoot, fileEntry.path),
      'utf8'
    )
    const redacted = redactText(content)
    const ledgerEntry = createTextContextLedgerEntry({
      kind: 'instruction',
      path: fileEntry.path,
      reason: 'instruction-context',
      text: redacted,
      maxBytes: maxDocumentBytesFor(redacted)
    })

    input.ledger.push(ledgerEntry)
    instructions.push({
      path: fileEntry.path,
      content: sliceUtf8Bytes(redacted, ledgerEntry.bytesIncluded),
      allowed: true,
      ledgerEntryId: ledgerEntry.id
    })
  }

  if (input.config.instructions.inline.trim().length > 0) {
    const redactedInline = redactText(input.config.instructions.inline)
    const ledgerEntry = createTextContextLedgerEntry({
      kind: 'instruction',
      path: '.codereviewer/inline-instructions',
      reason: 'instruction-context',
      text: redactedInline,
      maxBytes: maxDocumentBytesFor(redactedInline)
    })

    input.ledger.push(ledgerEntry)
    instructions.push({
      path: '.codereviewer/inline-instructions',
      content: sliceUtf8Bytes(redactedInline, ledgerEntry.bytesIncluded),
      allowed: true,
      ledgerEntryId: ledgerEntry.id
    })
  }

  return { instructions, scopes }
}

const loadSkillContexts = async (
  input: {
    readonly repositoryRoot: string
    readonly config: CodeReviewerConfig
    readonly ledger: ContextLedgerEntry[]
  }
): Promise<Pick<StaticReviewContext, 'skills' | 'skillDefinitions' | 'skillIds'>> => {
  if (!input.config.skills.enabled) {
    return {
      skills: [],
      skillDefinitions: {},
      skillIds: []
    }
  }

  const skillIndex = await createSkillIndex({
    repositoryRoot: input.repositoryRoot,
    directories: input.config.skills.directories
  })
  const skills: SkillContextDocument[] = []
  const skillDefinitions: SkillsConfig = {}

  for (const skill of skillIndex.skills) {
    const content = await readFile(
      await resolveExistingPathInsideRoot(input.repositoryRoot, skill.path),
      'utf8'
    )
    const redacted = redactText(content)
    const ledgerEntry = createTextContextLedgerEntry({
      kind: 'skill',
      path: skill.path,
      reason: 'skill-context',
      text: redacted,
      maxBytes: maxDocumentBytesFor(redacted)
    })

    input.ledger.push(ledgerEntry)
    skills.push({
      name: skill.id,
      path: skill.path,
      directory: skill.directory,
      contentHash: skill.contentHash,
      allowed: true
    })
    skillDefinitions[skill.id] = {
      directory: skill.absoluteDirectory,
      validationMode: 'strict',
      trust: 'project',
      source: 'repository'
    }
  }

  return {
    skills,
    skillDefinitions,
    skillIds: skillIndex.skills.map((skill) => skill.id)
  }
}

export const loadStaticReviewContext = async (
  input: {
    readonly repositoryRoot: string
    readonly config: CodeReviewerConfig
  }
): Promise<StaticReviewContext> => {
  const contextLedger: ContextLedgerEntry[] = []
  const instructionContext = await loadInstructionContexts({
    repositoryRoot: input.repositoryRoot,
    config: input.config,
    ledger: contextLedger
  })
  const skillContext = await loadSkillContexts({
    repositoryRoot: input.repositoryRoot,
    config: input.config,
    ledger: contextLedger
  })

  return {
    instructions: instructionContext.instructions,
    instructionScopes: instructionContext.scopes,
    skills: skillContext.skills,
    skillDefinitions: skillContext.skillDefinitions,
    skillIds: skillContext.skillIds,
    contextLedger
  }
}
