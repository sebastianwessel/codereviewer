import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'vitest'
import type {
  JsonValue,
  ModelProvider,
  ObjectRequest,
  ObjectResponse
} from '@purista/harness'
import {
  createModelBackedReviewHarness,
  createReviewHarness,
  isReviewTaskExecutionError,
  runModelBackedReviewWorkflow,
  runScriptedReviewWorkflow
} from './harness-workflow.js'
import {
  CodeReviewerConfigSchema
} from '../../shared/contracts/index.js'
import {
  isReviewRunFailedError,
  runReview
} from './review-runner.js'
import { renderGithubReviewComments } from '../reporting/github-review-comments.js'
import { parseGitDiffMaps } from '../repository-intake/index.js'

const configHash =
  '1111111111111111111111111111111111111111111111111111111111111111'

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

class UnusedProvider implements ModelProvider {
  readonly id = 'unused'
  readonly genAiSystem = 'scripted'

  async object<T extends JsonValue = JsonValue>(
    _req: ObjectRequest<T>
  ): Promise<ObjectResponse<T>> {
    throw new Error('default tests must not call external model providers')
  }
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
      object: { candidates: [] } as unknown as T,
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
      object: { candidates: [] } as unknown as T,
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
        object: { candidates: [] } as unknown as T,
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

class RollingQueueProvider implements ModelProvider {
  readonly id = 'rolling-queue'
  readonly genAiSystem = 'scripted'
  activeRequests = 0
  maxActiveRequests = 0
  readonly starts: number[] = []
  readonly completions: number[] = []
  readonly requests: ObjectRequest[] = []

  async object<T extends JsonValue = JsonValue>(
    req: ObjectRequest<T>
  ): Promise<ObjectResponse<T>> {
    const index = this.requests.length
    this.requests.push(req)
    this.starts[index] = Date.now()
    this.activeRequests += 1
    this.maxActiveRequests = Math.max(
      this.maxActiveRequests,
      this.activeRequests
    )

    try {
      await new Promise((resolve) =>
        setTimeout(resolve, index === 0 ? 80 : 10)
      )
      this.completions[index] = Date.now()

      return {
        object: { candidates: [] } as unknown as T,
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
    _req: ObjectRequest<T>
  ): Promise<ObjectResponse<T>> {
    return {
      object: {
        candidates: [
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
    _req: ObjectRequest<T>
  ): Promise<ObjectResponse<T>> {
    return {
      object: {
        candidates: [
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

class DuplicateSeedFindingProvider implements ModelProvider {
  readonly id = 'duplicate-seed'
  readonly genAiSystem = 'scripted'

  async object<T extends JsonValue = JsonValue>(
    _req: ObjectRequest<T>
  ): Promise<ObjectResponse<T>> {
    return {
      object: {
        candidates: [
          {
            category: 'bug',
            severity: 'high',
            title: 'Parse diagnostic blocks reliable review',
            description:
              'Syntax parse diagnostic reported by typescript-analyzer.',
            path: 'src/app.ts',
            startLine: 1,
            evidenceIds: ['ev_diag1'],
            fixSummary: 'Fix the syntax issue and rerun review.'
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
    _req: ObjectRequest<T>
  ): Promise<ObjectResponse<T>> {
    return {
      object: {
        candidates: [
          {
            category: 'bug',
            severity: 'high',
            title: 'Changed branch returns wrong value',
            description:
              'The reviewed task evidence shows the changed branch can return the wrong value.',
            path: 'src/app.ts',
            startLine: 4,
            evidenceIds: ['ev_diff1'],
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

class SharedDigestProvider implements ModelProvider {
  readonly id = 'shared-digest'
  readonly genAiSystem = 'scripted'
  readonly requests: ObjectRequest[] = []

  async object<T extends JsonValue = JsonValue>(
    req: ObjectRequest<T>
  ): Promise<ObjectResponse<T>> {
    this.requests.push(req)

    if (this.requests.length === 1) {
      return {
        object: {
          candidates: [
            {
              category: 'bug',
              severity: 'high',
              title: 'First task issue',
              description:
                'The first task evidence supports a finding that later workers should see in shared context.',
              path: 'src/a.ts',
              startLine: 1,
              evidenceIds: ['ev_a'],
              fixSummary: 'Fix the first task issue.'
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
      object: { candidates: [] } as unknown as T,
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
  test('runs a scripted harness workflow and admits supported findings', async () => {
    const harness = createReviewHarness({
      modelAlias: {
        provider: new UnusedProvider(),
        model: 'scripted',
        capabilities: ['object', 'tool_use']
      }
    })

    const result = await runScriptedReviewWorkflow({
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
            source: 'typescript-analyzer',
            contentHash:
              '2222222222222222222222222222222222222222222222222222222222222222',
            redactionApplied: true
          }
        ],
        candidates: [
          {
            id: 'cand_bug1',
            taskId: 'task_bug1',
            category: 'bug',
            severity: 'high',
            title: 'Incorrect return branch',
            description:
              'The changed branch can return an incorrect value for callers.',
            location: {
              path: 'src/app.ts',
              startLine: 4,
              side: 'new'
            },
            evidenceIds: ['ev_diff1'],
            proposedBy: 'review-agent'
          }
        ],
        instructions: [
          {
            path: '.review/instructions.md',
            content: 'Prefer evidence-backed findings.',
            allowed: true
          }
        ],
        skills: [
          {
            name: 'secure-review',
            path: '.review/skills/secure-review/SKILL.md',
            directory: '.review/skills/secure-review',
            contentHash:
              '3333333333333333333333333333333333333333333333333333333333333333',
            allowed: true
          }
        ],
        reviewContext: [
          {
            kind: 'file',
            path: 'src/app.ts',
            content: [
              'const input = 1',
              'const intermediate = input + 1',
              'const expected = intermediate + 1',
              'export const value = expected'
            ].join('\n'),
            ledgerEntryId: 'ctx_111111111111111111111111'
          }
        ],
        baselineConfigured: false,
        provenance: {
          reviewer: 'review-agent',
          modelProvider: 'openai',
          modelName: 'gpt-5-mini',
          analyzerVersions: {
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
    expect(result.rejectedFindings).toHaveLength(0)
    expect(result.qualityGate.passed).toBe(false)
    expect(result.instructionHashes).toHaveLength(1)
    expect(result.skillHashes).toHaveLength(1)
    expect(result.skillHashes).toEqual([
      '3333333333333333333333333333333333333333333333333333333333333333'
    ])
    expect(JSON.stringify(result)).not.toContain('Prefer evidence-backed findings.')
    expect(JSON.stringify(result)).not.toContain('Security review checklist.')

    await harness.shutdown()
  })

  test('scripted workflow makes outside-hunk findings summary-only', async () => {
    const harness = createReviewHarness({
      modelAlias: {
        provider: new UnusedProvider(),
        model: 'scripted',
        capabilities: ['object', 'tool_use']
      }
    })
    const input = {
      runId: 'test-run',
      reviewedPaths: ['src/app.ts'],
      reviewedDiffRanges: [
        {
          path: 'src/app.ts',
          startLine: 1,
          endLine: 1
        }
      ],
      evidence: [
        {
          id: 'ev_diff1',
          kind: 'diff' as const,
          summary: 'Changed branch can return an incorrect value.',
          location: {
            path: 'src/app.ts',
            startLine: 6,
            side: 'new' as const
          },
          source: 'typescript-analyzer',
          contentHash:
            '2222222222222222222222222222222222222222222222222222222222222222',
          redactionApplied: true
        }
      ],
      candidates: [
        {
          id: 'cand_bug1',
          taskId: 'task_bug1',
          category: 'bug' as const,
          severity: 'high' as const,
          title: 'Outside hunk finding',
          description: 'The finding is source-valid but outside the changed hunk.',
          location: {
            path: 'src/app.ts',
            startLine: 6,
            side: 'new' as const
          },
          evidenceIds: ['ev_diff1'],
          proposedBy: 'review-agent'
        }
      ],
      instructions: [],
      skills: [],
      reviewContext: [
        {
          kind: 'file' as const,
          path: 'src/app.ts',
          content: [
            'const changed = true',
            'const line2 = true',
            'const line3 = true',
            'const line4 = true',
            'const line5 = true',
            'export const value = changed'
          ].join('\n'),
          ledgerEntryId: 'ctx_111111111111111111111111'
        }
      ],
      baselineConfigured: false,
      provenance: {
        reviewer: 'review-agent',
        modelProvider: 'openai',
        modelName: 'scripted',
        analyzerVersions: {
          typescript: '6.0.3'
        },
        configHash
      },
      qualityGate: {}
    }

    const result = await runScriptedReviewWorkflow({
      harness,
      sessionId: 'test-session',
      input
    })

    expect(result.admittedFindings).toHaveLength(1)
    expect(result.admittedFindings[0]?.reporterEligibility).toBe('summary-only')

    await harness.shutdown()
  })

  test('provider-backed workflow keeps deterministic input candidates even when the model returns none', async () => {
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
            source: 'typescript-analyzer',
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
              'Syntax parse diagnostic reported by typescript-analyzer.',
            location: {
              path: 'src/app.ts',
              startLine: 1,
              side: 'file'
            },
            evidenceIds: ['ev_diag1'],
            proposedBy: 'typescript-analyzer',
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
            kind: 'analyzer-output',
            content: '{"diagnostics":1}',
            ledgerEntryId: 'ctx_222222222222222222222222'
          }
        ],
        baselineConfigured: false,
        provenance: {
          reviewer: 'review-agent',
          modelProvider: 'openai',
          modelName: 'empty',
          analyzerVersions: {
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
    expect(result.admittedFindings[0]?.proposedBy).toBe('typescript-analyzer')
    expect(JSON.stringify(result)).not.toContain('{"diagnostics":1}')
    expect(provider.requests[0]?.schema).toMatchObject({
      type: 'object',
      properties: {
        candidates: {
          type: 'array'
        }
      }
    })

    await harness.shutdown()
  })

  test('provider-backed workflow suppresses model echoes of deterministic candidates', async () => {
    const provider = new DuplicateSeedFindingProvider()
    const harness = createModelBackedReviewHarness({
      modelAlias: {
        provider,
        model: 'duplicate-seed',
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
            source: 'typescript-analyzer',
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
              'Syntax parse diagnostic reported by typescript-analyzer.',
            location: {
              path: 'src/app.ts',
              startLine: 1,
              side: 'file'
            },
            evidenceIds: ['ev_diag1'],
            proposedBy: 'typescript-analyzer'
          }
        ],
        instructions: [],
        skills: [],
        reviewContext: [
          {
            kind: 'analyzer-output',
            content: '{"diagnostics":1}',
            ledgerEntryId: 'ctx_222222222222222222222222'
          }
        ],
        baselineConfigured: false,
        provenance: {
          reviewer: 'review-agent',
          modelProvider: 'openai',
          modelName: 'duplicate-seed',
          analyzerVersions: {
            typescript: '6.0.3'
          },
          configHash
        },
        qualityGate: {}
      }
    })

    expect(result.candidateFindings).toHaveLength(1)
    expect(result.admittedFindings).toHaveLength(1)
    expect(result.admittedFindings[0]?.proposedBy).toBe('typescript-analyzer')
    expect(result.rejectedFindings).toHaveLength(0)

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
          analyzerVersions: {
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
        analyzerVersions: {
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
            analyzerVersions: {
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
            analyzerVersions: {
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

  test('provider-backed workflow shares admitted digest across sequential task workers', async () => {
    const provider = new SharedDigestProvider()
    const harness = createModelBackedReviewHarness({
      modelAlias: {
        provider,
        model: 'shared-digest',
        capabilities: ['object']
      }
    })

    try {
      const result = await runModelBackedReviewWorkflow({
        harness,
        sessionId: 'test-session',
        input: {
          runId: 'test-run',
          reviewedPaths: ['src/a.ts', 'src/b.ts'],
          evidence: [
            {
              id: 'ev_a',
              kind: 'diff',
              summary: 'First file changed.',
              location: {
                path: 'src/a.ts',
                startLine: 1,
                side: 'new'
              },
              source: 'typescript-analyzer',
              contentHash:
                '2222222222222222222222222222222222222222222222222222222222222222',
              redactionApplied: true
            },
            {
              id: 'ev_b',
              kind: 'diff',
              summary: 'Second file changed.',
              location: {
                path: 'src/b.ts',
                startLine: 1,
                side: 'new'
              },
              source: 'typescript-analyzer',
              contentHash:
                '4444444444444444444444444444444444444444444444444444444444444444',
              redactionApplied: true
            }
          ],
          candidates: [
            {
              id: 'cand_seed1',
              taskId: 'task_seed1',
              category: 'bug',
              severity: 'high',
              title: 'Initial unadmitted seed candidate',
              description:
                'Seed candidates must not appear in live worker digests before admission.',
              location: {
                path: 'src/b.ts',
                startLine: 1,
                side: 'new'
              },
              evidenceIds: ['ev_b'],
              proposedBy: 'review-agent',
              confidence: 0.8
            }
          ],
          instructions: [],
          skills: [],
          maxConcurrentTasks: 1,
          baselineConfigured: false,
          provenance: {
            reviewer: 'review-agent',
            modelProvider: 'openai',
            modelName: 'shared-digest',
            analyzerVersions: {
              typescript: '6.0.3'
            },
            configHash
          },
          qualityGate: {}
        }
      })

      expect(result.candidateFindings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            title: 'First task issue'
          })
        ])
      )
      expect(JSON.stringify(provider.requests[1]?.messages)).toContain(
        'First task issue'
      )
      const secondTaskUserMessage = provider.requests[1]?.messages.find(
        (message) => message.role === 'user'
      )
      const secondTaskInput = JSON.parse(String(secondTaskUserMessage?.content))
      expect(secondTaskInput.sharedDigest).not.toContain(
        'Initial unadmitted seed candidate'
      )
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
              analyzerVersions: {
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
        source: 'typescript-analyzer',
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
              analyzerVersions: {
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
              path: '.review/skills/secure-review/SKILL.md',
              directory: '.review/skills/secure-review',
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
            analyzerVersions: {
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
            source: 'typescript-analyzer',
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
          analyzerVersions: {
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
            source: 'typescript-analyzer',
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
          analyzerVersions: {
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
            source: 'typescript-analyzer',
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
          analyzerVersions: {
            typescript: '6.0.3'
          },
          configHash
        },
        qualityGate: {}
      }
    })

    expect(result.admittedFindings[0]?.fixProposal).toMatchObject({
      summary: 'Return the expected value from the changed branch.',
      evidenceIds: ['ev_diff1'],
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
        '.review/runs/run-partial'
      )
      expect(capturedError.partialState.runSummary.warnings).toContain(
        'partial-run'
      )
      expect(capturedError.partialState.sharedContext.tasks).toEqual(
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
      expect(capturedError.partialState.sharedContext.tasks).toEqual(
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
            '.review',
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
      expect(result.sharedContext.tasks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            paths: ['src/a.ts'],
            state: 'completed'
          })
        ])
      )
      expect(result.sharedContext.tasks).not.toEqual(
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

  test('analyzer-only runner records task events from the queue', async () => {
    const root = join(tmpdir(), `codereviewer-analyzer-queue-${crypto.randomUUID()}`)

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
        runId: 'run-analyzer-queue',
        now: () => new Date('2026-06-20T00:00:00.000Z')
      })

      expect(result.sharedContext.tasks.map((event) => event.state)).toEqual([
        'planned',
        'running',
        'completed'
      ])
      expect(result.sharedContext.taskEvents.map((event) => event.state)).toEqual([
        'planned',
        'running',
        'completed'
      ])
      expect(result.sharedContext.currentTasks).toEqual([
        expect.objectContaining({
          id: result.sharedContext.tasks[0]?.id,
          state: 'completed'
        })
      ])
      expect(result.sharedContext.tasks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            workerId: 'deterministic-worker-1',
            message: 'deterministic analyzer task completed'
          })
        ])
      )
      expect(result.sharedContext.sharedEntries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: 'deterministic-worker-1',
            summary: expect.stringContaining('deterministic analyzer task completed')
          })
        ])
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('language analysis observability records structural engine provenance without content', async () => {
    const root = join(tmpdir(), `codereviewer-language-observability-${crypto.randomUUID()}`)

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
        runId: 'run-language-observability',
        now: () => new Date('2026-06-20T00:00:00.000Z')
      })
      const languageStep = result.observability.events.find(
        (event) => event.type === 'step-ended' && event.step === 'language_analysis'
      )
      const serialized = JSON.stringify(result.observability)

      expect(languageStep).toMatchObject({
        type: 'step-ended',
        step: 'language_analysis',
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

  test('runner does not emit non-owned analyzer findings for TypeScript files', async () => {
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
            source: 'typescript-analyzer',
            location: expect.objectContaining({
              path: 'src/app.ts'
            })
          })
        ])
      )
      expect(serialized).not.toContain('go-analyzer')
      expect(serialized).not.toContain('python-analyzer')
      expect(serialized).not.toContain('rust-analyzer')
      expect(serialized).not.toContain('java-analyzer')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('runner uses supplied review diff maps for explicit-file inline eligibility', async () => {
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

      expect(result.report.admittedFindings[0]).toMatchObject({
        location: {
          path: 'src/app.ts',
          startLine: 1,
          side: 'new'
        },
        reporterEligibility: 'inline'
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('normalizes provider timeout, cancellation, and controlled context denial', async () => {
    await expect(
      runScriptedReviewWorkflow({
        harness: createReviewHarness({
          modelAlias: {
            provider: new UnusedProvider(),
            model: 'scripted',
            capabilities: ['object', 'tool_use']
          },
          failBeforeAdmission: 'provider-timeout'
        }),
        sessionId: 'test-session',
        input: {
          runId: 'test-run',
          reviewedPaths: ['src/app.ts'],
          evidence: [],
          candidates: [],
          instructions: [],
          skills: [],
          reviewContext: [],
          baselineConfigured: false,
          provenance: {
            reviewer: 'review-agent',
            analyzerVersions: {},
            configHash
          },
          qualityGate: {}
        }
      })
    ).rejects.toMatchObject({
      originalError: {
        code: 'provider_timeout',
        category: 'provider',
        exitCode: 4
      },
      taskEvents: expect.arrayContaining([
        expect.objectContaining({
          state: 'failed',
          message: 'worker failed'
        })
      ])
    })

    await expect(
      runScriptedReviewWorkflow({
        harness: createReviewHarness({
          modelAlias: {
            provider: new UnusedProvider(),
            model: 'scripted',
            capabilities: ['object', 'tool_use']
          }
        }),
        sessionId: 'test-session',
        input: {
          runId: 'test-run',
          reviewedPaths: ['src/app.ts'],
          evidence: [],
          candidates: [],
          instructions: [
            {
              path: '.review/instructions.md',
              content: 'secret instruction',
              allowed: false
            }
          ],
          skills: [],
          reviewContext: [],
          baselineConfigured: false,
          provenance: {
            reviewer: 'review-agent',
            analyzerVersions: {},
            configHash
          },
          qualityGate: {}
        }
      })
    ).rejects.toMatchObject({
      code: 'instruction_read_denied',
      category: 'config',
      exitCode: 2
    })
  })
})
