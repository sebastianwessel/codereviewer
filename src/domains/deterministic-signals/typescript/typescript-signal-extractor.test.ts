import { describe, expect, test } from 'vitest'
import type {
  SupportSignalFile,
  SupportSignalSourceFile
} from '../shared/deterministic-signal-types.js'
import {
  extractEcmascriptSignals,
  detectEcmascriptSignalFiles,
  discoverEcmascriptSignalTestMappings
} from '../ecmascript/ecmascript-signal-extractor.js'

const detectTypeScriptFiles = (files: readonly SupportSignalFile[]) =>
  detectEcmascriptSignalFiles('typescript', files)
const analyzeTypeScriptFiles = (files: readonly SupportSignalSourceFile[]) =>
  extractEcmascriptSignals('typescript', files)
const discoverTypeScriptTests = (files: readonly SupportSignalFile[]) =>
  discoverEcmascriptSignalTestMappings('typescript', files)

describe('TypeScript deterministic support signal extractor', () => {
  test('detects supported TypeScript file extensions', () => {
    const detection = detectTypeScriptFiles([
      { path: 'src/app.ts' },
      { path: 'src/view.tsx' },
      { path: 'src/schema.mts' },
      { path: 'src/server.cts' },
      { path: 'src/readme.md' }
    ])

    expect(detection).toEqual({
      extractorId: 'typescript',
      detected: true,
      supportedFileCount: 4,
      unsupportedFiles: ['src/readme.md']
    })
  })

  test('emits language-neutral import and export facts', () => {
    const result = analyzeTypeScriptFiles([
      {
        path: 'src/app.ts',
        content: [
          "import defaultThing, { named as localName } from './dep.js'",
          "import * as tools from './tools.js'",
          'export const value = 1',
          'export { localName as publicName }'
        ].join('\n')
      }
    ])

    expect(result.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          language: 'typescript',
          kind: 'import',
          path: 'src/app.ts',
          name: 'defaultThing',
          moduleSpecifier: './dep.js',
          line: 1
        }),
        expect.objectContaining({
          language: 'typescript',
          kind: 'import',
          name: 'localName',
          moduleSpecifier: './dep.js'
        }),
        expect.objectContaining({
          language: 'typescript',
          kind: 'import',
          name: 'tools',
          moduleSpecifier: './tools.js'
        }),
        expect.objectContaining({
          language: 'typescript',
          kind: 'export',
          name: 'value',
          path: 'src/app.ts'
        }),
        expect.objectContaining({
          language: 'typescript',
          kind: 'export',
          name: 'publicName',
          path: 'src/app.ts'
        })
      ])
    )
    expect(result.evidence).toEqual([])
  })

  test('discovers direct and same-directory TypeScript tests', () => {
    expect(
      discoverTypeScriptTests([
        { path: 'src/app.ts' },
        { path: 'src/app.test.ts' },
        { path: 'src/other.spec.tsx' },
        { path: 'src/readme.md' }
      ])
    ).toEqual([
      {
        language: 'typescript',
        sourcePath: 'src/app.test.ts',
        testPath: 'src/app.test.ts',
        relation: 'direct'
      },
      {
        language: 'typescript',
        sourcePath: 'src/other.spec.tsx',
        testPath: 'src/other.spec.tsx',
        relation: 'direct'
      },
      {
        language: 'typescript',
        sourcePath: 'src/app.ts',
        testPath: 'src/app.test.ts',
        relation: 'same-directory'
      }
    ])
  })

  test('rejects unsupported file extensions', () => {
    expect(() =>
      analyzeTypeScriptFiles([
        {
          path: 'src/readme.md',
          content: '# no'
        }
      ])
    ).toThrow(TypeError)
  })

  test('emits parse diagnostics as evidence records', () => {
    const result = analyzeTypeScriptFiles([
      {
        path: 'src/broken.ts',
        content: 'export const ='
      }
    ])

    expect(result.evidence).toEqual([
      expect.objectContaining({
        kind: 'diagnostic',
        source: 'typescript-support-signal',
        redactionApplied: true,
        location: expect.objectContaining({
          path: 'src/broken.ts',
          startLine: 1,
          side: 'file'
        }),
        contentHash: expect.stringMatching(/^[a-f0-9]{64}$/)
      })
    ])
  })

  test('emits rule evidence for backup-code comparison without case normalization', () => {
    const result = analyzeTypeScriptFiles([
      {
        path: 'src/auth.ts',
        content: [
          'const backupCodes = JSON.parse(symmetricDecrypt(user.backupCodes, key))',
          'const index = backupCodes.indexOf(credentials.backupCode.replaceAll("-", ""))',
          'if (index === -1) throw new Error(ErrorCode.IncorrectBackupCode)'
        ].join('\n')
      }
    ])

    expect(result.evidence).toEqual([
      expect.objectContaining({
        kind: 'rule',
        source: 'typescript-support-signal',
        ruleId: 'typescript-backup-code-case-sensitive-compare',
        location: expect.objectContaining({
          path: 'src/auth.ts',
          startLine: 2,
          side: 'file'
        })
      })
    ])
  })

  test('emits rule evidence for non-atomic backup-code consumption', () => {
    const result = analyzeTypeScriptFiles([
      {
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
        ].join('\n')
      }
    ])

    expect(result.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'rule',
          source: 'typescript-support-signal',
          ruleId: 'typescript-backup-code-non-atomic-consumption',
          location: expect.objectContaining({
            path: 'src/auth.ts',
            startLine: 4,
            side: 'file'
          })
        })
      ])
    )
    expect(result.evidence).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'typescript-backup-code-case-sensitive-compare'
        })
      ])
    )
  })

  test('emits rule evidence for backup-code login wording in non-login handlers', () => {
    const result = analyzeTypeScriptFiles([
      {
        path: 'src/totp/disable.ts',
        content:
          'console.error("Missing encryption key; cannot proceed with backup code login.")'
      }
    ])

    expect(result.evidence).toEqual([
      expect.objectContaining({
        kind: 'rule',
        source: 'typescript-support-signal',
        ruleId: 'typescript-backup-code-operation-message-mismatch',
        location: expect.objectContaining({
          path: 'src/totp/disable.ts',
          startLine: 1,
          side: 'file'
        })
      })
    ])
  })

  test('does not flag backup-code login wording in login auth modules', () => {
    const result = analyzeTypeScriptFiles([
      {
        path: 'src/next-auth-options.ts',
        content:
          'console.error("Missing encryption key; cannot proceed with backup code login.")'
      }
    ])

    expect(result.evidence).toEqual([])
  })

  test('emits rule evidence for default export names that conflict with component filenames', () => {
    const result = analyzeTypeScriptFiles([
      {
        path: 'src/BackupCode.tsx',
        content: [
          'import React from "react"',
          '',
          'export default function TwoFactor() {',
          '  return null',
          '}'
        ].join('\n')
      }
    ])

    expect(result.evidence).toEqual([
      expect.objectContaining({
        kind: 'rule',
        source: 'typescript-support-signal',
        ruleId: 'typescript-default-export-name-mismatch',
        location: expect.objectContaining({
          path: 'src/BackupCode.tsx',
          startLine: 3,
          side: 'file'
        })
      })
    ])
  })

  test('emits rule evidence when authorization helpers allow missing sessions', () => {
    const result = analyzeTypeScriptFiles([
      {
        path: 'src/authorization.ts',
        content: [
          "import { SessionStore } from './session-store'",
          '',
          'export const canViewAccount = (',
          '  sessionStore: SessionStore,',
          '  userId: string,',
          '  accountId: string',
          '): boolean => {',
          '  const session = sessionStore.get(userId)',
          '  if (session === undefined) {',
          '    return true',
          '  }',
          '',
          '  return session.accountIds.includes(accountId)',
          '}'
        ].join('\n')
      }
    ])

    expect(result.evidence).toEqual([
      expect.objectContaining({
        kind: 'rule',
        source: 'typescript-support-signal',
        ruleId: 'typescript-authorization-missing-lookup-allows-access',
        location: expect.objectContaining({
          path: 'src/authorization.ts',
          startLine: 10,
          side: 'file'
        })
      })
    ])
  })

  test('does not flag authorization helpers that deny missing sessions', () => {
    const result = analyzeTypeScriptFiles([
      {
        path: 'src/authorization.ts',
        content: [
          'export const canViewAccount = (sessionStore: SessionStore, userId: string): boolean => {',
          '  const session = sessionStore.get(userId)',
          '  if (session === undefined) {',
          '    return false',
          '  }',
          '',
          '  return true',
          '}'
        ].join('\n')
      }
    ])

    expect(result.evidence).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'typescript-authorization-missing-lookup-allows-access'
        })
      ])
    )
  })

  test('emits rule evidence for strict equality between dayjs objects', () => {
    const result = analyzeTypeScriptFiles([
      {
        path: 'src/slots.ts',
        content: [
          'const utcOffset = 60',
          'if (dayjs(date.start).add(utcOffset, "minutes") === dayjs(date.end).add(utcOffset, "minutes")) {',
          '  return true',
          '}'
        ].join('\n')
      }
    ])

    expect(result.evidence).toEqual([
      expect.objectContaining({
        kind: 'rule',
        source: 'typescript-support-signal',
        ruleId: 'typescript-dayjs-object-strict-equality',
        location: expect.objectContaining({
          path: 'src/slots.ts',
          startLine: 2,
          side: 'file'
        })
      })
    ])
  })

  test('does not flag dayjs value comparisons that use isSame', () => {
    const result = analyzeTypeScriptFiles([
      {
        path: 'src/slots.ts',
        content:
          'if (dayjs(date.start).add(utcOffset, "minutes").isSame(dayjs(date.end).add(utcOffset, "minutes"))) return true'
      }
    ])

    expect(result.evidence).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'typescript-dayjs-object-strict-equality'
        })
      ])
    )
  })

  test('emits rule evidence for slot end calculations derived from slot start time', () => {
    const result = analyzeTypeScriptFiles([
      {
        path: 'src/slots.ts',
        content: [
          'const slotEndTime = time.add(eventLength, "minutes").utc()',
          'const slotStartTime = time.utc()',
          'const start = slotStartTime.hour() * 60 + slotStartTime.minute()',
          'const end = slotStartTime.hour() * 60 + slotStartTime.minute()'
        ].join('\n')
      }
    ])

    expect(result.evidence).toEqual([
      expect.objectContaining({
        kind: 'rule',
        source: 'typescript-support-signal',
        ruleId: 'typescript-slot-end-derived-from-start-time',
        location: expect.objectContaining({
          path: 'src/slots.ts',
          startLine: 4,
          side: 'file'
        })
      })
    ])
  })

  test('does not flag slot end calculations derived from slot end time', () => {
    const result = analyzeTypeScriptFiles([
      {
        path: 'src/slots.ts',
        content: [
          'const slotEndTime = time.add(eventLength, "minutes").utc()',
          'const slotStartTime = time.utc()',
          'const start = slotStartTime.hour() * 60 + slotStartTime.minute()',
          'const end = slotEndTime.hour() * 60 + slotEndTime.minute()'
        ].join('\n')
      }
    ])

    expect(result.evidence).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'typescript-slot-end-derived-from-start-time'
        })
      ])
    )
  })

  test('emits rule evidence when a prorated billing branch omits discounts used by sibling branches', () => {
    const result = analyzeTypeScriptFiles([
      {
        path: 'src/billing.ts',
        content: [
          'export type InvoiceItem = {',
          '  readonly quantity: number',
          '  readonly unitCents: number',
          '  readonly discountCents: number',
          '  readonly prorated: boolean',
          '}',
          '',
          'export const totalDueCents = (items: readonly InvoiceItem[]): number =>',
          '  items.reduce((total, item) => {',
          '    const subtotal = item.quantity * item.unitCents',
          '',
          '    if (item.prorated) {',
          '      return total + subtotal',
          '    }',
          '',
          '    return total + subtotal - item.discountCents',
          '  }, 0)'
        ].join('\n')
      }
    ])

    expect(result.evidence).toEqual([
      expect.objectContaining({
        kind: 'rule',
        source: 'typescript-support-signal',
        ruleId: 'typescript-prorated-branch-omits-discount',
        location: expect.objectContaining({
          path: 'src/billing.ts',
          startLine: 13,
          side: 'file'
        })
      })
    ])
  })
})
