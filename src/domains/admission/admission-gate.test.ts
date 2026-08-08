import { resolveBaselineFingerprints } from './baseline-matcher.js'
import { describe, expect, test } from 'vitest'
import type { EvidenceRecord } from '../../shared/contracts/index.js'
import {
  admitCandidate,
  type CandidateFinding,
  type AdmissionPolicy
} from './admission-gate.js'
import {
  createSourceAnchorResolver,
  evaluateQualityGate,
  matchBaselineFindings,
  type BaselineFingerprintRecord
} from './index.js'

const configHash =
  '1111111111111111111111111111111111111111111111111111111111111111'

const diffEvidence: EvidenceRecord = {
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

const modelEvidence: EvidenceRecord = {
  id: 'ev_model1',
  kind: 'model-rationale',
  summary: 'The model thinks this looks wrong.',
  source: 'review-agent',
  redactionApplied: true
}

const candidate: CandidateFinding = {
  id: 'cand_bug1',
  taskId: 'task_bug1',
  category: 'bug',
  severity: 'high',
  title: 'Incorrect return branch',
  description: 'The changed branch can return an incorrect value for callers.',
  location: {
    path: 'src/app.ts',
    startLine: 4,
    side: 'new'
  },
  evidenceIds: ['ev_diff1'],
  proposedBy: 'review-agent',
  fixProposal: {
    summary: 'Return the computed value from the changed branch.',
    evidenceIds: ['ev_diff1'],
    safety: 'manual-review'
  }
}

const policy: AdmissionPolicy = {
  reviewedPaths: ['src/app.ts'],
  reviewedLineRanges: [
    {
      path: 'src/app.ts',
      startLine: 1,
      endLine: 20
    }
  ],
  minimumSeverity: 'low',
  inlineSeverityThreshold: 'high',
  provenance: {
    reviewer: 'review-agent',
    modelProvider: 'openai',
    modelName: 'gpt-5-mini',
    instructionHashes: [],
    skillHashes: [],
    signalVersions: {
      typescript: '6.0.3'
    },
    configHash
  },
  admittedAt: '2026-06-20T00:00:00.000Z'
}

const diffBackedPolicy = {
  ...policy,
  reviewedDiffRanges: [
    {
      path: 'src/app.ts',
      startLine: 4,
      endLine: 4
    }
  ]
}

describe('admission gate', () => {
  test('admits candidates with reviewed locations and evidence', () => {
    const result = admitCandidate({
      candidate,
      evidence: [diffEvidence],
      existingAdmittedFindings: [],
      policy: diffBackedPolicy
    })

    expect(result.status).toBe('admitted')
    expect(result.admittedFinding).toMatchObject({
      category: 'bug',
      severity: 'high',
      admissionStatus: 'admitted',
      reporterEligibility: 'inline',
      baselineStatus: 'new',
      evidenceIds: ['ev_diff1'],
      fixProposal: expect.objectContaining({
        safety: 'manual-review'
      })
    })
    expect(result.admittedFinding?.fingerprints[0]?.algorithm).toBe(
      'v3-category-path-anchor'
    )
  })

  // The title is written by the model and is different almost every run: across ten
  // identical runs of one pinned engine, 96% of cases produced a different
  // (category, path, title) set, with zero overlap on the cases inspected. A
  // fingerprint carrying it cannot survive a re-review, which is the one thing it
  // exists to do -- an unfixed finding reads as resolved AND newly introduced on
  // every push, and inline comments re-post instead of deduping.
  // The whole cross-push contract, end to end and deterministically: a finding is
  // admitted, its fingerprint is baselined, the author edits the anchored line, and
  // the next run must report the baselined finding as resolved while the untouched
  // one stays existing. Every step is a pure function, so this needs no provider.
  test('a fixed line resolves its baseline entry while an untouched one does not', () => {
    const before = 'const a = 1\nconst b = 2\nreturn wrongValue\nconst d = 4\n'
    const after = 'const a = 1\nconst b = 2\nreturn correctValue\nconst d = 4\n'

    const admitAt = (content: string, title: string) =>
      admitCandidate({
        candidate: { ...candidate, title, location: { ...candidate.location, startLine: 3 } },
        evidence: [
          {
            ...diffEvidence,
            location: { ...diffEvidence.location, path: 'src/app.ts', startLine: 3, side: 'new' }
          }
        ],
        existingAdmittedFindings: [],
        resolveAnchorText: createSourceAnchorResolver([
          { path: 'src/app.ts', content }
        ]),
        policy: {
          ...policy,
          reviewedDiffRanges: [{ path: 'src/app.ts', startLine: 3, endLine: 3 }]
        }
      }).admittedFinding

    const first = admitAt(before, 'Returns the wrong value')
    expect(first).toBeDefined()

    const baseline = [
      { fingerprints: first?.fingerprints ?? [] }
    ]

    // The author fixes the line. The model also rewords the title, as it does on
    // nearly every run — that must not affect the verdict either way.
    const afterFix = admitAt(after, 'Wrong value returned from the guard')
    expect(afterFix).toBeDefined()

    const resolved = resolveBaselineFingerprints(baseline, afterFix ? [afterFix] : [])
    expect(resolved).toHaveLength(1)
    expect(resolved[0]?.value).toBe(first?.fingerprints[0]?.value)

    // And the converse: an unchanged line resolves nothing, however the title moves.
    const unchanged = admitAt(before, 'Completely different wording for the same defect')
    expect(
      resolveBaselineFingerprints(baseline, unchanged ? [unchanged] : [])
    ).toEqual([])
  })

  test('keeps the fingerprint stable when only the model wording changes', () => {
    const source = 'const a = 1\nconst b = 2\nconst c = 3\nreturn wrongValue\n'

    const fingerprintForTitle = (title: string): string | undefined => {
      const result = admitCandidate({
        candidate: { ...candidate, title },
        evidence: [diffEvidence],
        existingAdmittedFindings: [],
        resolveAnchorText: createSourceAnchorResolver([
          { path: 'src/app.ts', content: source }
        ]),
        policy
      })

      return result.admittedFinding?.fingerprints[0]?.value
    }

    const first = fingerprintForTitle('Returns the wrong value on the error path')
    const reworded = fingerprintForTitle('Wrong value returned when the guard fails')

    expect(first).toBeDefined()
    expect(reworded).toBe(first)
  })

  test('keeps the fingerprint stable when edits above shift the finding', () => {
    const source = 'const a = 1\nconst b = 2\nconst c = 3\nreturn wrongValue\n'
    const shiftedSource = `// new header\n// another new line\n${source}`

    const fingerprintAt = (
      content: string,
      startLine: number
    ): string | undefined => {
      const result = admitCandidate({
        candidate: {
          ...candidate,
          location: { ...candidate.location, startLine }
        },
        evidence: [{ ...diffEvidence, location: { ...diffEvidence.location, path: 'src/app.ts', startLine, side: 'new' } }],
        existingAdmittedFindings: [],
        resolveAnchorText: createSourceAnchorResolver([
          { path: 'src/app.ts', content }
        ]),
        policy: {
          ...policy,
          reviewedDiffRanges: [
            { path: 'src/app.ts', startLine, endLine: startLine }
          ]
        }
      })

      return result.admittedFinding?.fingerprints[0]?.value
    }

    // `return wrongValue` moves from line 4 to line 6; the anchored text does
    // not change, so the finding keeps its identity across the push.
    expect(fingerprintAt(source, 4)).toBe(fingerprintAt(shiftedSource, 6))
    expect(fingerprintAt(source, 4)).toBeDefined()
  })

  test('changes the fingerprint when the anchored line itself changes', () => {
    const before = 'const a = 1\nconst b = 2\nconst c = 3\nreturn wrongValue\n'
    const after = 'const a = 1\nconst b = 2\nconst c = 3\nreturn correctValue\n'

    const fingerprintFor = (content: string): string | undefined =>
      admitCandidate({
        candidate,
        evidence: [diffEvidence],
        existingAdmittedFindings: [],
        resolveAnchorText: createSourceAnchorResolver([
          { path: 'src/app.ts', content }
        ]),
        policy: diffBackedPolicy
      }).admittedFinding?.fingerprints[0]?.value

    expect(fingerprintFor(before)).not.toBe(fingerprintFor(after))
  })

  test('distinguishes same-titled findings anchored on different lines', () => {
    const content = 'first(bad)\nsecond(alsoBad)\n'
    const resolveAnchorText = createSourceAnchorResolver([
      { path: 'src/app.ts', content }
    ])

    const first = admitCandidate({
      candidate: { ...candidate, location: { ...candidate.location, startLine: 1 } },
      evidence: [diffEvidence],
      existingAdmittedFindings: [],
      resolveAnchorText,
      policy: { ...policy, reviewedDiffRanges: [{ path: 'src/app.ts', startLine: 1, endLine: 2 }] }
    })
    const second = admitCandidate({
      candidate: { ...candidate, id: 'cand_bug2', location: { ...candidate.location, startLine: 2 } },
      evidence: [diffEvidence],
      existingAdmittedFindings: [],
      resolveAnchorText,
      policy: { ...policy, reviewedDiffRanges: [{ path: 'src/app.ts', startLine: 1, endLine: 2 }] }
    })

    expect(first.admittedFinding?.fingerprints[0]?.value).not.toBe(
      second.admittedFinding?.fingerprints[0]?.value
    )
  })

  test('marks source-valid candidates outside changed hunks as summary-only', () => {
    const result = admitCandidate({
      candidate: {
        ...candidate,
        location: {
          path: 'src/app.ts',
          startLine: 6,
          side: 'new'
        }
      },
      evidence: [diffEvidence],
      existingAdmittedFindings: [],
      policy: diffBackedPolicy
    })

    expect(result.status).toBe('admitted')
    expect(result.admittedFinding?.reporterEligibility).toBe('summary-only')
  })

  test('does not invent inline eligibility when diff maps are explicitly empty', () => {
    const result = admitCandidate({
      candidate,
      evidence: [diffEvidence],
      existingAdmittedFindings: [],
      policy: {
        ...policy,
        reviewedDiffRanges: []
      }
    })

    expect(result.status).toBe('admitted')
    expect(result.admittedFinding?.reporterEligibility).toBe('summary-only')
  })

  // Every model-origin candidate is stamped `side: 'file'` by discovery, because
  // the model reads line-numbered file content and cannot be trusted to say which
  // side of the diff a line belongs to. Inline eligibility used to require
  // `side === 'new'`, so no model finding could ever be inline and the whole
  // review-comment surface produced zero drafts. Admission owns the diff ranges,
  // so admission is the only place that can decide this without guessing.
  describe('whole-file locations', () => {
    const wholeFileCandidate: CandidateFinding = {
      ...candidate,
      location: {
        path: 'src/app.ts',
        startLine: 4,
        side: 'file'
      }
    }

    test('marks a whole-file finding inline when its line sits in a changed hunk', () => {
      const result = admitCandidate({
        candidate: wholeFileCandidate,
        evidence: [diffEvidence],
        existingAdmittedFindings: [],
        policy: diffBackedPolicy
      })

      expect(result.status).toBe('admitted')
      expect(result.admittedFinding?.reporterEligibility).toBe('inline')
    })

    test('keeps a whole-file finding outside every changed hunk summary-only', () => {
      const result = admitCandidate({
        candidate: {
          ...wholeFileCandidate,
          location: { path: 'src/app.ts', startLine: 6, side: 'file' }
        },
        evidence: [diffEvidence],
        existingAdmittedFindings: [],
        policy: diffBackedPolicy
      })

      // A real defect that a change merely exposes stays a reported finding; it
      // just has no changed line a review comment could anchor to.
      expect(result.status).toBe('admitted')
      expect(result.admittedFinding?.reporterEligibility).toBe('summary-only')
    })

    test('still applies the inline severity threshold to whole-file findings', () => {
      const result = admitCandidate({
        candidate: { ...wholeFileCandidate, severity: 'medium' },
        evidence: [diffEvidence],
        existingAdmittedFindings: [],
        policy: diffBackedPolicy
      })

      expect(result.status).toBe('admitted')
      expect(result.admittedFinding?.reporterEligibility).toBe('summary-only')
    })

    test('keeps whole-file findings summary-only when the run has no diff ranges', () => {
      const result = admitCandidate({
        candidate: wholeFileCandidate,
        evidence: [diffEvidence],
        existingAdmittedFindings: [],
        policy
      })

      // Without diff ranges nothing proves the line was changed, and a whole-file
      // location carries no side of its own to fall back on.
      expect(result.status).toBe('admitted')
      expect(result.admittedFinding?.reporterEligibility).toBe('summary-only')
    })

    test('changes only presentation: the admitted finding is otherwise identical', () => {
      const inHunk = admitCandidate({
        candidate: wholeFileCandidate,
        evidence: [diffEvidence],
        existingAdmittedFindings: [],
        policy: diffBackedPolicy
      })
      const outsideHunk = admitCandidate({
        candidate: wholeFileCandidate,
        evidence: [diffEvidence],
        existingAdmittedFindings: [],
        policy: {
          ...policy,
          reviewedDiffRanges: [{ path: 'src/app.ts', startLine: 9, endLine: 9 }]
        }
      })

      expect(inHunk.admittedFinding?.reporterEligibility).toBe('inline')
      expect(outsideHunk.admittedFinding?.reporterEligibility).toBe(
        'summary-only'
      )
      // Identity, severity, evidence and fingerprint are untouched by the hunk
      // test: inline eligibility decides how a finding is presented, never
      // whether it is admitted.
      expect({
        ...inHunk.admittedFinding,
        reporterEligibility: 'summary-only' as const
      }).toEqual(outsideHunk.admittedFinding)
    })
  })

  test('rejects new-side candidates outside reviewed source line ranges', () => {
    const result = admitCandidate({
      candidate: {
        ...candidate,
        location: {
          path: 'src/app.ts',
          startLine: 99,
          side: 'new'
        }
      },
      evidence: [diffEvidence],
      existingAdmittedFindings: [],
      policy
    })

    expect(result).toEqual({
      status: 'rejected',
      rejectedFinding: {
        candidateId: 'cand_bug1',
        status: 'rejected',
        reason: 'location-invalid',
        message: 'Candidate location line range is outside reviewed source input.',
        evidenceIds: ['ev_diff1'],
        severity: 'high'
      }
    })
  })

  test('rejects a candidate outside the source chunk its task was given', () => {
    // A large file is split into chunks and each chunk becomes its own task. A
    // candidate from the second chunk that points at a line the second chunk did
    // not contain is a mis-numbered location: it lands inside the file, so the
    // whole-file range check accepts it, and the finding then anchors its
    // fingerprint on the wrong source line. Only the chunk range catches it.
    const chunkPolicy: AdmissionPolicy = {
      ...policy,
      reviewedLineRanges: [{ path: 'src/app.ts', startLine: 1, endLine: 400 }],
      taskSourceChunkRanges: [
        { taskId: 'task_bug1', path: 'src/app.ts', startLine: 201, endLine: 400 }
      ]
    }

    expect(
      admitCandidate({
        candidate: {
          ...candidate,
          location: { path: 'src/app.ts', startLine: 4, side: 'new' }
        },
        evidence: [diffEvidence],
        existingAdmittedFindings: [],
        policy: chunkPolicy
      })
    ).toEqual({
      status: 'rejected',
      rejectedFinding: {
        candidateId: 'cand_bug1',
        status: 'rejected',
        reason: 'location-invalid',
        message:
          'Candidate location is outside the source chunk its review task was given.',
        evidenceIds: ['ev_diff1'],
        severity: 'high'
      }
    })

    // The same candidate inside the chunk it came from is admitted unchanged.
    expect(
      admitCandidate({
        candidate: {
          ...candidate,
          location: { path: 'src/app.ts', startLine: 210, side: 'new' }
        },
        evidence: [diffEvidence],
        existingAdmittedFindings: [],
        policy: chunkPolicy
      }).status
    ).toBe('admitted')
  })

  test('leaves single-chunk (small file) admission untouched', () => {
    // Every file that fits in one chunk gets a chunk range equal to its whole-file
    // range, so the extra check can never reject a finding the previous gate
    // admitted. This is the case for every file in both evaluation corpora.
    expect(
      admitCandidate({
        candidate,
        evidence: [diffEvidence],
        existingAdmittedFindings: [],
        policy: {
          ...policy,
          taskSourceChunkRanges: [
            { taskId: 'task_bug1', path: 'src/app.ts', startLine: 1, endLine: 20 }
          ]
        }
      }).status
    ).toBe('admitted')

    // A candidate whose task has no chunk provenance at all (deterministic
    // candidates, or a task that never carried file context) is unaffected.
    expect(
      admitCandidate({
        candidate,
        evidence: [diffEvidence],
        existingAdmittedFindings: [],
        policy: {
          ...policy,
          taskSourceChunkRanges: [
            { taskId: 'task_other', path: 'src/app.ts', startLine: 900, endLine: 999 }
          ]
        }
      }).status
    ).toBe('admitted')
  })

  test('keeps old-side candidates out of inline eligibility', () => {
    const result = admitCandidate({
      candidate: {
        ...candidate,
        location: {
          path: 'src/app.ts',
          startLine: 4,
          side: 'old'
        }
      },
      evidence: [diffEvidence],
      existingAdmittedFindings: [],
      policy
    })

    expect(result.status).toBe('admitted')
    expect(result.admittedFinding?.reporterEligibility).toBe('summary-only')
  })

  test('rejects schema-invalid candidates', () => {
    const result = admitCandidate({
      candidate: {
        ...candidate,
        severity: 'urgent'
      },
      evidence: [diffEvidence],
      existingAdmittedFindings: [],
      policy
    })

    expect(result.rejectedFinding).toEqual({
      candidateId: 'cand_bug1',
      status: 'rejected',
      reason: 'schema-invalid',
      message: expect.stringContaining('Candidate failed schema validation.'),
      evidenceIds: ['ev_diff1']
    })
  })

  test('accepts intent-grouped task ids (task_intent_<hex>)', () => {
    // Regression: model-intent runs assign candidates an intent task id whose
    // underscore previously failed the candidate schema and surfaced as a
    // spurious provider configuration error.
    const result = admitCandidate({
      candidate: {
        ...candidate,
        taskId: 'task_intent_0a1b2c3d4e5f6071'
      },
      evidence: [diffEvidence],
      existingAdmittedFindings: [],
      policy: diffBackedPolicy
    })

    expect(result.status).toBe('admitted')
    expect(result.rejectedFinding).toBeUndefined()
  })

  test('admits model-rationale candidates when evidence is present', () => {
    const result = admitCandidate({
      candidate: {
        ...candidate,
        evidenceIds: ['ev_model1'],
        fixProposal: {
          summary: 'Apply the proof-backed fix.',
          evidenceIds: ['ev_model1'],
          safety: 'manual-review'
        }
      },
      evidence: [modelEvidence],
      existingAdmittedFindings: [],
      policy
    })

    expect(result.status).toBe('admitted')
    expect(result.admittedFinding?.evidenceIds).toEqual(['ev_model1'])
    expect(result.admittedFinding?.admissionEvidenceIds).toEqual(['ev_model1'])
  })

  test('rejects invalid locations, duplicate fingerprints, and below-threshold severity', () => {
    const admitted = admitCandidate({
      candidate,
      evidence: [diffEvidence],
      existingAdmittedFindings: [],
      policy
    }).admittedFinding

    expect(admitted).toBeDefined()

    expect(
      admitCandidate({
        candidate: {
          ...candidate,
          location: {
            path: 'src/other.ts',
            startLine: 1,
            side: 'new'
          }
        },
        evidence: [diffEvidence],
        existingAdmittedFindings: [],
        policy
      }).rejectedFinding
    ).toMatchObject({ reason: 'location-invalid' })

    expect(
      admitCandidate({
        candidate,
        evidence: [diffEvidence],
        existingAdmittedFindings: [admitted!],
        policy
      }).rejectedFinding
    ).toMatchObject({ reason: 'duplicate' })

    expect(
      admitCandidate({
        candidate: {
          ...candidate,
          severity: 'info'
        },
        evidence: [diffEvidence],
        existingAdmittedFindings: [],
        policy: {
          ...policy,
          minimumSeverity: 'medium'
        }
      }).rejectedFinding
    ).toMatchObject({ reason: 'below-threshold' })
  })

  test('rejects same-evidence same-location duplicates even when title wording differs', () => {
    const admitted = admitCandidate({
      candidate: {
        ...candidate,
        proposedBy: 'typescript-support-signal',
        title: 'Parse diagnostic blocks reliable review'
      },
      evidence: [diffEvidence],
      existingAdmittedFindings: [],
      policy
    }).admittedFinding

    expect(admitted).toBeDefined()

    const result = admitCandidate({
      candidate: {
        ...candidate,
        id: 'cand_modelduplicate',
        proposedBy: 'review-agent',
        title: 'TypeScript parse error: Expression expected',
        description:
          'The TypeScript support signal extractor reported the same parse diagnostic at the same location.'
      },
      evidence: [diffEvidence],
      existingAdmittedFindings: [admitted!],
      policy
    })

    expect(result.rejectedFinding).toMatchObject({
      candidateId: 'cand_modelduplicate',
      reason: 'duplicate'
    })
  })

  test('rejects fix proposals that are not tied to candidate evidence', () => {
    const result = admitCandidate({
      candidate: {
        ...candidate,
        fixProposal: {
          summary: 'Change the branch.',
          evidenceIds: ['ev_missing'],
          safety: 'manual-review'
        }
      },
      evidence: [diffEvidence],
      existingAdmittedFindings: [],
      policy
    })

    expect(result.rejectedFinding).toMatchObject({
      reason: 'schema-invalid'
    })
  })

  test('applies the actionable severity floor to EVERY candidate, with no exemption', () => {
    const floorPolicy = { ...diffBackedPolicy, actionableSeverityThreshold: 'medium' as const }

    // Low-severity model finding -> rejected below-threshold.
    const lowModel = admitCandidate({
      candidate: { ...candidate, severity: 'low' },
      evidence: [diffEvidence],
      existingAdmittedFindings: [],
      policy: floorPolicy
    })
    expect(lowModel.status).toBe('rejected')
    expect(lowModel.rejectedFinding?.reason).toBe('below-threshold')

    // Medium-severity model finding -> admitted (meets the floor).
    const mediumModel = admitCandidate({
      candidate: { ...candidate, severity: 'medium' },
      evidence: [diffEvidence],
      existingAdmittedFindings: [],
      policy: floorPolicy
    })
    expect(mediumModel.status).toBe('admitted')

    // There used to be an exemption here for `deterministic-trusted-rule`
    // candidates. Its only producer was a map of benchmark-specific rule ids,
    // removed as eval-gaming, so the exemption became a severity-floor bypass with
    // nothing to trigger it. A low-severity candidate is now rejected whatever
    // claims to have proposed it.
    const lowTrusted = admitCandidate({
      candidate: {
        ...candidate,
        severity: 'low',
        proposedBy: 'deterministic-trusted-rule'
      },
      evidence: [diffEvidence],
      existingAdmittedFindings: [],
      policy: floorPolicy
    })
    expect(lowTrusted.status).toBe('rejected')
    expect(lowTrusted.rejectedFinding?.reason).toBe('below-threshold')
  })

  test('redacts model-controlled finding text before admission', () => {
    const result = admitCandidate({
      candidate: {
        ...candidate,
        title: 'Leaked sk-proj-abcdefghijklmnopqrstuvwxyz123456',
        description:
          'Provider echoed Authorization: Bearer very-secret-token-value',
        fixProposal: {
          summary: 'Use sk-proj-abcdefghijklmnopqrstuvwxyz123456 nowhere.',
          evidenceIds: ['ev_diff1'],
          safety: 'manual-review'
        }
      },
      evidence: [diffEvidence],
      existingAdmittedFindings: [],
      policy
    })

    expect(result.admittedFinding?.title).not.toContain('sk-proj')
    expect(result.admittedFinding?.description).not.toContain(
      'very-secret-token-value'
    )
    expect(result.admittedFinding?.fixProposal?.summary).not.toContain('sk-proj')
    expect(JSON.stringify(result.admittedFinding)).toContain('[REDACTED]')
  })

  test('truncates redaction-expanded text back to the contract cap', () => {
    // Redaction can lengthen text: the URL-credential pattern rewrites the
    // 8-char `a://b:c@` to the 15-char `a://[REDACTED]@`. A title that is valid
    // (<=120) before redaction can exceed the cap after, which previously failed
    // AdmittedFindingSchema validation at admission time.
    const title = `${'x'.repeat(107)}a://b:c@`
    expect(title.length).toBeLessThanOrEqual(120)

    const result = admitCandidate({
      candidate: { ...candidate, title },
      evidence: [diffEvidence],
      existingAdmittedFindings: [],
      policy
    })

    // Before the fix this failed schema validation (title > 120) instead of
    // being admitted. The credential must be gone and the cap must hold (the
    // marker may itself be truncated at the boundary, which is acceptable).
    expect(result.status).toBe('admitted')
    expect(result.admittedFinding?.title.length).toBeLessThanOrEqual(120)
    // The security property, and the only one that must never bend: the
    // credential is gone. It is gone whether or not the `[REDACTED]` marker
    // survives the cut.
    expect(result.admittedFinding?.title).not.toContain('b:c@')
    expect(result.admittedFinding?.title).not.toContain('a://b')
    // And the cut announces itself. This replaces an assertion that the whole
    // word `REDACTED` survived — which the comment above already disclaimed as
    // boundary-dependent, and which the truncation mark shifted by one
    // character. Asserting the mark is the claim that is actually true here.
    expect(result.admittedFinding?.title).toContain('…')
  })
})

describe('baseline and quality gate', () => {
  test('matches existing findings by fingerprint and reports missing configured baseline', () => {
    const admitted = admitCandidate({
      candidate,
      evidence: [diffEvidence],
      existingAdmittedFindings: [],
      policy
    }).admittedFinding!
    const baseline: BaselineFingerprintRecord[] = [
      {
        fingerprints: admitted.fingerprints
      }
    ]

    expect(
      matchBaselineFindings({
        admittedFindings: [admitted],
        baselineFingerprints: baseline,
        baselineConfigured: true
      }).admittedFindings[0]?.baselineStatus
    ).toBe('existing')

    const missingBaseline = matchBaselineFindings({
      admittedFindings: [admitted],
      baselineConfigured: true
    })
    expect(missingBaseline.warnings).toEqual(['baseline-missing'])
    // A configured-but-missing baseline yields indeterminate (`unknown`) status.
    expect(missingBaseline.admittedFindings[0]?.baselineStatus).toBe('unknown')
  })

  test('reports resolved baseline entries and fails gate on unknown findings', () => {
    const admitted = admitCandidate({
      candidate,
      evidence: [diffEvidence],
      existingAdmittedFindings: [],
      policy
    }).admittedFinding!
    const resolvedFingerprint = { algorithm: 'v1', value: 'resolvedonly' }

    const result = matchBaselineFindings({
      admittedFindings: [admitted],
      baselineFingerprints: [{ fingerprints: [resolvedFingerprint] }],
      baselineConfigured: true
    })
    expect(result.resolvedBaselineFingerprints).toEqual([resolvedFingerprint])
    expect(result.admittedFindings[0]?.baselineStatus).toBe('new')

    // `unknown` findings are treated as new for failOnNewOnly (fail-safe).
    const unknownFinding = { ...admitted, baselineStatus: 'unknown' as const }
    expect(
      evaluateQualityGate({
        admittedFindings: [unknownFinding],
        thresholds: { maxHigh: 0, failOnNewOnly: true }
      }).passed
    ).toBe(false)
  })

  test('quality gate considers admitted findings only and can fail on new only', () => {
    const admitted = admitCandidate({
      candidate,
      evidence: [diffEvidence],
      existingAdmittedFindings: [],
      policy
    }).admittedFinding!

    expect(
      evaluateQualityGate({
        admittedFindings: [admitted],
        thresholds: {
          maxHigh: 0,
          failOnNewOnly: true
        }
      })
    ).toMatchObject({
      passed: false,
      failingFindingIds: [admitted.id],
      baselineFilteringApplied: true
    })
  })

  // `failOnProviderError` defaults to true and was declared by two specs, but
  // the gate never read it: it saw only what survived, so a discovery or
  // refutation outage shrank the set it measures and it passed over the
  // remainder. A provider failure made a change MORE likely to clear the gate.
  test('an unrecovered provider issue fails the gate on its own', () => {
    expect(
      evaluateQualityGate({
        admittedFindings: [],
        thresholds: { maxHigh: 0 },
        providerIssues: [{ recovered: false }]
      })
    ).toMatchObject({
      passed: false,
      // Nothing to name: the failure is that findings are MISSING.
      failingFindingIds: []
    })
  })

  test('a recovered provider issue does not fail the gate', () => {
    // A retry that succeeded lost nothing, and must stay visible in the report
    // without failing the run.
    expect(
      evaluateQualityGate({
        admittedFindings: [],
        thresholds: { maxHigh: 0 },
        providerIssues: [{ recovered: true }]
      }).passed
    ).toBe(true)
  })

  test('an issue that does not say whether it recovered is treated as unrecovered', () => {
    // `recovered` is optional on the contract. Reading absence as recovery is
    // absence read as clearance, on the field that exists to report trouble.
    expect(
      evaluateQualityGate({
        admittedFindings: [],
        thresholds: { maxHigh: 0 },
        providerIssues: [{}]
      }).passed
    ).toBe(false)
  })

  test('failOnProviderError: false turns the provider check off and nothing else', () => {
    expect(
      evaluateQualityGate({
        admittedFindings: [],
        thresholds: { maxHigh: 0, failOnProviderError: false },
        providerIssues: [{ recovered: false }]
      })
    ).toMatchObject({
      passed: true,
      thresholds: expect.objectContaining({ failOnProviderError: false })
    })
  })

  test('quality gate ignores artifact-only findings', () => {
    const admitted = admitCandidate({
      candidate,
      evidence: [diffEvidence],
      existingAdmittedFindings: [],
      policy
    }).admittedFinding!
    const artifactOnly = {
      ...admitted,
      reporterEligibility: 'artifact-only' as const
    }

    expect(
      evaluateQualityGate({
        admittedFindings: [artifactOnly],
        thresholds: {
          maxHigh: 0,
          failOnNewOnly: true
        }
      })
    ).toMatchObject({
      passed: true,
      failingFindingIds: []
    })
  })
})
