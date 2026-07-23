import { readFile } from 'node:fs/promises'
import type { SkillsConfig } from '@purista/harness'
import { resolveExistingPathInsideRoot } from '../../../../platform/path-service.js'
import type { CodeReviewerConfig } from '../../../../shared/contracts/index.js'
import { redactText } from '../../../../shared/redaction/redactor.js'
import {
  sliceUtf8Bytes,
  utf8ByteLength
} from '../../../../shared/text/utf8-bytes.js'
import { createSkillIndex } from '../../../review-planning/index.js'
import {
  createTextContextLedgerEntry,
  type ContextLedgerEntry
} from '../../../review-planning/context-ledger.js'
import type { ReviewWorkflowInput } from '../../harness/workflow.js'

export type InstructionContextDocument =
  ReviewWorkflowInput['instructions'][number]
export type SkillContextDocument = ReviewWorkflowInput['skills'][number]

export type StaticReviewContext = {
  readonly instructions: readonly InstructionContextDocument[]
  readonly skills: readonly SkillContextDocument[]
  readonly skillDefinitions: SkillsConfig
  readonly skillIds: readonly string[]
  readonly contextLedger: readonly ContextLedgerEntry[]
}

const maxDocumentBytesFor = (content: string): number => utf8ByteLength(content)

const loadInstructionContexts = async (
  input: {
    readonly repositoryRoot: string
    readonly config: CodeReviewerConfig
    readonly ledger: ContextLedgerEntry[]
  }
): Promise<readonly InstructionContextDocument[]> => {
  const instructions: InstructionContextDocument[] = []

  for (const instructionPath of input.config.instructions.files) {
    const content = await readFile(
      await resolveExistingPathInsideRoot(input.repositoryRoot, instructionPath),
      'utf8'
    )
    const ledgerEntry = createTextContextLedgerEntry({
      kind: 'instruction',
      path: instructionPath,
      reason: 'instruction-context',
      text: content,
      maxBytes: maxDocumentBytesFor(content)
    })

    input.ledger.push(ledgerEntry)
    instructions.push({
      path: instructionPath,
      content: sliceUtf8Bytes(redactText(content), ledgerEntry.bytesIncluded),
      allowed: true,
      ledgerEntryId: ledgerEntry.id
    })
  }

  if (input.config.instructions.inline.trim().length > 0) {
    const inlineContent = input.config.instructions.inline
    const ledgerEntry = createTextContextLedgerEntry({
      kind: 'instruction',
      path: '.codereviewer/inline-instructions',
      reason: 'instruction-context',
      text: inlineContent,
      maxBytes: maxDocumentBytesFor(inlineContent)
    })

    input.ledger.push(ledgerEntry)
    instructions.push({
      path: '.codereviewer/inline-instructions',
      content: sliceUtf8Bytes(redactText(inlineContent), ledgerEntry.bytesIncluded),
      allowed: true,
      ledgerEntryId: ledgerEntry.id
    })
  }

  return instructions
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
    const ledgerEntry = createTextContextLedgerEntry({
      kind: 'skill',
      path: skill.path,
      reason: 'skill-context',
      text: content,
      maxBytes: maxDocumentBytesFor(content)
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
  const instructions = await loadInstructionContexts({
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
    instructions,
    skills: skillContext.skills,
    skillDefinitions: skillContext.skillDefinitions,
    skillIds: skillContext.skillIds,
    contextLedger
  }
}
