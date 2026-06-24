import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'vitest'
import type {
  JsonValue,
  Logger,
  ModelProvider,
  ObjectRequest,
  ObjectResponse
} from '@purista/harness'
import {
  createModelBackedReviewHarness,
  isReviewTaskExecutionError,
  runModelBackedReviewWorkflow
} from './harness/workflow.js'
import {
  CodeReviewerConfigSchema
} from '../../shared/contracts/index.js'
import {
  isReviewRunFailedError,
  runReview
} from './run/review-runner.js'
import { renderGithubReviewComments } from '../reporting/github-review-comments.js'
import { parseGitDiffMaps } from '../repository-intake/index.js'

const configHash =
  '1111111111111111111111111111111111111111111111111111111111111111'

type CapturedLogRecord = {
  readonly level: string
  readonly message: string
  readonly fields?: Record<string, unknown>
}

const createCapturingLogger = (): {
  readonly logger: Logger
  readonly records: CapturedLogRecord[]
} => {
  const records: CapturedLogRecord[] = []
  const capture =
    (level: string) =>
    (message: string, fields?: Record<string, unknown>): void => {
      records.push({ level, message, ...(fields === undefined ? {} : { fields }) })
    }

  const logger: Logger = {
    trace: capture('trace'),
    debug: capture('debug'),
    info: capture('info'),
    warn: capture('warn'),
    error: capture('error'),
    fatal: capture('fatal'),
    child: () => logger
  }

  return { logger, records }
}

const createMountedSkill = async (): Promise<{
  readonly root: string
  readonly directory: string
}> => {
  const root = join(tmpdir(), `codereviewer-mounted-skill-${crypto.randomUUID()}`)
  const directory = join(root, 'secure-review')

  await mkdir(directory, { recursive: true })
  await writeFile(
    join(directory, 'SKILL.md'),
    [
      '---',
      'name: secure-review',
      'description: Review code with secure defaults.',
      '---',
      '',
      '# Secure Review',
      'Do not inline this mounted skill body.'
    ].join('\n')
  )

  return { root, directory }
}

class EmptyFindingProvider implements ModelProvider {
  readonly id = 'empty'
  readonly genAiSystem = 'scripted'
  readonly requests: ObjectRequest[] = []

  async object<T extends JsonValue = JsonValue>(
    req: ObjectRequest<T>
  ): Promise<ObjectResponse<T>> {
    this.requests.push(req)
    return {
      object: { findings: [] } as unknown as T,
      finishReason: 'stop',
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2
      }
    }
  }
}

class FailingSecondTaskProvider implements ModelProvider {
  readonly id = 'failing-second-task'
  readonly genAiSystem = 'scripted'
  readonly requests: ObjectRequest[] = []

  async object<T extends JsonValue = JsonValue>(
    req: ObjectRequest<T>
  ): Promise<ObjectResponse<T>> {
    this.requests.push(req)

    if (this.requests.length === 2) {
      throw new Error('provider failed with sk-proj-secret-value')
    }

    return {
      object: { findings: [] } as unknown as T,
      finishReason: 'stop',
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2
      }
    }
  }
}

class HangingProvider implements ModelProvider {
  readonly id = 'hanging'
  readonly genAiSystem = 'scripted'
  readonly requests: ObjectRequest[] = []

  async object<T extends JsonValue = JsonValue>(
    req: ObjectRequest<T>
  ): Promise<ObjectResponse<T>> {
    this.requests.push(req)

    await new Promise<never>((_resolve, reject) => {
      req.signal.addEventListener(
        'abort',
        () => reject(req.signal.reason ?? new Error('provider aborted')),
        { once: true }
      )
    })

    throw new Error('provider did not receive an abort signal')
  }
}

class ObservedConcurrencyProvider implements ModelProvider {
  readonly id = 'observed-concurrency'
  readonly genAiSystem = 'scripted'
  activeRequests = 0
  maxActiveRequests = 0
  readonly requests: ObjectRequest[] = []

  async object<T extends JsonValue = JsonValue>(
    req: ObjectRequest<T>
  ): Promise<ObjectResponse<T>> {
    this.requests.push(req)
    this.activeRequests += 1
    this.maxActiveRequests = Math.max(
      this.maxActiveRequests,
      this.activeRequests
    )

    try {
      await new Promise((resolve) => setTimeout(resolve, 20))

      return {
        object: { findings: [] } as unknown as T,
        finishReason: 'stop',
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2
        }
      }
    } finally {
      this.activeRequests -= 1
    }
  }
}

const isFindingRefutationRequest = (req: ObjectRequest): boolean => {
  const schema = req.schema

  return (
    typeof schema === 'object' &&
    schema !== null &&
    'properties' in schema &&
    typeof schema.properties === 'object' &&
    schema.properties !== null &&
    'verdict' in schema.properties &&
    'rationaleSummary' in schema.properties
  )
}

const isFindingInvestigationRequest = (req: ObjectRequest): boolean => {
  const schema = req.schema

  return (
    typeof schema === 'object' &&
    schema !== null &&
    'properties' in schema &&
    typeof schema.properties === 'object' &&
    schema.properties !== null &&
    'verdict' in schema.properties &&
    'rationaleSummary' in schema.properties &&
    'evidenceIds' in schema.properties
  )
}

const isFindingRefutationCheckRequest = (req: ObjectRequest): boolean =>
  isFindingRefutationRequest(req) && !isFindingInvestigationRequest(req)

const provedFindingEvidence = (): Record<string, JsonValue> => ({
  changedBehavior: 'The changed branch returns the wrong value.',
  executionOrDataPath: 'The reviewed code path reaches the changed branch.',
  violatedInvariant: 'The branch must preserve the expected return contract.',
  impact: 'Callers can receive an incorrect result.',
  introducedByChange: 'The defect is located in the reviewed diff.',
  contradictionChecks: ['No contradiction was found in the reviewed context.'],
  fixDirection: 'Restore the expected return value on the changed branch.'
})

const provedFindingResponse = <T extends JsonValue>(
  rationaleSummary = 'Refutation proved the model finding with the provided task evidence.'
): ObjectResponse<T> => ({
  object: {
    verdict: 'proved',
    rationaleSummary,
    ...provedFindingEvidence()
  } as unknown as T,
  finishReason: 'stop',
  usage: {
    inputTokens: 1,
    outputTokens: 1,
    totalTokens: 2
  }
})

class RollingQueueProvider implements ModelProvider {
  readonly id = 'rolling-queue'
  readonly genAiSystem = 'scripted'
  activeRequests = 0
  maxActiveRequests = 0
  eventSequence = 0
  readonly starts: number[] = []
  readonly completions: number[] = []
  readonly requests: ObjectRequest[] = []

  async object<T extends JsonValue = JsonValue>(
    req: ObjectRequest<T>
  ): Promise<ObjectResponse<T>> {
    const index = this.requests.length
    this.requests.push(req)
    this.starts[index] = this.eventSequence
    this.eventSequence += 1
    this.activeRequests += 1
    this.maxActiveRequests = Math.max(
      this.maxActiveRequests,
      this.activeRequests
    )

    try {
      await new Promise((resolve) =>
        setTimeout(resolve, index === 0 ? 80 : 10)
      )
      this.completions[index] = this.eventSequence
      this.eventSequence += 1

      return {
        object: { findings: [] } as unknown as T,
        finishReason: 'stop',
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2
        }
      }
    } finally {
      this.activeRequests -= 1
    }
  }
}

class SupportedFindingProvider implements ModelProvider {
  readonly id = 'supported'
  readonly genAiSystem = 'scripted'

  async object<T extends JsonValue = JsonValue>(
    req: ObjectRequest<T>
  ): Promise<ObjectResponse<T>> {
    if (isFindingRefutationRequest(req)) {
      return provedFindingResponse<T>()
    }

    return {
      object: {
        findings: [
          {
            category: 'bug',
            severity: 'high',
            title: 'Changed branch returns wrong value',
            description:
              'The reviewed task evidence shows the changed branch can return the wrong value.',
            path: 'src/app.ts',
            startLine: 4,
            evidenceIds: ['ev_diff1'],
            fixSummary: 'Return the expected value from the changed branch.'
          }
        ]
      } as unknown as T,
      finishReason: 'stop',
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2
      }
    }
  }
}

class InvalidLineFindingProvider implements ModelProvider {
  readonly id = 'invalid-line'
  readonly genAiSystem = 'scripted'

  async object<T extends JsonValue = JsonValue>(
    req: ObjectRequest<T>
  ): Promise<ObjectResponse<T>> {
    if (isFindingRefutationRequest(req)) {
      return provedFindingResponse<T>()
    }

    return {
      object: {
        findings: [
          {
            category: 'bug',
            severity: 'high',
            title: 'Impossible line finding',
            description:
              'The model pointed at a line outside the reviewed source file.',
            path: 'src/app.ts',
            startLine: 99,
            evidenceIds: ['ev_diff1'],
            fixSummary: 'Use a valid reviewed source line before commenting.'
          }
        ]
      } as unknown as T,
      finishReason: 'stop',
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2
      }
    }
  }
}

class ContextOnlyFindingProvider implements ModelProvider {
  readonly id = 'context-only-finding'
  readonly genAiSystem = 'scripted'
  readonly requests: ObjectRequest[] = []

  async object<T extends JsonValue = JsonValue>(
    req: ObjectRequest<T>
  ): Promise<ObjectResponse<T>> {
    this.requests.push(req)

    if (isFindingRefutationRequest(req)) {
      return provedFindingResponse<T>()
    }

    return {
      object: {
        findings: [
          {
            category: 'bug',
            severity: 'high',
            title: 'Context-only branch returns wrong value',
            description:
              'The reviewed source context shows the changed branch returns the wrong value.',
            path: 'src/app.ts',
            startLine: 4,
            fixSummary: 'Return the expected value from the changed branch.'
          }
        ]
      } as unknown as T,
      finishReason: 'stop',
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2
      }
    }
  }
}

class EvidenceOptionalFindingProvider implements ModelProvider {
  readonly id = 'evidence-optional-finding'
  readonly genAiSystem = 'scripted'
  readonly requests: ObjectRequest[] = []

  async object<T extends JsonValue = JsonValue>(
    req: ObjectRequest<T>
  ): Promise<ObjectResponse<T>> {
    this.requests.push(req)

    if (isFindingRefutationRequest(req)) {
      return {
        object: {
          verdict: 'proved',
          rationaleSummary:
            'Refutation proved the finding from reviewed context even without task evidence.'
        } as unknown as T,
        finishReason: 'stop',
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2
        }
      }
    }

    return {
      object: {
        findings: [
          {
            category: 'bug',
            severity: 'high',
            title: 'Context proves a wrong return value',
            description:
              'The reviewed context proves the changed branch returns the wrong value.',
            path: 'src/app.ts',
            startLine: 4,
            fixSummary: 'Return the expected value from the changed branch.'
          }
        ]
      } as unknown as T,
      finishReason: 'stop',
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2
      }
    }
  }
}

class EvidenceCitingFindingProvider implements ModelProvider {
  readonly id = 'evidence-citing-finding'
  readonly genAiSystem = 'scripted'
  readonly requests: ObjectRequest[] = []

  constructor(
    private readonly input: {
      readonly evidenceId: string
      readonly title: string
      readonly description: string
      readonly category?: 'bug' | 'security' | 'performance' | 'maintainability'
    }
  ) {}

  async object<T extends JsonValue = JsonValue>(
    req: ObjectRequest<T>
  ): Promise<ObjectResponse<T>> {
    this.requests.push(req)

    if (isFindingRefutationRequest(req)) {
      return provedFindingResponse<T>(
        'Refutation check confirmed the model finding from cited deterministic evidence.'
      )
    }

    return {
      object: {
        findings: [
          {
            category: this.input.category ?? 'bug',
            severity: 'high',
            title: this.input.title,
            description: this.input.description,
            path: 'src/app.ts',
            startLine: 4,
            evidenceIds: [this.input.evidenceId],
            fixSummary: 'Apply the deterministic tool recommendation.'
          }
        ]
      } as unknown as T,
      finishReason: 'stop',
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2
      }
    }
  }
}

class UncertainRefutationProvider implements ModelProvider {
  readonly id = 'uncertain-refutation'
  readonly genAiSystem = 'scripted'
  readonly requests: ObjectRequest[] = []

  async object<T extends JsonValue = JsonValue>(
    req: ObjectRequest<T>
  ): Promise<ObjectResponse<T>> {
    this.requests.push(req)

    if (isFindingRefutationRequest(req)) {
      return {
        object: {
          verdict: 'needs-more-evidence',
          rationaleSummary:
            'Refutation could not fully prove the finding but did not identify it as refuted.'
        } as unknown as T,
        finishReason: 'stop',
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2
        }
      }
    }

    return {
      object: {
        findings: [
          {
            category: 'security',
            severity: 'high',
            title: 'Backup code reuse may bypass one-time semantics',
            description:
              'The reviewed context suggests concurrent backup code use could reuse the same code.',
            path: 'src/app.ts',
            startLine: 4,
            fixSummary: 'Make backup code consumption atomic.'
          }
        ]
      } as unknown as T,
      finishReason: 'stop',
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2
      }
    }
  }
}

class BackupCodeRaceRefutationProvider implements ModelProvider {
  readonly id = 'backup-code-race-refutation'
  readonly genAiSystem = 'scripted'
  readonly requests: ObjectRequest[] = []

  async object<T extends JsonValue = JsonValue>(
    req: ObjectRequest<T>
  ): Promise<ObjectResponse<T>> {
    this.requests.push(req)

    if (isFindingRefutationCheckRequest(req)) {
      const instructionText = req.messages
        .map((message) => String(message.content))
        .join('\n')
      const validatesReadModifyWriteRace = instructionText.includes(
        'Do not require proof of actual concurrent requests when reviewContext shows a non-atomic read-modify-write flow on shared mutable state.'
      )

      return {
        object: {
          verdict: validatesReadModifyWriteRace
            ? 'proved'
            : 'needs-more-evidence',
          rationaleSummary: validatesReadModifyWriteRace
            ? 'The provided context shows backup codes are decrypted, searched, mutated in memory, and written back with prisma.user.update without an atomic conditional update.'
            : 'The refutation check required runtime evidence of concurrent requests before proving the race.'
        } as unknown as T,
        finishReason: 'stop',
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2
        }
      }
    }

    return {
      object: {
        findings: [
          {
            category: 'security',
            severity: 'high',
            title: 'Backup code can be consumed twice by concurrent logins',
            description:
              'The handler decrypts backupCodes, finds the submitted code, mutates the array in memory, then writes the encrypted array back; concurrent requests can both pass before either update lands.',
            path: 'src/auth.ts',
            startLine: 6,
            fixSummary:
              'Consume backup codes with an atomic conditional update or transaction.'
          }
        ]
      } as unknown as T,
      finishReason: 'stop',
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2
      }
    }
  }
}

class RefutedFindingProvider implements ModelProvider {
  readonly id = 'refuted-finding'
  readonly genAiSystem = 'scripted'
  readonly requests: ObjectRequest[] = []

  async object<T extends JsonValue = JsonValue>(
    req: ObjectRequest<T>
  ): Promise<ObjectResponse<T>> {
    this.requests.push(req)

    if (isFindingRefutationCheckRequest(req)) {
      return {
        object: {
          verdict: 'refuted',
          rationaleSummary:
            'Refutation judged the model finding unsupported by the provided context.'
        } as unknown as T,
        finishReason: 'stop',
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2
        }
      }
    }

    return {
      object: {
        findings: [
          {
            category: 'security',
            severity: 'medium',
            title: 'Speculative backup-code storage concern',
            description:
              'The model raised a concrete-looking concern without enough context.',
            path: 'src/app.ts',
            startLine: 2,
            fixSummary: 'Inspect the storage format before making a schema change.'
          }
        ]
      } as unknown as T,
      finishReason: 'stop',
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2
      }
    }
  }
}

class MultiPathRefutationContextProvider implements ModelProvider {
  readonly id = 'multi-path-refutation-context'
  readonly genAiSystem = 'scripted'
  readonly requests: ObjectRequest[] = []

  async object<T extends JsonValue = JsonValue>(
    req: ObjectRequest<T>
  ): Promise<ObjectResponse<T>> {
    this.requests.push(req)

    if (isFindingRefutationRequest(req)) {
      return provedFindingResponse<T>(
        'Refutation proved the model finding using the full originating task context.'
      )
    }

    return {
      object: {
        findings: [
          {
            category: 'bug',
            severity: 'high',
            title: 'Cross-file state update can go stale',
            description:
              'The reviewed multi-file task context shows the changed caller can use stale helper state.',
            path: 'src/app.ts',
            startLine: 3,
            fixSummary: 'Read the latest helper state before updating.'
          }
        ]
      } as unknown as T,
      finishReason: 'stop',
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2
      }
    }
  }
}

class RefutationFailureProvider implements ModelProvider {
  readonly id = 'refutation-failure'
  readonly genAiSystem = 'scripted'
  readonly requests: ObjectRequest[] = []

  async object<T extends JsonValue = JsonValue>(
    req: ObjectRequest<T>
  ): Promise<ObjectResponse<T>> {
    this.requests.push(req)

    if (isFindingRefutationCheckRequest(req)) {
      throw new Error('Agent output refutation failed.')
    }

    return {
      object: {
        findings: [
          {
            category: 'maintainability',
            severity: 'low',
            title: 'Speculative low-value concern',
            description:
              'The model raised a concern that still needs refutation-check confirmation.',
            path: 'src/app.ts',
            startLine: 1
          }
        ]
      } as unknown as T,
      finishReason: 'stop',
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2
      }
    }
  }
}

class OutsideChangedLinesProvider implements ModelProvider {
  readonly id = 'out-of-diff-scope'
  readonly genAiSystem = 'scripted'
  readonly requests: ObjectRequest[] = []

  async object<T extends JsonValue = JsonValue>(
    req: ObjectRequest<T>
  ): Promise<ObjectResponse<T>> {
    this.requests.push(req)

    if (isFindingRefutationRequest(req)) {
      return provedFindingResponse<T>()
    }

    return {
      object: {
        findings: [
          {
            category: 'bug',
            severity: 'medium',
            title: 'Defect exposed elsewhere in the changed file',
            description:
              'The model raised a concern in the changed file but outside the exact changed lines.',
            path: 'src/app.ts',
            startLine: 10
          }
        ]
      } as unknown as T,
      finishReason: 'stop',
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2
      }
    }
  }
}

class MalformedSuggestionProvider implements ModelProvider {
  readonly id = 'malformed-suggestion'
  readonly genAiSystem = 'scripted'
  readonly requests: ObjectRequest[] = []

  async object<T extends JsonValue = JsonValue>(
    req: ObjectRequest<T>
  ): Promise<ObjectResponse<T>> {
    this.requests.push(req)

    if (isFindingRefutationRequest(req)) {
      return provedFindingResponse<T>()
    }

    return {
      object: {
        findings: [
          {
            category: { label: 'style' },
            severity: 'medium',
            title: 'Invalid category should be dropped',
            description: 'This malformed suggestion must not fail the task.',
            path: 'src/app.ts',
            startLine: 1
          },
          {
            category: 'bug',
            severity: 'high',
            title: 'Valid finding survives malformed sibling',
            description:
              'The valid suggestion should still be converted and proved.',
            path: 'src/app.ts',
            startLine: 1
          }
        ]
      } as unknown as T,
      finishReason: 'stop',
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2
      }
    }
  }
}

class AliasedSuggestionProvider implements ModelProvider {
  readonly id = 'aliased-suggestion'
  readonly genAiSystem = 'scripted'
  readonly requests: ObjectRequest[] = []

  async object<T extends JsonValue = JsonValue>(
    req: ObjectRequest<T>
  ): Promise<ObjectResponse<T>> {
    this.requests.push(req)

    if (isFindingRefutationRequest(req)) {
      return provedFindingResponse<T>()
    }

    return {
      object: {
        findings: [
          {
            category: 'Bug',
            severity: 'HIGH',
            title: 'Aliased suggestion should survive parsing',
            description:
              'The provider returned common field and enum variants for a valid finding.',
            path: 'src/app.ts',
            lineNumber: '1',
            fix_summary: 'Normalize model suggestion aliases before admission.'
          }
        ]
      } as unknown as T,
      finishReason: 'stop',
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2
      }
    }
  }
}

class NamingAliasSuggestionProvider implements ModelProvider {
  readonly id = 'naming-alias-suggestion'
  readonly genAiSystem = 'scripted'
  readonly requests: ObjectRequest[] = []

  async object<T extends JsonValue = JsonValue>(
    req: ObjectRequest<T>
  ): Promise<ObjectResponse<T>> {
    this.requests.push(req)

    if (isFindingRefutationRequest(req)) {
      return provedFindingResponse<T>()
    }

    return {
      object: {
        findings: [
          {
            category: 'naming',
            severity: 'low',
            title: 'Default export name does not match the file name',
            description:
              'The provider returned a common naming category alias for a concrete component/file mismatch.',
            path: 'src/BackupCode.tsx',
            startLine: 7
          }
        ]
      } as unknown as T,
      finishReason: 'stop',
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2
      }
    }
  }
}

class StaticContractSpeculationProvider implements ModelProvider {
  readonly id = 'static-contract-speculation'
  readonly genAiSystem = 'scripted'
  readonly requests: ObjectRequest[] = []

  async object<T extends JsonValue = JsonValue>(
    req: ObjectRequest<T>
  ): Promise<ObjectResponse<T>> {
    this.requests.push(req)

    if (isFindingRefutationRequest(req)) {
      const instructionText = req.messages
        .map((message) => String(message.content))
        .join('\n')
      const rejectsStaticContractSpeculation = instructionText.includes(
        'violating declared static types, function signatures, schemas, or documented contracts'
      )

      return {
        object: {
          verdict: rejectsStaticContractSpeculation
            ? 'refuted'
            : 'proved',
          rationaleSummary: rejectsStaticContractSpeculation
            ? 'The candidate depends on an untyped caller passing null or undefined to a TypeScript function whose declared input type is string.'
            : 'Refutation treated the hypothetical untyped caller as enough impact evidence.'
        } as unknown as T,
        finishReason: 'stop',
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2
        }
      }
    }

    return {
      object: {
        findings: [
          {
            category: 'maintainability',
            severity: 'low',
            title:
              'formatLabel can throw if called from untyped JavaScript with null or undefined',
            description:
              'The function assumes callers pass a string, so an untyped JS caller could throw at runtime.',
            path: 'src/format.ts',
            startLine: 1,
            fixSummary: 'Guard the input before calling string methods.'
          }
        ]
      } as unknown as T,
      finishReason: 'stop',
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2
      }
    }
  }
}

class StructuredFixProvider implements ModelProvider {
  readonly id = 'structured-fix'
  readonly genAiSystem = 'scripted'

  async object<T extends JsonValue = JsonValue>(
    req: ObjectRequest<T>
  ): Promise<ObjectResponse<T>> {
    if (isFindingRefutationRequest(req)) {
      return {
        object: {
          verdict: 'proved',
          rationaleSummary:
            'Refutation proved the model finding with the provided task evidence.',
          fixSummary: 'Return the expected value from the changed branch.',
          fixEdits: [
            {
              path: 'src/app.ts',
              startLine: 4,
              endLine: 4,
              replacement: 'return expectedValue',
              description: 'Replace the incorrect branch return value.'
            }
          ]
        } as unknown as T,
        finishReason: 'stop',
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2
        }
      }
    }

    return {
      object: {
        findings: [
          {
            category: 'bug',
            severity: 'high',
            title: 'Changed branch returns wrong value',
            description:
              'The reviewed task evidence shows the changed branch can return the wrong value.',
            path: 'src/app.ts',
            startLine: 4,
            evidenceIds: ['ev_diff1'],
            fixSummary: 'Return the expected value from the changed branch.'
          }
        ]
      } as unknown as T,
      finishReason: 'stop',
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2
      }
    }
  }
}

class ProofPendingModelFindingProvider implements ModelProvider {
  readonly id = 'proof-pending-model-finding'
  readonly genAiSystem = 'scripted'
  readonly requests: ObjectRequest[] = []

  async object<T extends JsonValue = JsonValue>(
    req: ObjectRequest<T>
  ): Promise<ObjectResponse<T>> {
    this.requests.push(req)

    if (this.requests.length === 1) {
      return {
        object: {
          findings: [
            {
              category: 'bug',
              severity: 'high',
              title: 'Changed branch returns wrong value',
              description:
                'The reviewed task evidence suggests the changed branch can return the wrong value.',
              path: 'src/app.ts',
              startLine: 4,
              evidenceIds: ['ev_diff1'],
              fixSummary: 'Return the expected value from the changed branch.'
            }
          ]
        } as unknown as T,
        finishReason: 'stop',
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2
        }
      }
    }

    return {
      object: {
        verdict: 'needs-more-evidence',
        rationaleSummary:
          'The available context does not prove the changed branch is reachable.'
      } as unknown as T,
      finishReason: 'stop',
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2
      }
    }
  }
}

class ProvedModelFindingProvider implements ModelProvider {
  readonly id = 'proved-model-finding'
  readonly genAiSystem = 'scripted'
  readonly requests: ObjectRequest[] = []

  async object<T extends JsonValue = JsonValue>(
    req: ObjectRequest<T>
  ): Promise<ObjectResponse<T>> {
    this.requests.push(req)

    if (this.requests.length === 1) {
      return {
        object: {
          findings: [
            {
              category: 'bug',
              severity: 'high',
              title: 'Changed branch returns wrong value',
              description:
                'The reviewed task evidence suggests the changed branch can return the wrong value.',
              path: 'src/app.ts',
              startLine: 4,
              evidenceIds: ['ev_diff1'],
              fixSummary: 'Return the expected value from the changed branch.'
            }
          ]
        } as unknown as T,
        finishReason: 'stop',
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2
        }
      }
    }

    return {
      object: {
        verdict: 'proved',
        rationaleSummary:
          'Refutation proved the changed branch returns the wrong value when the caller passes the reviewed input.',
        changedBehavior:
          'The changed branch returns actualValue instead of expectedValue.',
        executionOrDataPath:
          'The reviewed caller path reaches the changed return statement with the reviewed input.',
        violatedInvariant:
          'The branch must return expectedValue for callers of the reviewed path.',
        impact: 'Callers receive actualValue where expectedValue is required.',
        introducedByChange:
          'The incorrect return statement is in the reviewed src/app.ts diff.',
        contradictionChecks: [
          'The reviewed context defines expectedValue before the changed return.'
        ],
        fixDirection: 'Return expectedValue from the changed branch.',
        fixSummary:
          'Return the expected value from the changed branch after validating callers.',
        fixEdits: [
          {
            path: 'src/app.ts',
            startLine: 4,
            endLine: 4,
            replacement: 'return expectedValue',
            description: 'Use the value expected by callers.'
          }
        ]
      } as unknown as T,
      finishReason: 'stop',
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2
      }
    }
  }
}

describe('review workflow', () => {
  test('provider-backed workflow keeps support-signal seed candidates artifact-only when the model returns none', async () => {
    const provider = new EmptyFindingProvider()
    const harness = createModelBackedReviewHarness({
      modelAlias: {
        provider,
        model: 'empty',
        capabilities: ['object']
      }
    })

    const result = await runModelBackedReviewWorkflow({
      harness,
      sessionId: 'test-session',
      input: {
        runId: 'test-run',
        reviewedPaths: ['src/app.ts'],
        evidence: [
          {
            id: 'ev_diag1',
            kind: 'diagnostic',
            summary: 'Syntax parse diagnostic.',
            location: {
              path: 'src/app.ts',
              startLine: 1,
              side: 'file'
            },
            source: 'typescript-support-signal',
            contentHash:
              '2222222222222222222222222222222222222222222222222222222222222222',
            redactionApplied: true
          }
        ],
        candidates: [
          {
            id: 'cand_diag1',
            taskId: 'task_diag1',
            category: 'bug',
            severity: 'high',
            title: 'Parse diagnostic blocks reliable review',
            description:
              'Syntax parse diagnostic reported by typescript-support-signal.',
            location: {
              path: 'src/app.ts',
              startLine: 1,
              side: 'file'
            },
            evidenceIds: ['ev_diag1'],
            proposedBy: 'typescript-support-signal',
            fixProposal: {
              summary: 'Fix the syntax issue and rerun review.',
              evidenceIds: ['ev_diag1'],
              safety: 'manual-review'
            }
          }
        ],
        instructions: [],
        skills: [],
        reviewContext: [
          {
            kind: 'support-signal-output',
            content: '{"diagnostics":1}',
            ledgerEntryId: 'ctx_222222222222222222222222'
          }
        ],
        baselineConfigured: false,
        provenance: {
          reviewer: 'review-agent',
          modelProvider: 'openai',
          modelName: 'empty',
          signalVersions: {
            typescript: '6.0.3'
          },
          configHash
        },
        qualityGate: {
          maxHigh: 0,
          failOnNewOnly: true
        }
      }
    })

    expect(result.admittedFindings).toHaveLength(1)
    expect(result.admittedFindings[0]?.proposedBy).toBe('typescript-support-signal')
    expect(result.admittedFindings[0]?.reporterEligibility).toBe('artifact-only')
    expect(result.qualityGate.passed).toBe(true)
    expect(JSON.stringify(result)).not.toContain('{"diagnostics":1}')
    expect(provider.requests[0]?.schema).toMatchObject({
      type: 'object',
      properties: {
        findings: {
          type: 'array'
        }
      }
    })

    await harness.shutdown()
  })

  test('provider-backed workflow delegates bounded work per reviewed file task', async () => {
    const provider = new EmptyFindingProvider()
    const harness = createModelBackedReviewHarness({
      modelAlias: {
        provider,
        model: 'empty',
        capabilities: ['object']
      }
    })

    const result = await runModelBackedReviewWorkflow({
      harness,
      sessionId: 'test-session',
      input: {
        runId: 'test-run',
        reviewedPaths: ['src/app.ts', 'src/util.ts'],
        evidence: [],
        candidates: [],
        instructions: [],
        skills: [],
        reviewContext: [
          {
            kind: 'file',
            path: 'src/app.ts',
            content: 'export const app = 1;',
            ledgerEntryId: 'ctx_aaaaaaaaaaaaaaaaaaaaaaaa'
          },
          {
            kind: 'file',
            path: 'src/util.ts',
            content: 'export const util = 1;',
            ledgerEntryId: 'ctx_bbbbbbbbbbbbbbbbbbbbbbbb'
          }
        ],
        baselineConfigured: false,
        provenance: {
          reviewer: 'review-agent',
          modelProvider: 'openai',
          modelName: 'empty',
          signalVersions: {
            typescript: '6.0.3'
          },
          configHash
        },
        qualityGate: {}
      }
    })

    expect(result.admittedFindings).toEqual([])
    expect(provider.requests).toHaveLength(2)
  })

  test('provider-backed workflow retry avoids persistent per-task provider storage', async () => {
    const firstProvider = new FailingSecondTaskProvider()
    const secondProvider = new EmptyFindingProvider()
    const input = {
      runId: 'test-run-resume',
      reviewedPaths: ['src/app.ts', 'src/util.ts'],
      evidence: [],
      candidates: [],
      instructions: [],
      skills: [],
      maxConcurrentTasks: 1,
      reviewContext: [
        {
          kind: 'file' as const,
          path: 'src/app.ts',
          content: 'export const app = 1;',
          ledgerEntryId: 'ctx_aaaaaaaaaaaaaaaaaaaaaaaa'
        },
        {
          kind: 'file' as const,
          path: 'src/util.ts',
          content: 'export const util = 1;',
          ledgerEntryId: 'ctx_bbbbbbbbbbbbbbbbbbbbbbbb'
        }
      ],
      baselineConfigured: false,
      provenance: {
        reviewer: 'review-agent',
        modelProvider: 'openai',
        modelName: 'empty',
        signalVersions: {
          typescript: '6.0.3'
        },
        configHash
      },
      qualityGate: {}
    }

    const firstHarness = createModelBackedReviewHarness({
      modelAlias: {
        provider: firstProvider,
        model: 'failing-second-task',
        capabilities: ['object']
      }
    })

    try {
      await expect(
        runModelBackedReviewWorkflow({
          harness: firstHarness,
          sessionId: 'test-session-resume',
          input
        })
      ).rejects.toSatisfy(isReviewTaskExecutionError)
    } finally {
      await firstHarness.shutdown()
    }

    const secondHarness = createModelBackedReviewHarness({
      modelAlias: {
        provider: secondProvider,
        model: 'empty',
        capabilities: ['object']
      }
    })

    try {
      const result = await runModelBackedReviewWorkflow({
        harness: secondHarness,
        sessionId: 'test-session-resume',
        input
      })

      expect(result.admittedFindings).toEqual([])
      expect(firstProvider.requests).toHaveLength(2)
      expect(secondProvider.requests).toHaveLength(2)
    } finally {
      await secondHarness.shutdown()
    }
  })

  test('provider-backed workflow caps active provider calls at configured concurrency', async () => {
    const provider = new ObservedConcurrencyProvider()
    const harness = createModelBackedReviewHarness({
      modelAlias: {
        provider,
        model: 'observed-concurrency',
        capabilities: ['object']
      },
      maxConcurrentTasks: 2
    })

    try {
      const result = await runModelBackedReviewWorkflow({
        harness,
        sessionId: 'test-session-concurrency',
        input: {
          runId: 'test-run-concurrency',
          reviewedPaths: [
            'src/a.ts',
            'src/b.ts',
            'src/c.ts',
            'src/d.ts',
            'src/e.ts',
            'src/f.ts'
          ],
          evidence: [],
          candidates: [],
          instructions: [],
          skills: [],
          maxConcurrentTasks: 6,
          reviewContext: [],
          baselineConfigured: false,
          provenance: {
            reviewer: 'review-agent',
            modelProvider: 'openai',
            modelName: 'observed-concurrency',
            signalVersions: {
              typescript: '6.0.3'
            },
            configHash
          },
          qualityGate: {}
        }
      })

      expect(result.admittedFindings).toEqual([])
      expect(provider.requests).toHaveLength(6)
      expect(provider.maxActiveRequests).toBeLessThanOrEqual(2)
    } finally {
      await harness.shutdown()
    }
  })

  test('provider-backed workflow starts next task when one worker frees up', async () => {
    const provider = new RollingQueueProvider()
    const harness = createModelBackedReviewHarness({
      modelAlias: {
        provider,
        model: 'rolling-queue',
        capabilities: ['object']
      },
      maxConcurrentTasks: 2
    })

    try {
      const result = await runModelBackedReviewWorkflow({
        harness,
        sessionId: 'test-session-rolling-queue',
        input: {
          runId: 'test-run-rolling-queue',
          reviewedPaths: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'],
          evidence: [],
          candidates: [],
          instructions: [],
          skills: [],
          maxConcurrentTasks: 2,
          reviewContext: [],
          baselineConfigured: false,
          provenance: {
            reviewer: 'review-agent',
            modelProvider: 'openai',
            modelName: 'rolling-queue',
            signalVersions: {
              typescript: '6.0.3'
            },
            configHash
          },
          qualityGate: {}
        }
      })

      expect(result.admittedFindings).toEqual([])
      expect(provider.requests).toHaveLength(4)
      expect(provider.maxActiveRequests).toBeLessThanOrEqual(2)
      expect(provider.starts[2]).toBeLessThan(provider.completions[0] ?? 0)
    } finally {
      await harness.shutdown()
    }
  })

  test('provider-backed workflow fails oversized task packets before model calls', async () => {
    const provider = new EmptyFindingProvider()
    const harness = createModelBackedReviewHarness({
      modelAlias: {
        provider,
        model: 'empty',
        capabilities: ['object']
      }
    })
    const tailMarker = 'tail-marker-should-not-reach-provider'

    try {
      await expect(
        runModelBackedReviewWorkflow({
          harness,
          sessionId: 'test-session',
          input: {
            runId: 'test-run',
            reviewedPaths: ['src/large.ts'],
            evidence: [],
            candidates: [],
            instructions: [],
            skills: [],
            reviewContext: [
              {
                kind: 'file',
                path: 'src/large.ts',
                content: `export const head = 1;\n${'x'.repeat(30000)}\n${tailMarker}`,
                ledgerEntryId: 'ctx_cccccccccccccccccccccccc'
              }
            ],
            maxTaskInputBytes: 10000,
            baselineConfigured: false,
            provenance: {
              reviewer: 'review-agent',
              modelProvider: 'openai',
              modelName: 'empty',
              signalVersions: {
                typescript: '6.0.3'
              },
              configHash
            },
            qualityGate: {}
          }
        })
      ).rejects.toSatisfy(
        (error: unknown) =>
          isReviewTaskExecutionError(error) &&
          typeof error.originalError === 'object' &&
          error.originalError !== null &&
          'code' in error.originalError &&
          error.originalError.code === 'task_packet_budget_exceeded'
      )
      expect(provider.requests).toHaveLength(0)
    } finally {
      await harness.shutdown()
    }
  })

  test('provider-backed workflow fails before provider calls when irreducible task packet exceeds budget', async () => {
    const provider = new EmptyFindingProvider()
    const harness = createModelBackedReviewHarness({
      modelAlias: {
        provider,
        model: 'empty',
        capabilities: ['object']
      }
    })

    try {
      const evidence = Array.from({ length: 120 }, (_, index) => ({
        id: `ev_${index}`,
        kind: 'diff' as const,
        summary: `Evidence summary ${index} ${'x'.repeat(120)}`,
        location: {
          path: 'src/large.ts',
          startLine: index + 1,
          side: 'new' as const
        },
        source: 'typescript-support-signal',
        contentHash:
          '2222222222222222222222222222222222222222222222222222222222222222',
        redactionApplied: true
      }))

      await expect(
        runModelBackedReviewWorkflow({
          harness,
          sessionId: 'test-session',
          input: {
            runId: 'test-run',
            reviewedPaths: ['src/large.ts'],
            evidence,
            candidates: [],
            instructions: [],
            skills: [],
            maxTaskInputBytes: 10000,
            baselineConfigured: false,
            provenance: {
              reviewer: 'review-agent',
              modelProvider: 'openai',
              modelName: 'empty',
              signalVersions: {
                typescript: '6.0.3'
              },
              configHash
            },
            qualityGate: {}
          }
        })
      ).rejects.toSatisfy(
        (error: unknown) =>
          isReviewTaskExecutionError(error) &&
          typeof error.originalError === 'object' &&
          error.originalError !== null &&
          'code' in error.originalError &&
          error.originalError.code === 'task_packet_budget_exceeded'
      )
      expect(provider.requests).toHaveLength(0)
    } finally {
      await harness.shutdown()
    }
  })

  test('provider-backed workflow mounts skills with read-only built-in tools', async () => {
    const mountedSkill = await createMountedSkill()
    const provider = new EmptyFindingProvider()

    try {
      const harness = createModelBackedReviewHarness({
        modelAlias: {
          provider,
          model: 'empty',
          capabilities: ['object', 'tool_use']
        },
        skills: {
          'secure-review': {
            directory: mountedSkill.directory,
            validationMode: 'strict',
            trust: 'project',
            source: 'test'
          }
        },
        skillIds: ['secure-review'],
        skillTools: ['read', 'list', 'grep']
      })

      const result = await runModelBackedReviewWorkflow({
        harness,
        sessionId: 'test-session',
        input: {
          runId: 'test-run',
          reviewedPaths: ['src/app.ts'],
          evidence: [],
          candidates: [],
          instructions: [],
          skills: [
            {
              name: 'secure-review',
              path: '.codereviewer/skills/secure-review/SKILL.md',
              directory: '.codereviewer/skills/secure-review',
              contentHash:
                '3333333333333333333333333333333333333333333333333333333333333333',
              allowed: true
            }
          ],
          reviewContext: [
            {
              kind: 'file',
              path: 'src/app.ts',
              content: 'export const app = 1;',
              ledgerEntryId: 'ctx_aaaaaaaaaaaaaaaaaaaaaaaa'
            }
          ],
          baselineConfigured: false,
          provenance: {
            reviewer: 'review-agent',
            modelProvider: 'openai',
            modelName: 'empty',
            signalVersions: {
              typescript: '6.0.3'
            },
            configHash
          },
          qualityGate: {}
        }
      })

      expect(result.skillHashes).toEqual([
        '3333333333333333333333333333333333333333333333333333333333333333'
      ])
      expect(provider.requests[0]?.tools?.map((tool) => tool.name).sort()).toEqual([
        'grep',
        'list',
        'read'
      ])
      expect(JSON.stringify(provider.requests)).not.toContain(
        'Do not inline this mounted skill body.'
      )
      expect(JSON.stringify(result)).not.toContain(
        'Do not inline this mounted skill body.'
      )

      await harness.shutdown()
    } finally {
      await rm(mountedSkill.root, { recursive: true, force: true })
    }
  })

  test('provider-backed workflow preserves model candidates and admission decisions', async () => {
    const harness = createModelBackedReviewHarness({
      modelAlias: {
        provider: new SupportedFindingProvider(),
        model: 'supported',
        capabilities: ['object']
      }
    })

    const result = await runModelBackedReviewWorkflow({
      harness,
      sessionId: 'test-session',
      input: {
        runId: 'test-run',
        reviewedPaths: ['src/app.ts'],
        evidence: [
          {
            id: 'ev_diff1',
            kind: 'diff',
            summary: 'Changed branch can return an incorrect value.',
            location: {
              path: 'src/app.ts',
              startLine: 4,
              side: 'new'
            },
            source: 'typescript-support-signal',
            contentHash:
              '2222222222222222222222222222222222222222222222222222222222222222',
            redactionApplied: true
          }
        ],
        candidates: [],
        instructions: [],
        skills: [],
        reviewContext: [
          {
            kind: 'file',
            path: 'src/app.ts',
            content: [
              'const input = 1',
              'const intermediate = input + 1',
              'const expected = intermediate + 1',
              'export const value = broken'
            ].join('\n'),
            ledgerEntryId: 'ctx_aaaaaaaaaaaaaaaaaaaaaaaa'
          }
        ],
        baselineConfigured: false,
        provenance: {
          reviewer: 'review-agent',
          modelProvider: 'openai',
          modelName: 'supported',
          signalVersions: {
            typescript: '6.0.3'
          },
          configHash
        },
        qualityGate: {
          maxHigh: 0,
          failOnNewOnly: true
        }
      }
    })

    expect(result.candidateFindings).toHaveLength(1)
    expect(result.admissionDecisions).toEqual([
      expect.objectContaining({
        candidateId: result.candidateFindings[0]?.id,
        status: 'admitted',
        findingId: result.admittedFindings[0]?.id
      })
    ])
    expect(result.taskEvents.map((event) => event.state)).toEqual([
      'planned',
      'running',
      'completed'
    ])

    await harness.shutdown()
  })

  test('provider-backed workflow validates model findings without task evidence when model evidence is allowed', async () => {
    const provider = new EvidenceOptionalFindingProvider()
    const harness = createModelBackedReviewHarness({
      modelAlias: {
        provider,
        model: 'evidence-optional-finding',
        capabilities: ['object']
      }
    })

    const result = await runModelBackedReviewWorkflow({
      harness,
      sessionId: 'test-session',
      input: {
        runId: 'test-run',
        reviewedPaths: ['src/app.ts'],
        evidence: [],
        candidates: [],
        instructions: [],
        skills: [],
        reviewContext: [
          {
            kind: 'file',
            path: 'src/app.ts',
            content: [
              'const input = 1',
              'const intermediate = input + 1',
              'const expectedValue = intermediate + 1',
              'export const value = input > 0 ? intermediate : expectedValue'
            ].join('\n'),
            ledgerEntryId: 'ctx_aaaaaaaaaaaaaaaaaaaaaaaa'
          }
        ],
        baselineConfigured: false,
        provenance: {
          reviewer: 'review-agent',
          modelProvider: 'openai',
          modelName: 'evidence-optional-finding',
          signalVersions: {
            typescript: '6.0.3'
          },
          configHash
        }
      }
    })

    const refutationEvidence = result.evidence.find(
      (record) => record.kind === 'model-rationale'
    )

    expect(provider.requests).toHaveLength(2)
    expect(result.candidateFindings).toHaveLength(1)
    expect(result.admittedFindings).toHaveLength(1)
    expect(result.rejectedFindings).toHaveLength(0)
    expect(result.admittedFindings[0]?.evidenceIds).toEqual([
      refutationEvidence?.id
    ])
    expect(result.admittedFindings[0]?.admissionEvidenceIds).toEqual([
      refutationEvidence?.id
    ])

    await harness.shutdown()
  })

  test('provider-backed workflow keeps model-only findings without proof artifact-only by default', async () => {
    const provider = new EvidenceOptionalFindingProvider()
    const harness = createModelBackedReviewHarness({
      modelAlias: {
        provider,
        model: 'evidence-optional-finding',
        capabilities: ['object']
      }
    })

    const result = await runModelBackedReviewWorkflow({
      harness,
      sessionId: 'test-session',
      input: {
        runId: 'test-run',
        reviewedPaths: ['src/app.ts'],
        evidence: [],
        candidates: [],
        instructions: [],
        skills: [],
        reviewContext: [
          {
            kind: 'file',
            path: 'src/app.ts',
            content: [
              'const input = 1',
              'const intermediate = input + 1',
              'const expectedValue = intermediate + 1',
              'export const value = input > 0 ? intermediate : expectedValue'
            ].join('\n'),
            ledgerEntryId: 'ctx_aaaaaaaaaaaaaaaaaaaaaaaa'
          }
        ],
        baselineConfigured: false,
        provenance: {
          reviewer: 'review-agent',
          modelProvider: 'openai',
          modelName: 'evidence-optional-finding',
          signalVersions: {
            typescript: '6.0.3'
          },
          configHash
        },
        qualityGate: {}
      }
    })

    const refutationEvidence = result.evidence.find(
      (record) => record.kind === 'model-rationale'
    )

    expect(provider.requests).toHaveLength(2)
    expect(result.rejectedFindings).toHaveLength(0)
    expect(result.admittedFindings).toEqual([
      expect.objectContaining({
        title: 'Context proves a wrong return value',
        evidenceIds: [refutationEvidence?.id],
        admissionEvidenceIds: [refutationEvidence?.id],
        reporterEligibility: 'summary-only'
      })
    ])
    expect(result.qualityGate.passed).toBe(true)

    await harness.shutdown()
  })

  test('provider-backed workflow preserves uncertain proved model findings as artifact-only', async () => {
    const provider = new UncertainRefutationProvider()
    const harness = createModelBackedReviewHarness({
      modelAlias: {
        provider,
        model: 'uncertain-refutation',
        capabilities: ['object']
      }
    })

    const result = await runModelBackedReviewWorkflow({
      harness,
      sessionId: 'test-session',
      input: {
        runId: 'test-run',
        reviewedPaths: ['src/app.ts'],
        evidence: [],
        candidates: [],
        instructions: [],
        skills: [],
        reviewContext: [
          {
            kind: 'file',
            path: 'src/app.ts',
            content: [
              'const backupCodes = ["abc"]',
              'const index = backupCodes.indexOf(input)',
              'if (index === -1) throw new Error("bad code")',
              'export const accepted = backupCodes[index]'
            ].join('\n'),
            ledgerEntryId: 'ctx_aaaaaaaaaaaaaaaaaaaaaaaa'
          }
        ],
        baselineConfigured: false,
        provenance: {
          reviewer: 'review-agent',
          modelProvider: 'openai',
          modelName: 'uncertain-refutation',
          signalVersions: {
            typescript: '6.0.3'
          },
          configHash
        }
      }
    })

    const refutationEvidence = result.evidence.find(
      (record) => record.kind === 'model-rationale'
    )

    expect(provider.requests).toHaveLength(2)
    expect(result.candidateFindings).toHaveLength(1)
    expect(result.rejectedFindings).toHaveLength(0)
    expect(result.admittedFindings).toEqual([
      expect.objectContaining({
        title: 'Backup code reuse may bypass one-time semantics',
        evidenceIds: [refutationEvidence?.id],
        admissionEvidenceIds: [refutationEvidence?.id],
        reporterEligibility: 'artifact-only'
      })
    ])
    expect(refutationEvidence?.summary).toContain(
      'could not fully prove the finding'
    )

    await harness.shutdown()
  })

  test('provider-backed workflow validates concrete backup-code read-modify-write races', async () => {
    const provider = new BackupCodeRaceRefutationProvider()
    const harness = createModelBackedReviewHarness({
      modelAlias: {
        provider,
        model: 'backup-code-race-refutation',
        capabilities: ['object']
      }
    })

    const result = await runModelBackedReviewWorkflow({
      harness,
      sessionId: 'test-session',
      input: {
        runId: 'test-run',
        reviewedPaths: ['src/auth.ts'],
        reviewedDiffRanges: [
          {
            path: 'src/auth.ts',
            startLine: 1,
            endLine: 10,
            changeKind: 'modified'
          }
        ],
        evidence: [],
        candidates: [],
        instructions: [],
        skills: [],
        reviewContext: [
          {
            kind: 'file',
            path: 'src/auth.ts',
            content: [
              'const backupCodes = JSON.parse(symmetricDecrypt(user.backupCodes, key))',
              'const index = backupCodes.indexOf(credentials.backupCode.replaceAll("-", ""))',
              'if (index === -1) throw new Error(ErrorCode.IncorrectBackupCode)',
              'backupCodes[index] = null',
              'await prisma.user.update({',
              '  where: { id: user.id },',
              '  data: { backupCodes: symmetricEncrypt(JSON.stringify(backupCodes), key) }',
              '})'
            ].join('\n'),
            ledgerEntryId: 'ctx_aaaaaaaaaaaaaaaaaaaaaaaa'
          }
        ],
        baselineConfigured: false,
        provenance: {
          reviewer: 'review-agent',
          modelProvider: 'openai',
          modelName: 'backup-code-race-refutation',
          signalVersions: {
            typescript: '6.0.3'
          },
          configHash
        }
      }
    })

    const refutationRequest = provider.requests.find(
      isFindingRefutationCheckRequest
    )
    const refutationSystemMessage = refutationRequest?.messages.find(
      (message) => message.role === 'system'
    )

    expect(String(refutationSystemMessage?.content)).toContain(
      'Do not require proof of actual concurrent requests when reviewContext shows a non-atomic read-modify-write flow on shared mutable state.'
    )
    expect(provider.requests).toHaveLength(2)
    expect(result.rejectedFindings).toEqual([])
    expect(result.admittedFindings).toEqual([
      expect.objectContaining({
        title: 'Backup code can be consumed twice by concurrent logins',
        reporterEligibility: 'summary-only'
      })
    ])

    await harness.shutdown()
  })

  test('provider-backed workflow rejects refuted model findings', async () => {
    const provider = new RefutedFindingProvider()
    const harness = createModelBackedReviewHarness({
      modelAlias: {
        provider,
        model: 'refuted-finding',
        capabilities: ['object']
      }
    })

    const result = await runModelBackedReviewWorkflow({
      harness,
      sessionId: 'test-session',
      input: {
        runId: 'test-run',
        reviewedPaths: ['src/app.ts'],
        evidence: [],
        candidates: [],
        instructions: [],
        skills: [],
        reviewContext: [
          {
            kind: 'file',
            path: 'src/app.ts',
            content: [
              'const backupCodes = maybeEncryptedCodes',
              'export const accepted = backupCodes'
            ].join('\n'),
            ledgerEntryId: 'ctx_aaaaaaaaaaaaaaaaaaaaaaaa'
          }
        ],
        baselineConfigured: false,
        provenance: {
          reviewer: 'review-agent',
          modelProvider: 'openai',
          modelName: 'refuted-finding',
          signalVersions: {
            typescript: '6.0.3'
          },
          configHash
        },
        qualityGate: {
          maxMedium: 0,
          failOnNewOnly: true
        }
      }
    })

    const refutationEvidence = result.evidence.find(
      (record) => record.kind === 'model-rationale'
    )

    expect(provider.requests).toHaveLength(2)
    expect(result.candidateFindings).toHaveLength(1)
    expect(result.rejectedFindings).toEqual([
      expect.objectContaining({
        reason: 'refuted',
        evidenceIds: [refutationEvidence?.id]
      })
    ])
    expect(result.admittedFindings).toEqual([])
    expect(refutationEvidence?.summary).toContain(
      'judged the model finding unsupported'
    )
    expect(result.qualityGate.passed).toBe(true)

    await harness.shutdown()
  })

  test('provider-backed refutation receives the originating multi-path task context', async () => {
    const provider = new MultiPathRefutationContextProvider()
    const harness = createModelBackedReviewHarness({
      modelAlias: {
        provider,
        model: 'multi-path-refutation-context',
        capabilities: ['object']
      }
    })

    const result = await runModelBackedReviewWorkflow({
      harness,
      sessionId: 'test-session',
      input: {
        runId: 'test-run',
        reviewedPaths: ['src/app.ts', 'src/helper.ts'],
        evidence: [],
        candidates: [],
        instructions: [],
        skills: [],
        reviewContext: [
          {
            kind: 'file',
            path: 'src/app.ts',
            content: [
              'import { getState } from "./helper"',
              'export const update = () => {',
              '  return getState() + 1',
              '}'
            ].join('\n'),
            ledgerEntryId: 'ctx_aaaaaaaaaaaaaaaaaaaaaaaa'
          },
          {
            kind: 'file',
            path: 'src/helper.ts',
            content: [
              'let state = 0',
              'export const getState = () => state',
              'export const setState = (next: number) => { state = next }'
            ].join('\n'),
            ledgerEntryId: 'ctx_bbbbbbbbbbbbbbbbbbbbbbbb'
          }
        ],
        tasks: [
          {
            id: 'task_multipath',
            round: 1,
            kind: 'file',
            paths: ['src/app.ts', 'src/helper.ts'],
            factIds: [],
            evidenceIds: [],
            candidateIds: [],
            reviewContext: [
              {
                kind: 'file',
                path: 'src/app.ts',
                content: [
                  'import { getState } from "./helper"',
                  'export const update = () => {',
                  '  return getState() + 1',
                  '}'
                ].join('\n'),
                ledgerEntryId: 'ctx_aaaaaaaaaaaaaaaaaaaaaaaa'
              },
              {
                kind: 'file',
                path: 'src/helper.ts',
                content: [
                  'let state = 0',
                  'export const getState = () => state',
                  'export const setState = (next: number) => { state = next }'
                ].join('\n'),
                ledgerEntryId: 'ctx_bbbbbbbbbbbbbbbbbbbbbbbb'
              }
            ],
            contextEntryIds: [
              'ctx_aaaaaaaaaaaaaaaaaaaaaaaa',
              'ctx_bbbbbbbbbbbbbbbbbbbbbbbb'
            ],
            priority: 0
          }
        ],
        baselineConfigured: false,
        provenance: {
          reviewer: 'review-agent',
          modelProvider: 'openai',
          modelName: 'multi-path-refutation-context',
          signalVersions: {
            typescript: '6.0.3'
          },
          configHash
        }
      }
    })

    const refutationRequest = provider.requests.find(
      isFindingRefutationCheckRequest
    )
    const refutationUserMessage = refutationRequest?.messages.find(
      (message) => message.role === 'user'
    )
    const refutationInput = JSON.parse(
      String(refutationUserMessage?.content)
    ) as {
      readonly reviewContext: readonly { readonly path?: string }[]
    }

    expect(result.admittedFindings).toHaveLength(1)
    expect(refutationInput.reviewContext.map((context) => context.path)).toEqual(
      ['src/app.ts', 'src/helper.ts']
    )

    await harness.shutdown()
  })

  test('provider-backed workflow rejects candidates when refutation provider output fails', async () => {
    const provider = new RefutationFailureProvider()
    const harness = createModelBackedReviewHarness({
      modelAlias: {
        provider,
        model: 'refutation-failure',
        capabilities: ['object']
      }
    })

    const result = await runModelBackedReviewWorkflow({
      harness,
      sessionId: 'test-session',
      input: {
        runId: 'test-run',
        reviewedPaths: ['src/app.ts'],
        evidence: [],
        candidates: [],
        instructions: [],
        skills: [],
        reviewContext: [
          {
            kind: 'file',
            path: 'src/app.ts',
            content: 'export const value = 1',
            ledgerEntryId: 'ctx_aaaaaaaaaaaaaaaaaaaaaaaa'
          }
        ],
        baselineConfigured: false,
        provenance: {
          reviewer: 'review-agent',
          modelProvider: 'openai',
          modelName: 'refutation-failure',
          signalVersions: {
            typescript: '6.0.3'
          },
          configHash
        }
      }
    })

    expect(provider.requests).toHaveLength(2)
    expect(result.candidateFindings).toHaveLength(1)
    expect(result.admittedFindings).toHaveLength(0)
    expect(result.rejectedFindings).toEqual([
      expect.objectContaining({
        candidateId: result.candidateFindings[0]?.id,
        status: 'needs-more-evidence',
        reason: 'provider-error',
        message: expect.stringContaining('Refutation check failed')
      })
    ])
    expect(result.providerIssues).toEqual([
      expect.objectContaining({
        stage: 'refutation-check',
        recovered: true
      })
    ])

    await harness.shutdown()
  })

  test('provider-backed workflow admits proved model findings in a changed file outside the exact changed lines (blast radius)', async () => {
    const provider = new OutsideChangedLinesProvider()
    const harness = createModelBackedReviewHarness({
      modelAlias: {
        provider,
        model: 'out-of-diff-scope',
        capabilities: ['object']
      }
    })

    const result = await runModelBackedReviewWorkflow({
      harness,
      sessionId: 'test-session',
      input: {
        runId: 'test-run',
        reviewedPaths: ['src/app.ts'],
        reviewedDiffRanges: [
          {
            path: 'src/app.ts',
            startLine: 1,
            endLine: 1
          }
        ],
        evidence: [],
        candidates: [],
        instructions: [],
        skills: [],
        reviewContext: [
          {
            kind: 'file',
            path: 'src/app.ts',
            content: [
              'export const changed = 1',
              'const line2 = true',
              'const line3 = true',
              'const line4 = true',
              'const line5 = true',
              'const line6 = true',
              'const line7 = true',
              'const line8 = true',
              'const line9 = true',
              'export const unrelated = true'
            ].join('\n'),
            ledgerEntryId: 'ctx_aaaaaaaaaaaaaaaaaaaaaaaa'
          }
        ],
        baselineConfigured: false,
        provenance: {
          reviewer: 'review-agent',
          modelProvider: 'openai',
          modelName: 'out-of-diff-scope',
          signalVersions: {
            typescript: '6.0.3'
          },
          configHash
        }
      }
    })

    // Blast-radius admission: the finding sits at line 10, outside the changed
    // line (1), but in the changed file src/app.ts. The scope gate now passes
    // (so refutation runs — a 3rd request — instead of an early not-in-scope
    // reject), and the proved finding is admitted. (Inline-comment eligibility,
    // decided separately, still keys on hunk overlap.)
    expect(provider.requests).toHaveLength(2)
    expect(result.candidateFindings).toHaveLength(1)
    expect(result.admittedFindings).toHaveLength(1)
    expect(
      result.rejectedFindings.some((finding) => finding.reason === 'not-in-scope')
    ).toBe(false)

    await harness.shutdown()
  })

  test('provider-backed workflow drops malformed model suggestions without failing the task', async () => {
    const provider = new MalformedSuggestionProvider()
    const harness = createModelBackedReviewHarness({
      modelAlias: {
        provider,
        model: 'malformed-suggestion',
        capabilities: ['object']
      }
    })

    const result = await runModelBackedReviewWorkflow({
      harness,
      sessionId: 'test-session',
      input: {
        runId: 'test-run',
        reviewedPaths: ['src/app.ts'],
        evidence: [],
        candidates: [],
        instructions: [],
        skills: [],
        reviewContext: [
          {
            kind: 'file',
            path: 'src/app.ts',
            content: 'export const value = 1',
            ledgerEntryId: 'ctx_aaaaaaaaaaaaaaaaaaaaaaaa'
          }
        ],
        baselineConfigured: false,
        provenance: {
          reviewer: 'review-agent',
          modelProvider: 'openai',
          modelName: 'malformed-suggestion',
          signalVersions: {
            typescript: '6.0.3'
          },
          configHash
        }
      }
    })

    expect(provider.requests).toHaveLength(2)
    expect(result.candidateFindings).toHaveLength(1)
    expect(result.admittedFindings).toHaveLength(1)
    expect(result.admittedFindings[0]?.title).toBe(
      'Valid finding survives malformed sibling'
    )

    await harness.shutdown()
  })

  test('provider-backed workflow normalizes common model suggestion aliases', async () => {
    const provider = new AliasedSuggestionProvider()
    const harness = createModelBackedReviewHarness({
      modelAlias: {
        provider,
        model: 'aliased-suggestion',
        capabilities: ['object']
      }
    })

    const result = await runModelBackedReviewWorkflow({
      harness,
      sessionId: 'test-session',
      input: {
        runId: 'test-run',
        reviewedPaths: ['src/app.ts'],
        evidence: [],
        candidates: [],
        instructions: [],
        skills: [],
        reviewContext: [
          {
            kind: 'file',
            path: 'src/app.ts',
            content: 'export const value = 1',
            ledgerEntryId: 'ctx_aaaaaaaaaaaaaaaaaaaaaaaa'
          }
        ],
        baselineConfigured: false,
        provenance: {
          reviewer: 'review-agent',
          modelProvider: 'openai',
          modelName: 'aliased-suggestion',
          signalVersions: {
            typescript: '6.0.3'
          },
          configHash
        }
      }
    })

    expect(provider.requests).toHaveLength(2)
    expect(result.candidateFindings).toEqual([
      expect.objectContaining({
        category: 'bug',
        severity: 'high',
        title: 'Aliased suggestion should survive parsing',
        suggestedFix: 'Normalize model suggestion aliases before admission.',
        location: expect.objectContaining({
          path: 'src/app.ts',
          startLine: 1
        })
      })
    ])
    expect(result.admittedFindings).toHaveLength(1)

    await harness.shutdown()
  })

  test('provider-backed workflow normalizes model naming category aliases', async () => {
    const provider = new NamingAliasSuggestionProvider()
    const harness = createModelBackedReviewHarness({
      modelAlias: {
        provider,
        model: 'naming-alias-suggestion',
        capabilities: ['object']
      }
    })

    const result = await runModelBackedReviewWorkflow({
      harness,
      sessionId: 'test-session',
      input: {
        runId: 'test-run',
        reviewedPaths: ['src/BackupCode.tsx'],
        evidence: [],
        candidates: [],
        instructions: [],
        skills: [],
        reviewContext: [
          {
            kind: 'file',
            path: 'src/BackupCode.tsx',
            content: [
              'import React from "react"',
              '',
              'type Props = {',
              '  center?: boolean',
              '}',
              '',
              'export default function TwoFactor(_props: Props) { return null }'
            ].join('\n'),
            ledgerEntryId: 'ctx_aaaaaaaaaaaaaaaaaaaaaaaa'
          }
        ],
        baselineConfigured: false,
        provenance: {
          reviewer: 'review-agent',
          modelProvider: 'openai',
          modelName: 'naming-alias-suggestion',
          signalVersions: {
            typescript: '6.0.3'
          },
          configHash
        }
      }
    })

    expect(provider.requests).toHaveLength(2)
    // The model naming-alias category is still normalized to `maintainability`
    // during discovery.
    expect(result.candidateFindings).toEqual([
      expect.objectContaining({
        category: 'maintainability',
        severity: 'low',
        title: 'Default export name does not match the file name'
      })
    ])
    // ...but a low-severity nit is below the default actionable severity floor
    // (`medium`), so it is not admitted as actionable — it is recorded as a
    // below-threshold rejection instead (low-noise product posture).
    expect(result.admittedFindings).toHaveLength(0)
    expect(result.rejectedFindings).toContainEqual(
      expect.objectContaining({ reason: 'below-threshold' })
    )

    await harness.shutdown()
  })

  test('provider-backed workflow preserves proof-pending model findings as artifact-only', async () => {
    const provider = new ProofPendingModelFindingProvider()
    const harness = createModelBackedReviewHarness({
      modelAlias: {
        provider,
        model: 'proof-pending-model-finding',
        capabilities: ['object']
      }
    })

    const result = await runModelBackedReviewWorkflow({
      harness,
      sessionId: 'test-session',
      input: {
        runId: 'test-run',
        reviewedPaths: ['src/app.ts'],
        evidence: [
          {
            id: 'ev_diff1',
            kind: 'diff',
            summary: 'Changed branch can return an incorrect value.',
            location: {
              path: 'src/app.ts',
              startLine: 4,
              side: 'new'
            },
            source: 'typescript-support-signal',
            contentHash:
              '2222222222222222222222222222222222222222222222222222222222222222',
            redactionApplied: true
          }
        ],
        candidates: [],
        instructions: [],
        skills: [],
        reviewContext: [
          {
            kind: 'file',
            path: 'src/app.ts',
            content: [
              'const input = 1',
              'const intermediate = input + 1',
              'const expectedValue = intermediate + 1',
              'return actualValue'
            ].join('\n'),
            ledgerEntryId: 'ctx_111111111111111111111111'
          }
        ],
        baselineConfigured: false,
        provenance: {
          reviewer: 'review-agent',
          modelProvider: 'openai',
          modelName: 'proof-pending-model-finding',
          signalVersions: {
            typescript: '6.0.3'
          },
          configHash
        },
        qualityGate: {
          maxHigh: 0,
          failOnNewOnly: true
        }
      }
    })

    expect(provider.requests).toHaveLength(2)
    expect(result.admittedFindings).toEqual([
      expect.objectContaining({
        title: 'Changed branch returns wrong value',
        reporterEligibility: 'artifact-only'
      })
    ])
    expect(result.rejectedFindings).toEqual([])
    expect(result.qualityGate.passed).toBe(true)

    await harness.shutdown()
  })

  test('provider-backed workflow promotes refutation-proved model findings with task evidence by default', async () => {
    const provider = new ProvedModelFindingProvider()
    const harness = createModelBackedReviewHarness({
      modelAlias: {
        provider,
        model: 'proved-model-finding',
        capabilities: ['object']
      }
    })

    const result = await runModelBackedReviewWorkflow({
      harness,
      sessionId: 'test-session',
      input: {
        runId: 'test-run',
        reviewedPaths: ['src/app.ts'],
        evidence: [
          {
            id: 'ev_diff1',
            kind: 'diff',
            summary: 'Changed branch can return an incorrect value.',
            location: {
              path: 'src/app.ts',
              startLine: 4,
              side: 'new'
            },
            source: 'typescript-support-signal',
            contentHash:
              '2222222222222222222222222222222222222222222222222222222222222222',
            redactionApplied: true
          }
        ],
        candidates: [],
        instructions: [],
        skills: [],
        reviewContext: [
          {
            kind: 'file',
            path: 'src/app.ts',
            content: [
              'const input = 1',
              'const intermediate = input + 1',
              'const expectedValue = intermediate + 1',
              'return actualValue'
            ].join('\n'),
            ledgerEntryId: 'ctx_111111111111111111111111'
          }
        ],
        baselineConfigured: false,
        provenance: {
          reviewer: 'review-agent',
          modelProvider: 'openai',
          modelName: 'proved-model-finding',
          signalVersions: {
            typescript: '6.0.3'
          },
          configHash
        },
        qualityGate: {}
      }
    })

    const refutationEvidence = result.evidence.find(
      (record) =>
        record.kind === 'model-rationale' &&
        record.source === 'refutation-check'
    )

    expect(provider.requests).toHaveLength(2)
    expect(result.admittedFindings).toHaveLength(1)
    expect(refutationEvidence).toBeDefined()
    expect(result.admittedFindings[0]?.reporterEligibility).toBe('summary-only')
    expect(result.admittedFindings[0]?.admissionEvidenceIds).toContain(
      refutationEvidence?.id
    )
    expect(result.admittedFindings[0]?.fixProposal).toMatchObject({
      summary:
        'Return the expected value from the changed branch after validating callers.',
      safety: 'manual-review',
      edits: [
        expect.objectContaining({
          path: 'src/app.ts',
          startLine: 4,
          endLine: 4
        })
      ]
    })

    await harness.shutdown()
  })

  test('provider-backed workflow rejects invalid source lines before GitHub comments', async () => {
    const harness = createModelBackedReviewHarness({
      modelAlias: {
        provider: new InvalidLineFindingProvider(),
        model: 'invalid-line',
        capabilities: ['object']
      }
    })

    const result = await runModelBackedReviewWorkflow({
      harness,
      sessionId: 'test-session',
      input: {
        runId: 'test-run',
        reviewedPaths: ['src/app.ts'],
        evidence: [
          {
            id: 'ev_diff1',
            kind: 'diff',
            summary: 'Changed branch can return an incorrect value.',
            location: {
              path: 'src/app.ts',
              startLine: 1,
              side: 'new'
            },
            source: 'typescript-support-signal',
            contentHash:
              '2222222222222222222222222222222222222222222222222222222222222222',
            redactionApplied: true
          }
        ],
        candidates: [],
        instructions: [],
        skills: [],
        reviewContext: [
          {
            kind: 'file',
            path: 'src/app.ts',
            content: 'export const value = broken;\n',
            ledgerEntryId: 'ctx_aaaaaaaaaaaaaaaaaaaaaaaa'
          }
        ],
        baselineConfigured: false,
        provenance: {
          reviewer: 'review-agent',
          modelProvider: 'openai',
          modelName: 'invalid-line',
          signalVersions: {
            typescript: '6.0.3'
          },
          configHash
        },
        qualityGate: {}
      }
    })

    expect(result.admittedFindings).toEqual([])
    expect(result.rejectedFindings).toEqual([
      expect.objectContaining({
        reason: 'location-invalid',
        message: 'Candidate location line range is outside reviewed source input.'
      })
    ])
    expect(
      JSON.parse(
        renderGithubReviewComments({
          schemaVersion: '1.0',
          run: {
            runId: 'test-run',
            startedAt: '2026-06-20T00:00:00.000Z',
            completedAt: '2026-06-20T00:00:00.000Z',
            mode: 'local',
            depth: 'fast',
            repositoryRootHash:
              '1111111111111111111111111111111111111111111111111111111111111111',
            configHash,
            durationMs: 0,
            warnings: []
          },
          coverage: {
            status: 'complete',
            reviewableFileCount: 1,
            coveredFileCount: 1,
            reviewableBytes: 1,
            coveredBytes: 1,
            incompleteReasons: [],
            files: [
              {
                path: 'src/app.ts',
                contentHash:
                  '2222222222222222222222222222222222222222222222222222222222222222',
                status: 'complete',
                bytes: 1,
                coveredBytes: 1,
                taskIds: []
              }
            ]
          },
          admittedFindings: result.admittedFindings,
          rejectedFindings: result.rejectedFindings,
          evidence: result.evidence,
          refutationResults: [],
          providerIssues: [],
          skippedFiles: [],
          artifacts: []
        })
      )
    ).toEqual([])

    await harness.shutdown()
  })

  test('provider-backed workflow preserves structured manual fix edits', async () => {
    const harness = createModelBackedReviewHarness({
      modelAlias: {
        provider: new StructuredFixProvider(),
        model: 'structured-fix',
        capabilities: ['object']
      }
    })

    const result = await runModelBackedReviewWorkflow({
      harness,
      sessionId: 'test-session',
      input: {
        runId: 'test-run',
        reviewedPaths: ['src/app.ts'],
        evidence: [
          {
            id: 'ev_diff1',
            kind: 'diff',
            summary: 'Changed branch can return an incorrect value.',
            location: {
              path: 'src/app.ts',
              startLine: 4,
              side: 'new'
            },
            source: 'typescript-support-signal',
            contentHash:
              '2222222222222222222222222222222222222222222222222222222222222222',
            redactionApplied: true
          }
        ],
        candidates: [],
        instructions: [],
        skills: [],
        reviewContext: [
          {
            kind: 'file',
            path: 'src/app.ts',
            content: [
              'const input = 1',
              'const intermediate = input + 1',
              'const expected = intermediate + 1',
              'export const value = broken'
            ].join('\n'),
            ledgerEntryId: 'ctx_aaaaaaaaaaaaaaaaaaaaaaaa'
          }
        ],
        baselineConfigured: false,
        provenance: {
          reviewer: 'review-agent',
          modelProvider: 'openai',
          modelName: 'structured-fix',
          signalVersions: {
            typescript: '6.0.3'
          },
          configHash
        },
        qualityGate: {}
      }
    })

    expect(result.admittedFindings[0]?.fixProposal).toMatchObject({
      summary: 'Return the expected value from the changed branch.',
      evidenceIds: expect.arrayContaining([
        expect.stringMatching(/^ev_[a-f0-9]+$/)
      ]),
      safety: 'manual-review',
      edits: [
        {
          path: 'src/app.ts',
          startLine: 4,
          endLine: 4,
          replacement: 'return expectedValue',
          description: 'Replace the incorrect branch return value.'
        }
      ]
    })

    await harness.shutdown()
  })

  test('runner preserves partial shared context when a provider task fails', async () => {
    const root = join(tmpdir(), `codereviewer-partial-run-${crypto.randomUUID()}`)
    const provider = new FailingSecondTaskProvider()

    try {
      await mkdir(join(root, 'src'), { recursive: true })
      await writeFile(join(root, 'src', 'a.ts'), 'export const a = 1;\n')
      await writeFile(join(root, 'src', 'b.ts'), 'export const b = 2;\n')

      const config = CodeReviewerConfigSchema.parse({
        provider: {
          id: 'openai',
          model: 'failing-model',
          maxRetries: 0
        },
        review: {
          depth: 'fast',
          maxConcurrentTasks: 1
        },
        aiReview: {
        },
        drift: {
          enabled: false
        }
      })

      let capturedError: unknown
      try {
        await runReview({
          repositoryRoot: root,
          config,
          explicitFiles: ['src/a.ts', 'src/b.ts'],
          environment: {
            OPENAI_API_KEY: 'sk-proj-secret-value'
          },
          runId: 'run-partial',
          now: () => new Date('2026-06-20T00:00:00.000Z'),
          providerImport: async () => ({
            openai: () => provider
          })
        })
      } catch (error) {
        capturedError = error
      }

      expect(isReviewRunFailedError(capturedError)).toBe(true)
      if (!isReviewRunFailedError(capturedError)) {
        throw new Error('expected ReviewRunFailedError')
      }

      expect(provider.requests).toHaveLength(2)
      expect(capturedError.structuredError).toMatchObject({
        code: 'provider_error',
        category: 'provider',
        exitCode: 4
      })
      expect(capturedError.structuredError.message).not.toContain(
        'sk-proj-secret-value'
      )
      expect(capturedError.partialState.artifactRoot).toBe(
        '.codereviewer/runs/run-partial'
      )
      expect(capturedError.partialState.runSummary.warnings).toContain(
        'partial-run'
      )
      expect(capturedError.partialState.sharedContext.taskEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            paths: ['src/a.ts'],
            state: 'completed',
            message: 'worker completed'
          }),
          expect.objectContaining({
            paths: ['src/b.ts'],
            state: 'failed',
            message: 'worker failed'
          })
        ])
      )
      expect(JSON.stringify(capturedError.partialState.sharedContext)).not.toContain(
        'sk-proj-secret-value'
      )
      expect(capturedError.partialState.sharedContext.currentTasks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            paths: ['src/a.ts'],
            state: 'completed'
          }),
          expect.objectContaining({
            paths: ['src/b.ts'],
            state: 'failed'
          })
        ])
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('runner enforces whole-run timeout and preserves partial task state', async () => {
    const root = join(tmpdir(), `codereviewer-run-timeout-${crypto.randomUUID()}`)
    const provider = new HangingProvider()

    try {
      await mkdir(join(root, 'src'), { recursive: true })
      await writeFile(join(root, 'src', 'a.ts'), 'export const a = 1;\n')

      const config = CodeReviewerConfigSchema.parse({
        provider: {
          id: 'openai',
          model: 'hanging-model',
          maxRetries: 0
        },
        review: {
          depth: 'fast'
        },
        drift: {
          enabled: false
        }
      })
      const timeoutConfig = {
        ...config,
        review: {
          ...config.review,
          runTimeoutMs: 250
        }
      }

      let capturedError: unknown
      try {
        await runReview({
          repositoryRoot: root,
          config: timeoutConfig,
          explicitFiles: ['src/a.ts'],
          environment: {
            OPENAI_API_KEY: 'sk-proj-secret-value'
          },
          runId: 'run-timeout',
          now: () => new Date('2026-06-20T00:00:00.000Z'),
          providerImport: async () => ({
            openai: () => provider
          })
        })
      } catch (error) {
        capturedError = error
      }

      expect(isReviewRunFailedError(capturedError)).toBe(true)
      if (!isReviewRunFailedError(capturedError)) {
        throw new Error('expected ReviewRunFailedError')
      }

      expect(provider.requests).toHaveLength(1)
      expect(capturedError.structuredError).toMatchObject({
        code: 'review_run_timeout',
        category: 'provider',
        exitCode: 4
      })
      expect(capturedError.partialState.sharedContext.taskEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            paths: ['src/a.ts'],
            state: 'failed'
          })
        ])
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('runner applies provider-aware default task context budget', async () => {
    const root = join(tmpdir(), `codereviewer-provider-budget-${crypto.randomUUID()}`)
    const provider = new EmptyFindingProvider()

    try {
      await mkdir(join(root, 'src'), { recursive: true })
      await writeFile(
        join(root, 'src', 'large.ts'),
        `export const start = 1;\n${'// filler\n'.repeat(12000)}tail-marker-should-not-reach-provider\n`
      )

      const config = CodeReviewerConfigSchema.parse({
        provider: {
          id: 'openai',
          model: 'bounded-model',
          maxRetries: 0
        },
        review: {
          depth: 'balanced'
        },
        aiReview: {
        },
        drift: {
          enabled: false
        }
      })

      const result = await runReview({
        repositoryRoot: root,
        config,
        explicitFiles: ['src/large.ts'],
        environment: {
          OPENAI_API_KEY: 'sk-proj-secret-value'
        },
        runId: 'run-provider-budget',
        now: () => new Date('2026-06-20T00:00:00.000Z'),
        providerImport: async () => ({
          openai: () => provider
        })
      })

      expect(result.report.run.warnings).toEqual(['cost-unavailable'])
      expect(result.report.coverage).toMatchObject({
        status: 'complete',
        reviewableFileCount: 1,
        coveredFileCount: 1
      })
      expect(result.contextLedger).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: 'src/large.ts',
            decision: 'included',
            reason: 'task-context-source-chunk'
          })
        ])
      )
      expect(
        result.contextLedger
          .filter((entry) => entry.reason === 'task-context-source-chunk')
          .reduce((total, entry) => total + entry.bytesIncluded, 0)
      ).toBe(result.report.coverage.reviewableBytes)
      expect(provider.requests.length).toBeGreaterThan(1)
      expect(JSON.stringify(provider.requests)).toContain(
        'tail-marker-should-not-reach-provider'
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('runner batches full-scope provider review into compact task packets', async () => {
    const root = join(tmpdir(), `codereviewer-provider-batch-${crypto.randomUUID()}`)
    const provider = new EmptyFindingProvider()

    try {
      await mkdir(join(root, 'src'), { recursive: true })

      for (let index = 0; index < 24; index += 1) {
        await writeFile(
          join(root, 'src', `file-${index}.ts`),
          [
            `export const value${index} = ${index};`,
            `export const label${index} = "${'x'.repeat(300)}";`
          ].join('\n')
        )
      }

      const config = CodeReviewerConfigSchema.parse({
        provider: {
          id: 'openai',
          model: 'batch-model',
          maxRetries: 0
        },
        review: {
          depth: 'balanced',
          contextMaxBytes: 10000
        },
        aiReview: {
        },
        drift: {
          enabled: false
        }
      })

      const result = await runReview({
        repositoryRoot: root,
        config,
        explicitFiles: Array.from({ length: 24 }, (_, index) =>
          `src/file-${index}.ts`
        ),
        environment: {
          OPENAI_API_KEY: 'sk-proj-secret-value'
        },
        runId: 'run-provider-batch',
        now: () => new Date('2026-06-20T00:00:00.000Z'),
        providerImport: async () => ({
          openai: () => provider
        })
      })

      expect(result.report.coverage).toMatchObject({
        status: 'complete',
        reviewableFileCount: 24,
        coveredFileCount: 24
      })
      expect(provider.requests.length).toBeLessThan(24)
      expect(provider.requests.length).toBeGreaterThan(1)
      expect(
        result.contextLedger.filter(
          (entry) => entry.reason === 'task-context-source-chunk'
        )
      ).toHaveLength(24)

      await expect(
        stat(
          join(
            root,
            '.codereviewer',
            'runs',
            'run-provider-batch',
            'durable'
          )
        )
      ).rejects.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('runner splits large provider task packets instead of trimming them', async () => {
    const root = join(tmpdir(), `codereviewer-packet-ledger-${crypto.randomUUID()}`)
    const provider = new EmptyFindingProvider()

    try {
      await mkdir(join(root, 'src'), { recursive: true })
      await writeFile(
        join(root, 'src', 'large.ts'),
        `export const start = 1;\n${'// packet filler\n'.repeat(1200)}packet-tail-marker\n`
      )

      const config = CodeReviewerConfigSchema.parse({
        provider: {
          id: 'openai',
          model: 'packet-budget-model',
          maxRetries: 0
        },
        review: {
          depth: 'fast',
          contextMaxBytes: 10000
        },
        aiReview: {
        },
        drift: {
          enabled: false
        }
      })

      const result = await runReview({
        repositoryRoot: root,
        config,
        explicitFiles: ['src/large.ts'],
        environment: {
          OPENAI_API_KEY: 'sk-proj-secret-value'
        },
        runId: 'run-packet-ledger',
        now: () => new Date('2026-06-20T00:00:00.000Z'),
        providerImport: async () => ({
          openai: () => provider
        })
      })

      expect(result.report.run.warnings).toEqual(['cost-unavailable'])
      expect(result.report.coverage.status).toBe('complete')
      const taskContextEntry = result.contextLedger.find(
        (entry) =>
          entry.path === 'src/large.ts' &&
          entry.reason === 'task-context-source-chunk'
      )

      expect(taskContextEntry).toEqual(
        expect.objectContaining({
          decision: 'included'
        })
      )
      expect(
        result.contextLedger
          .filter((entry) => entry.reason === 'task-context-source-chunk')
          .reduce((total, entry) => total + entry.bytesIncluded, 0)
      ).toBe(result.report.coverage.reviewableBytes)
      expect(provider.requests.length).toBeGreaterThan(1)
      expect(JSON.stringify(provider.requests)).toContain('packet-tail-marker')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('runner records provider token usage and configured run cost', async () => {
    const root = join(tmpdir(), `codereviewer-provider-cost-${crypto.randomUUID()}`)
    const provider = new EmptyFindingProvider()

    try {
      await mkdir(join(root, 'src'), { recursive: true })
      await writeFile(join(root, 'src', 'a.ts'), 'export const a = 1;\n')
      await writeFile(join(root, 'src', 'b.ts'), 'export const b = 2;\n')

      const config = CodeReviewerConfigSchema.parse({
        provider: {
          id: 'openai',
          model: 'cost-model',
          maxRetries: 0
        },
        review: {
          depth: 'fast'
        },
        costs: {
          inputPerMillion: 1,
          outputPerMillion: 2
        },
        aiReview: {
        },
        drift: {
          enabled: false
        }
      })

      const result = await runReview({
        repositoryRoot: root,
        config,
        explicitFiles: ['src/a.ts', 'src/b.ts'],
        environment: {
          OPENAI_API_KEY: 'sk-proj-secret-value'
        },
        runId: 'run-provider-cost',
        now: () => new Date('2026-06-20T00:00:00.000Z'),
        providerImport: async () => ({
          openai: () => provider
        })
      })

      expect(provider.requests).toHaveLength(2)
      expect(result.report.run).toMatchObject({
        inputTokens: 2,
        outputTokens: 2,
        costUsd: 0.000006
      })
      expect(result.report.run.warnings).not.toContain('cost-unavailable')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('runner records provider token usage and built-in OpenAI model cost', async () => {
    const root = join(tmpdir(), `codereviewer-openai-cost-${crypto.randomUUID()}`)
    const provider = new EmptyFindingProvider()

    try {
      await mkdir(join(root, 'src'), { recursive: true })
      await writeFile(join(root, 'src', 'a.ts'), 'export const a = 1;\n')
      await writeFile(join(root, 'src', 'b.ts'), 'export const b = 2;\n')

      const config = CodeReviewerConfigSchema.parse({
        provider: {
          id: 'openai',
          model: 'gpt-5-mini',
          maxRetries: 0
        },
        review: {
          depth: 'fast'
        },
        aiReview: {
        },
        drift: {
          enabled: false
        }
      })

      const result = await runReview({
        repositoryRoot: root,
        config,
        explicitFiles: ['src/a.ts', 'src/b.ts'],
        environment: {
          OPENAI_API_KEY: 'sk-proj-secret-value'
        },
        runId: 'run-openai-cost',
        now: () => new Date('2026-06-20T00:00:00.000Z'),
        providerImport: async () => ({
          openai: () => provider
        })
      })

      expect(provider.requests).toHaveLength(2)
      expect(result.report.run).toMatchObject({
        inputTokens: 2,
        outputTokens: 2,
        costUsd: 0.000005
      })
      expect(result.report.run.warnings).not.toContain('cost-unavailable')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('runner validates context-only model suggestions without auto-attaching task evidence', async () => {
    const root = join(tmpdir(), `codereviewer-context-evidence-${crypto.randomUUID()}`)
    const provider = new ContextOnlyFindingProvider()

    try {
      await mkdir(join(root, 'src'), { recursive: true })
      await writeFile(
        join(root, 'src', 'app.ts'),
        [
          'const input = 1',
          'const intermediate = input + 1',
          'const expectedValue = intermediate + 1',
          'export const value = input > 0 ? intermediate : expectedValue'
        ].join('\n')
      )

      const config = CodeReviewerConfigSchema.parse({
        provider: {
          id: 'openai',
          model: 'gpt-5-mini',
          maxRetries: 0
        },
        review: {
          depth: 'fast'
        },
        aiReview: {
        },
        drift: {
          enabled: false
        }
      })

      const result = await runReview({
        repositoryRoot: root,
        config,
        explicitFiles: ['src/app.ts'],
        environment: {
          OPENAI_API_KEY: 'sk-proj-secret-value'
        },
        runId: 'run-context-evidence',
        now: () => new Date('2026-06-20T00:00:00.000Z'),
        providerImport: async () => ({
          openai: () => provider
        })
      })

      const taskRequest = provider.requests.find(
        (request) => !isFindingRefutationRequest(request)
      )
      const taskUserMessage = taskRequest?.messages.find(
        (message) => message.role === 'user'
      )
      const taskSystemMessage = taskRequest?.messages.find(
        (message) => message.role === 'system'
      )
      const taskInput = JSON.parse(String(taskUserMessage?.content)) as {
        readonly reviewText: string
      }
      const refutationRequest = provider.requests.find(
        isFindingRefutationCheckRequest
      )
      const refutationSystemMessage = refutationRequest?.messages.find(
        (message) => message.role === 'system'
      )
      const refutationUserMessage = refutationRequest?.messages.find(
        (message) => message.role === 'user'
      )
      const refutationInput = JSON.parse(
        String(refutationUserMessage?.content)
      ) as {
        readonly reviewContext: readonly { readonly path?: string }[]
      }

      expect(taskInput.reviewText).toContain(
        'export const value = input > 0 ? intermediate : expectedValue'
      )
      expect(String(taskSystemMessage?.content)).toContain(
        'You are a meticulous senior software engineer reviewing a code change.'
      )
      expect(String(taskSystemMessage?.content)).toContain(
        'non-atomic read-modify-write on shared mutable state'
      )
      expect(String(refutationSystemMessage?.content)).toContain(
        'Return "refuted" for vague clarity, strictness, or cleanup suggestions unless the candidate identifies a concrete runtime, security, or data-integrity failure.'
      )
      expect(String(refutationSystemMessage?.content)).toContain(
        'Return "needs-more-evidence" for spelling, import consistency, storage type preference, frontend-only formatting, or helper-refactor concerns unless context proves a concrete runtime, security, or data-integrity failure.'
      )
      expect(String(refutationSystemMessage?.content)).toContain(
        'Return "needs-more-evidence" for frontend API response-shape refutation concerns unless reviewContext proves malformed or untrusted response data can reach a concrete runtime failure.'
      )
      expect(String(refutationSystemMessage?.content)).toContain(
        'Return "refuted" for schema syntax claims when deterministic diagnostic evidence did not report a parse error for that file.'
      )
      expect(String(refutationSystemMessage?.content)).toContain(
        'Return "needs-more-evidence" for storage-format or encryption-preference claims unless context proves plaintext exposure, non-atomic consumption, or another concrete integrity failure.'
      )
      expect(refutationInput.reviewContext).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: 'src/app.ts'
          })
        ])
      )
      expect(provider.requests).toHaveLength(2)
      expect(result.sharedContext.candidateFindings).toHaveLength(1)
      expect(result.sharedContext.candidateFindings[0]?.evidenceIds).toEqual(
        []
      )
      expect(result.report.evidence.map((record) => record.kind)).toEqual(
        expect.arrayContaining(['file', 'model-rationale'])
      )
      expect(result.report.admittedFindings).toHaveLength(1)
      expect(result.report.admittedFindings[0]?.evidenceIds).toEqual(
        [expect.stringMatching(/^ev_[a-f0-9]+$/)]
      )
      expect(result.report.admittedFindings[0]?.admissionEvidenceIds).toEqual(
        [expect.stringMatching(/^ev_[a-f0-9]+$/)]
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('refutation check rejects model findings that depend on violating static contracts', async () => {
    const root = join(tmpdir(), `codereviewer-static-contract-${crypto.randomUUID()}`)
    const provider = new StaticContractSpeculationProvider()

    try {
      await mkdir(join(root, 'src'), { recursive: true })
      await writeFile(
        join(root, 'src', 'format.ts'),
        [
          'export const formatLabel = (value: string): string =>',
          "  value.trim().toUpperCase()"
        ].join('\n')
      )

      const config = CodeReviewerConfigSchema.parse({
        provider: {
          id: 'openai',
          model: 'gpt-5-mini',
          maxRetries: 0
        },
        review: {
          depth: 'fast'
        },
        aiReview: {
        },
        drift: {
          enabled: false
        }
      })

      const result = await runReview({
        repositoryRoot: root,
        config,
        explicitFiles: ['src/format.ts'],
        environment: {
          OPENAI_API_KEY: 'sk-proj-secret-value'
        },
        runId: 'run-static-contract',
        now: () => new Date('2026-06-20T00:00:00.000Z'),
        providerImport: async () => ({
          openai: () => provider
        })
      })

      expect(provider.requests).toHaveLength(2)
      expect(result.sharedContext.candidateFindings).toHaveLength(1)
      expect(result.report.admittedFindings).toEqual([])
      expect(result.report.rejectedFindings).toEqual([
        expect.objectContaining({
          reason: 'refuted'
        })
      ])
      expect(result.report.qualityGate?.passed).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('runner fails provider review when configured maxCostUsd is exceeded', async () => {
    const root = join(tmpdir(), `codereviewer-provider-cost-gate-${crypto.randomUUID()}`)
    const provider = new EmptyFindingProvider()

    try {
      await mkdir(join(root, 'src'), { recursive: true })
      await writeFile(join(root, 'src', 'a.ts'), 'export const a = 1;\n')

      const config = CodeReviewerConfigSchema.parse({
        provider: {
          id: 'openai',
          model: 'cost-model',
          maxRetries: 0
        },
        review: {
          depth: 'fast',
          maxCostUsd: 0.000001
        },
        costs: {
          inputPerMillion: 1,
          outputPerMillion: 2
        },
        aiReview: {
        },
        drift: {
          enabled: false
        }
      })

      let capturedError: unknown
      try {
        await runReview({
          repositoryRoot: root,
          config,
          explicitFiles: ['src/a.ts'],
          environment: {
            OPENAI_API_KEY: 'sk-proj-secret-value'
          },
          runId: 'run-provider-cost-gate',
          now: () => new Date('2026-06-20T00:00:00.000Z'),
          providerImport: async () => ({
            openai: () => provider
          })
        })
      } catch (error) {
        capturedError = error
      }

      expect(isReviewRunFailedError(capturedError)).toBe(true)
      if (!isReviewRunFailedError(capturedError)) {
        throw new Error('expected ReviewRunFailedError')
      }

      expect(capturedError.structuredError).toMatchObject({
        code: 'cost_budget_exceeded',
        category: 'quality-gate',
        exitCode: 1
      })
      expect(capturedError.partialState.runSummary).toMatchObject({
        inputTokens: 1,
        outputTokens: 1,
        costUsd: 0.000003
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('runner caps review tasks and provider calls with review.maxFiles', async () => {
    const root = join(tmpdir(), `codereviewer-max-files-${crypto.randomUUID()}`)
    const provider = new EmptyFindingProvider()

    try {
      await mkdir(join(root, 'src'), { recursive: true })
      await writeFile(join(root, 'src', 'a.ts'), 'export const a = 1;\n')
      await writeFile(join(root, 'src', 'b.ts'), 'export const b = 2;\n')

      const config = CodeReviewerConfigSchema.parse({
        provider: {
          id: 'openai',
          model: 'bounded-model',
          maxRetries: 0
        },
        review: {
          depth: 'fast',
          maxFiles: 1
        },
        aiReview: {
        },
        drift: {
          enabled: false
        }
      })

      const result = await runReview({
        repositoryRoot: root,
        config,
        explicitFiles: ['src/a.ts', 'src/b.ts'],
        environment: {
          OPENAI_API_KEY: 'sk-proj-secret-value'
        },
        runId: 'run-max-files',
        now: () => new Date('2026-06-20T00:00:00.000Z'),
        providerImport: async () => ({
          openai: () => provider
        })
      })

      expect(provider.requests).toHaveLength(1)
      expect(result.report.skippedFiles).toEqual([
        {
          path: 'src/b.ts',
          reason: 'too-many-files',
          message: 'Skipped because review.maxFiles is 1.'
        }
      ])
      expect(result.sharedContext.taskEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            paths: ['src/a.ts'],
            state: 'completed'
          })
        ])
      )
      expect(result.sharedContext.taskEvents).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            paths: ['src/b.ts']
          })
        ])
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('support-signal-only runner records task events from the queue', async () => {
    const root = join(tmpdir(), `codereviewer-support-signal-queue-${crypto.randomUUID()}`)

    try {
      await mkdir(join(root, 'src'), { recursive: true })
      await writeFile(join(root, 'src', 'a.ts'), 'export const a = ;\n')

      const config = CodeReviewerConfigSchema.parse({
        review: {
          depth: 'fast',
          maxConcurrentTasks: 1
        },
        drift: {
          enabled: false
        }
      })

      const result = await runReview({
        repositoryRoot: root,
        config,
        explicitFiles: ['src/a.ts'],
        runId: 'run-support-signal-queue',
        now: () => new Date('2026-06-20T00:00:00.000Z')
      })

      expect(result.sharedContext.taskEvents.map((event) => event.state)).toEqual([
        'planned',
        'running',
        'completed'
      ])
      expect(result.sharedContext.currentTasks).toEqual([
        expect.objectContaining({
          id: result.sharedContext.taskEvents[0]?.id,
          state: 'completed'
        })
      ])
      expect(result.sharedContext.taskEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            workerId: 'deterministic-worker-1',
            message: 'deterministic support signal task completed'
          })
        ])
      )
      expect(result.sharedContext.sharedEntries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: 'deterministic-worker-1',
            summary: expect.stringContaining('deterministic support signal task completed')
          })
        ])
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('deterministic support signal extraction observability records structural engine provenance without content', async () => {
    const root = join(tmpdir(), `codereviewer-support-signal-observability-${crypto.randomUUID()}`)

    try {
      await mkdir(join(root, 'src'), { recursive: true })
      await writeFile(join(root, 'src', 'app.ts'), 'export const app = 1;\n')
      await writeFile(
        join(root, 'src', 'app.test.ts'),
        'import { app } from "./app.js";\nexport const observed = app;\n'
      )

      const config = CodeReviewerConfigSchema.parse({
        review: {
          depth: 'fast',
          maxConcurrentTasks: 1
        },
        drift: {
          enabled: false
        }
      })

      const result = await runReview({
        repositoryRoot: root,
        config,
        explicitFiles: ['src/app.ts', 'src/app.test.ts'],
        runId: 'run-support-signal-observability',
        now: () => new Date('2026-06-20T00:00:00.000Z')
      })
      const deterministicSignalStep = result.observability.events.find(
        (event) => event.type === 'step-ended' && event.step === 'deterministic_signals'
      )
      const serialized = JSON.stringify(result.observability)

      expect(deterministicSignalStep).toMatchObject({
        type: 'step-ended',
        step: 'deterministic_signals',
        attributes: expect.objectContaining({
          structuralEngine: 'typescript-compiler+ast-grep',
          astGrepVersion: expect.stringMatching(/^ast-grep@/u),
          languageCount: 1,
          testMappingCount: 2
        })
      })
      expect(serialized).not.toContain('export const app')
      expect(serialized).not.toContain('import { app }')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('provider-backed runner records task observability before workflow completion', async () => {
    const root = join(tmpdir(), `codereviewer-provider-observability-${crypto.randomUUID()}`)
    const provider = new RollingQueueProvider()

    try {
      await mkdir(join(root, 'src'), { recursive: true })
      await writeFile(join(root, 'src', 'a.ts'), 'export const a = 1;\n')
      await writeFile(join(root, 'src', 'b.ts'), 'export const b = 1;\n')
      await writeFile(join(root, 'src', 'c.ts'), 'export const c = 1;\n')

      const config = CodeReviewerConfigSchema.parse({
        provider: {
          id: 'openai',
          model: 'observability-model',
          maxRetries: 0
        },
        review: {
          depth: 'balanced',
          maxConcurrentTasks: 1
        },
        aiReview: {
        },
        drift: {
          enabled: false
        }
      })

      const result = await runReview({
        repositoryRoot: root,
        config,
        explicitFiles: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
        environment: {
          OPENAI_API_KEY: 'sk-proj-secret-value'
        },
        runId: 'run-provider-observability',
        now: () => new Date('2026-06-20T00:00:00.000Z'),
        providerImport: async () => ({
          openai: () => provider
        })
      })
      const providerStepEnded = result.observability.events.find(
        (event) => event.type === 'step-ended' && event.step === 'provider_workflow'
      )
      const firstTaskEvent = result.observability.events.find(
        (event) => event.type === 'task-event'
      )

      expect(providerStepEnded).toBeDefined()
      expect(firstTaskEvent).toBeDefined()
      expect(Date.parse(firstTaskEvent?.at ?? '')).toBeLessThan(
        Date.parse(providerStepEnded?.at ?? '')
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('runner allocates dependency-cluster context across files instead of skipping tail files', async () => {
    const root = join(tmpdir(), `codereviewer-context-fairness-${crypto.randomUUID()}`)

    try {
      await mkdir(join(root, 'src'), { recursive: true })
      for (let index = 0; index < 3; index += 1) {
        await writeFile(
          join(root, 'src', `file-${index}.ts`),
          [
            `export const value${index} = ${index};`,
            `export const filler${index} = "${'x'.repeat(7000)}";`
          ].join('\n')
        )
      }

      const config = CodeReviewerConfigSchema.parse({
        review: {
          depth: 'balanced',
          contextMaxBytes: 10000
        },
        drift: {
          enabled: false
        }
      })

      const result = await runReview({
        repositoryRoot: root,
        config,
        explicitFiles: ['src/file-0.ts', 'src/file-1.ts', 'src/file-2.ts'],
        runId: 'run-context-fairness',
        now: () => new Date('2026-06-20T00:00:00.000Z')
      })
      const fileBudgetEntries = result.contextLedger.filter(
        (entry) =>
          entry.kind === 'file' && entry.reason === 'task-context-source-chunk'
      )

      expect([...new Set(fileBudgetEntries.map((entry) => entry.path))].sort()).toEqual([
        'src/file-0.ts',
        'src/file-1.ts',
        'src/file-2.ts'
      ])
      expect(fileBudgetEntries.every((entry) => entry.bytesIncluded > 0)).toBe(
        true
      )
      expect(fileBudgetEntries.every((entry) => entry.decision === 'included')).toBe(true)
      expect(result.report.coverage.status).toBe('complete')
      expect(
        fileBudgetEntries.reduce(
          (total, entry) => total + entry.bytesIncluded,
          0
        )
      ).toBe(result.report.coverage.reviewableBytes)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('runner does not emit non-owned support signal evidence for TypeScript files', async () => {
    const root = join(tmpdir(), `codereviewer-ts-routing-${crypto.randomUUID()}`)

    try {
      await mkdir(join(root, 'src'), { recursive: true })
      await writeFile(join(root, 'src', 'app.ts'), 'export const value = ;\n')

      const config = CodeReviewerConfigSchema.parse({
        review: {
          depth: 'fast'
        },
        drift: {
          enabled: false
        }
      })

      const result = await runReview({
        repositoryRoot: root,
        config,
        explicitFiles: ['src/app.ts'],
        runId: 'run-ts-routing',
        now: () => new Date('2026-06-20T00:00:00.000Z')
      })
      const serialized = JSON.stringify(result.report)

      expect(result.report.evidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: 'typescript-support-signal',
            location: expect.objectContaining({
              path: 'src/app.ts'
            })
          })
        ])
      )
      expect(serialized).not.toContain('go-support-signal')
      expect(serialized).not.toContain('python-support-signal')
      expect(serialized).not.toContain('rust-support-signal')
      expect(serialized).not.toContain('java-support-signal')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('runner keeps explicit-file parse diagnostics as support evidence', async () => {
    const root = join(tmpdir(), `codereviewer-explicit-diff-map-${crypto.randomUUID()}`)

    try {
      await mkdir(join(root, 'src'), { recursive: true })
      await writeFile(join(root, 'src', 'app.ts'), 'export const value = ;\n')

      const config = CodeReviewerConfigSchema.parse({
        review: {
          depth: 'fast'
        },
        drift: {
          enabled: false
        }
      })
      const reviewDiffMaps = parseGitDiffMaps(
        [
          'diff --git a/src/app.ts b/src/app.ts',
          '--- a/src/app.ts',
          '+++ b/src/app.ts',
          '@@ -1,0 +1,1 @@',
          '+export const value = ;'
        ].join('\n')
      )

      const result = await runReview({
        repositoryRoot: root,
        config,
        explicitFiles: ['src/app.ts'],
        runId: 'run-explicit-diff-map',
        now: () => new Date('2026-06-20T00:00:00.000Z'),
        ...{ reviewDiffMaps }
      })

      expect(result.report.evidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'diagnostic',
            source: 'typescript-support-signal',
            location: expect.objectContaining({
              path: 'src/app.ts',
              startLine: 1,
              side: 'file'
            })
          })
        ])
      )
      expect(result.report.admittedFindings).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('runner includes reviewed diff ranges in model task packets', async () => {
    const root = join(tmpdir(), `codereviewer-task-diff-ranges-${crypto.randomUUID()}`)
    const provider = new EmptyFindingProvider()

    try {
      await mkdir(join(root, 'src'), { recursive: true })
      await writeFile(
        join(root, 'src', 'app.ts'),
        [
          'export function run() {',
          '  logger.Error("debug state", "count", count)',
          '}'
        ].join('\n')
      )

      const config = CodeReviewerConfigSchema.parse({
        provider: {
          id: 'openai',
          model: 'gpt-5-mini',
          maxRetries: 0
        },
        review: {
          depth: 'fast'
        },
        aiReview: {
        },
        drift: {
          enabled: false
        }
      })
      const reviewDiffMaps = parseGitDiffMaps(
        [
          'diff --git a/src/app.ts b/src/app.ts',
          'new file mode 100644',
          '--- /dev/null',
          '+++ b/src/app.ts',
          '@@ -1,0 +1,3 @@',
          '+export function run() {',
          '+  logger.Error("debug state", "count", count)',
          '+}'
        ].join('\n')
      )

      await runReview({
        repositoryRoot: root,
        config,
        explicitFiles: ['src/app.ts'],
        environment: {
          OPENAI_API_KEY: 'sk-proj-secret-value'
        },
        runId: 'run-task-diff-ranges',
        now: () => new Date('2026-06-20T00:00:00.000Z'),
        providerImport: async () => ({
          openai: () => provider
        }),
        reviewDiffMaps
      })

      const taskRequest = provider.requests.find(
        (request) => !isFindingRefutationRequest(request)
      )
      const taskUserMessage = taskRequest?.messages.find(
        (message) => message.role === 'user'
      )
      const taskInput = JSON.parse(String(taskUserMessage?.content)) as {
        readonly reviewText: string
      }

      expect(taskInput.reviewText).toContain('src/app.ts')
      expect(taskInput.reviewText).toContain(
        'logger.Error("debug state", "count", count)'
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  // Removed: end-to-end runner tests that asserted the benchmark-fitted
  // deterministic rule evidence (go-error-log-after-nil-check and the
  // typescript-backup-code-* rules). Those rules were removed as eval-gaming;
  // the runner now surfaces only generic facts and parse diagnostics from the
  // deterministic extractors.
})
