import { describe, expect, test } from 'vitest'
import {
  BaselineWriteStdoutEnvelopeSchema,
  CliErrorEnvelopeSchema,
  ReviewStdoutEnvelopeSchema,
  RunErrorArtifactSchema,
  StructuredErrorCategorySchema
} from './cli-output.schema.js'

// These four documents are the CLI's published output. The tests below are about
// the one property that was missing before the contracts existed: a renamed or
// invented field must be REJECTED, so that renaming one in a producer cannot pass
// silently. Everything else here follows from that.

describe('review stdout envelope', () => {
  test('accepts the envelope the command emits', () => {
    expect(
      ReviewStdoutEnvelopeSchema.parse({
        runId: '0199a2b7-0000-7000-8000-000000000000',
        qualityGatePassed: true,
        artifactDir: '.codereviewer/runs/0199a2b7-0000-7000-8000-000000000000'
      })
    ).toEqual({
      runId: '0199a2b7-0000-7000-8000-000000000000',
      qualityGatePassed: true,
      artifactDir: '.codereviewer/runs/0199a2b7-0000-7000-8000-000000000000'
    })
  })

  // The regression this whole contract exists for. `scripts/github/pipeline.ts`
  // reads `artifactDir` to decide what it uploads and comments on; a rename used
  // to break no test anywhere.
  test('rejects a renamed field', () => {
    expect(
      ReviewStdoutEnvelopeSchema.safeParse({
        runId: 'run-1',
        qualityGatePassed: true,
        artifactDirectory: '.codereviewer/runs/run-1'
      }).success
    ).toBe(false)
  })

  test('rejects a dropped field', () => {
    expect(
      ReviewStdoutEnvelopeSchema.safeParse({
        runId: 'run-1',
        artifactDir: '.codereviewer/runs/run-1'
      }).success
    ).toBe(false)
  })

  // `JSON.stringify` DROPS a key whose value is `undefined`, so an envelope can
  // lose a field at runtime with nothing at the type level to show for it. The
  // parse is what turns that into a failure instead of a plausible-looking
  // document CI reads a missing `artifactDir` out of.
  test('rejects an undefined value in a required field', () => {
    expect(
      ReviewStdoutEnvelopeSchema.safeParse({
        runId: 'run-1',
        qualityGatePassed: true,
        artifactDir: undefined
      }).success
    ).toBe(false)
  })

  test('rejects an empty run id and an artifact directory outside the repository', () => {
    expect(
      ReviewStdoutEnvelopeSchema.safeParse({
        runId: '',
        qualityGatePassed: true,
        artifactDir: '.codereviewer/runs/run-1'
      }).success
    ).toBe(false)
    expect(
      ReviewStdoutEnvelopeSchema.safeParse({
        runId: 'run-1',
        qualityGatePassed: true,
        artifactDir: '/tmp/runs/run-1'
      }).success
    ).toBe(false)
  })
})

describe('baseline write stdout envelope', () => {
  test('accepts the envelope the command emits', () => {
    expect(
      BaselineWriteStdoutEnvelopeSchema.parse({
        baselinePath: '.codereviewer/baseline.json',
        sourceReportPath: '.codereviewer/runs/run-1/report.json',
        entryCount: 0
      }).entryCount
    ).toBe(0)
  })

  test('rejects a renamed field', () => {
    expect(
      BaselineWriteStdoutEnvelopeSchema.safeParse({
        baselinePath: '.codereviewer/baseline.json',
        sourceReportPath: '.codereviewer/runs/run-1/report.json',
        count: 0
      }).success
    ).toBe(false)
  })

  test('rejects an entry count that is not a whole non-negative number', () => {
    for (const entryCount of [-1, 1.5]) {
      expect(
        BaselineWriteStdoutEnvelopeSchema.safeParse({
          baselinePath: '.codereviewer/baseline.json',
          sourceReportPath: '.codereviewer/runs/run-1/report.json',
          entryCount
        }).success
      ).toBe(false)
    }
  })

  // Deliberately weaker than `baselinePath`: `--report` accepts a path anywhere
  // inside the repository, including an absolute one, and the envelope echoes
  // back the path that was actually read. A repository-relative rule here would
  // make a legitimate invocation fail at the point of printing its result.
  test('accepts an absolute source report path', () => {
    expect(
      BaselineWriteStdoutEnvelopeSchema.safeParse({
        baselinePath: '.codereviewer/baseline.json',
        sourceReportPath: '/repo/.codereviewer/runs/run-1/report.json',
        entryCount: 3
      }).success
    ).toBe(true)
  })
})

describe('CLI error envelope', () => {
  // Why ONE schema and not a union: `artifactDir` is not a tag. No field selects
  // a branch — `code` is an open set (see the error-code tables in
  // `docs/06-reference/exit-codes-and-error-codes.md`), so a discriminated union
  // has nothing to discriminate on, and an undiscriminated
  // `{code,message} | {code,message,artifactDir}` states exactly what one
  // optional field states. The only consumer, `parseCliError` in
  // `scripts/github/stage-outcomes.ts`, reads it that way too.
  test('accepts both the plain and the partial-artifacts form', () => {
    expect(
      CliErrorEnvelopeSchema.safeParse({
        code: 'provider_auth',
        message: 'Provider rejected the credentials.'
      }).success
    ).toBe(true)
    expect(
      CliErrorEnvelopeSchema.safeParse({
        code: 'provider_context_length',
        message: 'The packet exceeded the context window.',
        artifactDir: '.codereviewer/runs/run-1'
      }).success
    ).toBe(true)
  })

  test('rejects a renamed field and an invented one', () => {
    expect(
      CliErrorEnvelopeSchema.safeParse({
        errorCode: 'provider_auth',
        message: 'Provider rejected the credentials.'
      }).success
    ).toBe(false)
    expect(
      CliErrorEnvelopeSchema.safeParse({
        code: 'provider_auth',
        message: 'Provider rejected the credentials.',
        details: {}
      }).success
    ).toBe(false)
  })

  test('rejects an empty code or message', () => {
    expect(
      CliErrorEnvelopeSchema.safeParse({ code: '', message: 'x' }).success
    ).toBe(false)
    expect(
      CliErrorEnvelopeSchema.safeParse({ code: 'config_error', message: '' })
        .success
    ).toBe(false)
  })
})

describe('run error artifact', () => {
  test('accepts the four fields a failed run writes', () => {
    expect(
      RunErrorArtifactSchema.parse({
        code: 'provider_context_length',
        message: 'The packet exceeded the context window.',
        category: 'provider',
        recoverable: true
      }).category
    ).toBe('provider')
  })

  test('rejects a category outside the error taxonomy', () => {
    expect(
      RunErrorArtifactSchema.safeParse({
        code: 'provider_context_length',
        message: '…',
        category: 'model',
        recoverable: true
      }).success
    ).toBe(false)
  })

  // `error.json` carries the category and NOT `artifactDir`; stderr carries
  // `artifactDir` and NOT the category. Two documents, two contracts — pinned
  // because they are one field apart and the obvious "simplification" is to
  // merge them into a shape neither producer emits.
  test('carries no artifactDir, and stderr carries no category', () => {
    expect(
      RunErrorArtifactSchema.safeParse({
        code: 'provider_error',
        message: '…',
        category: 'provider',
        recoverable: true,
        artifactDir: '.codereviewer/runs/run-1'
      }).success
    ).toBe(false)
    expect(
      CliErrorEnvelopeSchema.safeParse({
        code: 'provider_error',
        message: '…',
        category: 'provider'
      }).success
    ).toBe(false)
  })

  // The enum is checked against the error taxonomy at COMPILE time in the
  // contract module; this pins the members at runtime as well, because the
  // artifact-example drift checker walks documented `category` values against
  // exactly this list.
  test('lists every category the error normalizer can produce', () => {
    expect([...StructuredErrorCategorySchema.options].sort()).toEqual([
      'admission',
      'config',
      'input-limit',
      'internal',
      'provider',
      'quality-gate',
      'report',
      'repository'
    ])
  })
})
