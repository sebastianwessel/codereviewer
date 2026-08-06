import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { CodeReviewerConfigSchema } from '../../shared/contracts/index.js'
import { runDriftCheck } from './drift-checker.js'

const createRoot = async (): Promise<string> => {
  const root = join(tmpdir(), `codereviewer-drift-${crypto.randomUUID()}`)
  await mkdir(root, { recursive: true })
  return root
}

describe('drift checker', () => {
  test('passes for valid docs and matching generated schemas', async () => {
    const root = await createRoot()

    try {
      await mkdir(join(root, 'docs'), { recursive: true })
      await mkdir(join(root, 'specs', '03-contracts'), { recursive: true })
      await mkdir(join(root, 'schema'), { recursive: true })
      await writeFile(
        join(root, 'README.md'),
        [
          '# CodeReviewer',
          '',
          'CodeReviewer is documented here.',
          'Default excludes include `.codereviewer/**`.',
          '',
          '[Docs](docs/README.md)',
          '',
          '```bash',
          'npx tsx src/cli/main.ts review --file src/app.ts',
          '```'
        ].join('\n')
      )
      await writeFile(join(root, 'docs', 'README.md'), '# Docs\n')
      await writeFile(join(root, 'schema', 'codereviewer-config.schema.json'), '{"ok":true}\n')
      await writeFile(join(root, 'specs', '03-contracts', 'config.schema.json'), '{"ok":true}\n')

      const result = await runDriftCheck({
        repositoryRoot: root,
        config: CodeReviewerConfigSchema.parse({})
      })

      expect(result.passed).toBe(true)
      expect(result.findings).toEqual([])
      // A pass is only meaningful if the comparison happened. Without this the
      // assertions above are equally satisfied by a check that read nothing.
      expect(result.generatedArtifactStatus).toBe('compared')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('flags documented CLI commands that are not implemented', async () => {
    const root = await createRoot()

    try {
      await mkdir(join(root, 'docs'), { recursive: true })
      await writeFile(
        join(root, 'README.md'),
        ['Run `codereviewer review` to review.', 'Run `codereviewer publish` to ship.'].join(
          '\n'
        )
      )

      const result = await runDriftCheck({
        repositoryRoot: root,
        config: CodeReviewerConfigSchema.parse({})
      })

      const implementationDrift = result.findings.filter(
        (finding) => finding.category === 'implementation-drift'
      )
      expect(implementationDrift).toHaveLength(1)
      expect(implementationDrift[0]?.evidence).toBe('codereviewer publish')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('flags stale queue-owned provider retry claims', async () => {
    const root = await createRoot()

    try {
      await mkdir(join(root, 'docs'), { recursive: true })
      await writeFile(
        join(root, 'README.md'),
        [
          'Provider-backed tasks use bounded queue-owned retries for transient failures.',
          'The queue owns bounded retries and records attempt counts.'
        ].join('\n')
      )

      const result = await runDriftCheck({
        repositoryRoot: root,
        config: CodeReviewerConfigSchema.parse({})
      })

      const retryDrift = result.findings.filter(
        (finding) => finding.category === 'implementation-drift'
      )
      expect(retryDrift).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: 'Stale provider retry ownership claim found.',
            evidence: 'queue-owned retries'
          }),
          expect.objectContaining({
            message: 'Stale provider retry ownership claim found.',
            evidence: 'queue owns bounded retries'
          })
        ])
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('classifies stale paths, broken links, generated drift, and ambiguity', async () => {
    const root = await createRoot()

    try {
      await mkdir(join(root, 'docs'), { recursive: true })
      await mkdir(join(root, 'specs', '03-contracts'), { recursive: true })
      await mkdir(join(root, 'schema'), { recursive: true })
      await writeFile(
        join(root, 'README.md'),
        [
          '[Missing](docs/missing.md)',
          'Old path spec/07-security-privacy-operations.md',
          `Old artifact .${'review'}/runs`,
          'This should be robust.'
        ].join('\n')
      )
      await writeFile(join(root, 'schema', 'codereviewer-config.schema.json'), '{"a":1}\n')
      await writeFile(join(root, 'specs', '03-contracts', 'config.schema.json'), '{"a":2}\n')

      const result = await runDriftCheck({
        repositoryRoot: root,
        config: CodeReviewerConfigSchema.parse({})
      })

      expect(result.passed).toBe(false)
      expect(result.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ category: 'documentation-drift' }),
          expect.objectContaining({ category: 'spec-drift' }),
          expect.objectContaining({ category: 'security-drift', gate: 'error' }),
          expect.objectContaining({ category: 'generated-artifact-drift', gate: 'error' }),
          expect.objectContaining({ category: 'ambiguity', gate: 'warning' })
        ])
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('does not read a slash-separated word as a stale spec root', async () => {
    const root = await createRoot()

    try {
      await writeFile(
        join(root, 'README.md'),
        'Drift checks flag documentation/spec/implementation mismatches.\n'
      )

      const result = await runDriftCheck({
        repositoryRoot: root,
        config: CodeReviewerConfigSchema.parse({})
      })

      expect(
        result.findings.filter((finding) => finding.category === 'spec-drift')
      ).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('does not read a review-prefixed identifier as the obsolete artifact root', async () => {
    const root = await createRoot()

    try {
      await writeFile(
        join(root, 'README.md'),
        'Configure `reporting.reviewComments.platform` to pick the renderer.\n'
      )

      const result = await runDriftCheck({
        repositoryRoot: root,
        config: CodeReviewerConfigSchema.parse({})
      })

      expect(
        result.findings.filter(
          (finding) => finding.category === 'security-drift'
        )
      ).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  // THE GATE'S OWN BLIND SPOT.
  //
  // `generated-artifact-drift` is one of only two categories that fail a build by
  // default, and it was the one check that passed silently on absence: both reads
  // were swallowed into `undefined` and any `undefined` returned zero findings. A
  // deleted, renamed or unreadable schema copy therefore produced `passed: true`.
  // Each case below asserts BOTH the finding and the status, because a status
  // without a finding would be a green build and a finding without a status would
  // leave "nothing was compared" indistinguishable from "the copies agree".
  describe('generated artifact comparison', () => {
    const generatedSchema = ['schema', 'codereviewer-config.schema.json'] as const
    const specsSchema = ['specs', '03-contracts', 'config.schema.json'] as const

    const generatedArtifactFindings = (
      result: Awaited<ReturnType<typeof runDriftCheck>>
    ) =>
      result.findings.filter(
        (finding) => finding.category === 'generated-artifact-drift'
      )

    const checkRoot = async (
      root: string
    ): Promise<Awaited<ReturnType<typeof runDriftCheck>>> =>
      runDriftCheck({
        repositoryRoot: root,
        config: CodeReviewerConfigSchema.parse({})
      })

    test.each([
      ['the generated copy', specsSchema, generatedSchema],
      ['the specs copy', generatedSchema, specsSchema]
    ])(
      'fails the build when only %s is present',
      async (_label, presentCopy, missingCopy) => {
        const root = await createRoot()

        try {
          await mkdir(join(root, ...presentCopy.slice(0, -1)), {
            recursive: true
          })
          await writeFile(join(root, ...presentCopy), '{"a":1}\n')

          const result = await checkRoot(root)
          const findings = generatedArtifactFindings(result)

          expect(result.generatedArtifactStatus).toBe('incomplete')
          expect(findings).toHaveLength(1)
          expect(findings[0]?.gate).toBe('error')
          expect(findings[0]?.path).toBe(missingCopy.join('/'))
          expect(result.passed).toBe(false)
        } finally {
          await rm(root, { recursive: true, force: true })
        }
      }
    )

    // The consumer-repository shape. Neither copy exists and that is legitimate,
    // so it must not fail — but it must not be reported as a comparison either.
    test('reports that nothing was compared when neither copy exists', async () => {
      const root = await createRoot()

      try {
        await writeFile(join(root, 'README.md'), '# Consumer repository\n')

        const result = await checkRoot(root)

        expect(result.generatedArtifactStatus).toBe('absent')
        expect(generatedArtifactFindings(result)).toEqual([])
        expect(result.passed).toBe(true)
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    })

    // A read that fails for any reason OTHER than the file not being there. A
    // directory in the file's place is the portable way to produce one; the point
    // is the error is not ENOENT, so "absent" would be the wrong conclusion.
    test('fails the build when a copy exists but cannot be read', async () => {
      const root = await createRoot()

      try {
        await mkdir(join(root, 'specs', '03-contracts'), { recursive: true })
        await writeFile(join(root, ...specsSchema), '{"a":1}\n')
        // A directory where the generated copy should be.
        await mkdir(join(root, ...generatedSchema), { recursive: true })

        const result = await checkRoot(root)
        const findings = generatedArtifactFindings(result)

        expect(result.generatedArtifactStatus).toBe('unreadable')
        expect(findings).toHaveLength(1)
        expect(findings[0]?.message).toBe(
          'Generated config schema copy could not be read.'
        )
        expect(findings[0]?.gate).toBe('error')
        expect(result.passed).toBe(false)
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    })

    test.each([
      ['generated artifacts are excluded', { drift: { includeGenerated: false } }],
      ['drift checking is off', { drift: { enabled: false } }]
    ])('reports that nothing was checked when %s', async (_label, overrides) => {
      const root = await createRoot()

      try {
        await mkdir(join(root, 'schema'), { recursive: true })
        await mkdir(join(root, 'specs', '03-contracts'), { recursive: true })
        await writeFile(join(root, ...generatedSchema), '{"a":1}\n')
        await writeFile(join(root, ...specsSchema), '{"a":2}\n')

        const result = await runDriftCheck({
          repositoryRoot: root,
          config: CodeReviewerConfigSchema.parse(overrides)
        })

        expect(result.generatedArtifactStatus).toBe('not-checked')
        expect(generatedArtifactFindings(result)).toEqual([])
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    })
  })

  test('still flags a genuine stale spec root reference', async () => {
    const root = await createRoot()

    try {
      await writeFile(
        join(root, 'README.md'),
        'See spec/05-review-workflow-and-runtime.md for details.\n'
      )

      const result = await runDriftCheck({
        repositoryRoot: root,
        config: CodeReviewerConfigSchema.parse({})
      })

      expect(result.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ category: 'spec-drift', evidence: 'spec/' })
        ])
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
