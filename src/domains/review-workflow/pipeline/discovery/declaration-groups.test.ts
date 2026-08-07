import { describe, expect, test } from 'vitest'
import { declarationAnchorLines } from '../../../deterministic-signals/index.js'
import { type ReviewContextDocument } from '../agent-contracts.js'
import { splitDocumentByDeclarations } from './declaration-groups.js'

// Four lines per declaration: signature, body, close, blank. Anchors therefore land
// on 1, 5, 9, … and the file is exactly `4 * count` lines long.
const sourceWithDeclarations = (count: number): string =>
  Array.from(
    { length: count },
    (_unused, index) =>
      `export const fn${index} = (): number => {\n  return ${index}\n}\n`
  ).join('\n')

const fileDocument = (
  overrides: Partial<ReviewContextDocument> = {}
): ReviewContextDocument => ({
  kind: 'file',
  path: 'src/sample.ts',
  content: sourceWithDeclarations(6),
  startLine: 1,
  endLine: 24,
  ledgerEntryId: 'ctx_aaaaaaaaaaaaaaaaaaaaaaaa',
  ...overrides
})

const anchorsWithin = (
  document: ReviewContextDocument,
  startLine: number,
  endLine: number
): readonly number[] =>
  declarationAnchorLines(document.path as string, document.content).filter(
    (line) => line >= startLine && line <= endLine
  )

describe('splitDocumentByDeclarations', () => {
  test('groups declarations and carries each group’s absolute line range', () => {
    const document = fileDocument()
    const groups = splitDocumentByDeclarations(document, {
      maxDeclarationsPerCall: 3,
      maxGroupsPerFile: 3
    })

    // Six anchors at 1/5/9/13/17/21, three per group, consecutive groups sharing
    // one: [1,5,9] [9,13,17] [17,21].
    expect(
      groups.map((group) => [group.startLine, group.endLine])
    ).toEqual([
      [1, 12],
      [9, 20],
      [17, 24]
    ])
    // The narrowed body is the point of the whole feature: a group that still
    // carried the whole file would be the un-anchored pass, which was measured and
    // removed.
    for (const group of groups) {
      expect(group.content.length).toBeLessThan(document.content.length)
    }
    expect(groups[0]?.content).toBe(
      document.content.split('\n').slice(0, 12).join('\n')
    )
  })

  test('consecutive groups overlap by exactly one declaration', () => {
    const document = fileDocument()
    const groups = splitDocumentByDeclarations(document, {
      maxDeclarationsPerCall: 3,
      maxGroupsPerFile: 3
    })

    for (const [index, group] of groups.slice(0, -1).entries()) {
      const next = groups[index + 1] as ReviewContextDocument

      // One declaration, and no more: a defect spanning two adjacent declarations
      // would otherwise be invisible to every call, but a wider overlap would be a
      // restoration of whole-file context.
      expect(
        anchorsWithin(
          document,
          next.startLine as number,
          group.endLine as number
        )
      ).toHaveLength(1)
    }
  })

  test('the groups cover every line of the file, with no gap', () => {
    const document = fileDocument()
    const groups = splitDocumentByDeclarations(document, {
      maxDeclarationsPerCall: 3,
      maxGroupsPerFile: 3
    })
    const covered = new Set<number>()

    for (const group of groups) {
      for (
        let line = group.startLine as number;
        line <= (group.endLine as number);
        line += 1
      ) {
        covered.add(line)
      }
    }

    expect(covered.size).toBe(document.content.split('\n').length)
  })

  test('a group is cut on line boundaries, never on bytes', () => {
    const groups = splitDocumentByDeclarations(fileDocument(), {
      maxDeclarationsPerCall: 3,
      maxGroupsPerFile: 3
    })

    // Spec 26 removed the content-dependent size guess and spec 27 keeps the unit a
    // declaration: every group starts at a declaration's own first character.
    expect(groups[1]?.content.startsWith('export const fn2 =')).toBe(true)
    expect(groups[2]?.content.startsWith('export const fn4 =')).toBe(true)
  })

  test('the group cap enlarges the groups instead of dropping the tail', () => {
    // 200 anchors at four declarations per group is 50 calls for one case. The cap
    // has to bind, and it has to bind without leaving part of the file unreviewed.
    const document = fileDocument({
      content: sourceWithDeclarations(200),
      endLine: 800
    })
    const groups = splitDocumentByDeclarations(document, {
      maxDeclarationsPerCall: 4,
      maxGroupsPerFile: 3
    })

    expect(groups).toHaveLength(3)
    expect(groups[0]?.startLine).toBe(1)
    expect(groups.at(-1)?.endLine).toBe(800)
  })

  test('a document that is already a chunk keeps the file’s real line numbers', () => {
    const groups = splitDocumentByDeclarations(
      fileDocument({ startLine: 101, endLine: 124 }),
      { maxDeclarationsPerCall: 3, maxGroupsPerFile: 3 }
    )

    // A spec 26 reactive half can be split again, and a group numbered from 1 would
    // give every finding in it a wrong line and therefore a wrong fingerprint.
    expect(groups.map((group) => [group.startLine, group.endLine])).toEqual([
      [101, 112],
      [109, 120],
      [117, 124]
    ])
  })

  test('a file with no declaration anchors falls back to the whole file', () => {
    // An unsupported language or a failed extraction must never produce a byte
    // slice (spec 27 requirement).
    const document = fileDocument({
      path: 'notes/readme.txt',
      content: 'alpha\nbeta\ngamma\n',
      endLine: 4
    })

    expect(
      splitDocumentByDeclarations(document, {
        maxDeclarationsPerCall: 1,
        maxGroupsPerFile: 3
      })
    ).toEqual([document])
  })

  test('a file with a single declaration is left undivided', () => {
    const document = fileDocument({
      content: sourceWithDeclarations(1),
      endLine: 4
    })

    expect(
      splitDocumentByDeclarations(document, {
        maxDeclarationsPerCall: 1,
        maxGroupsPerFile: 3
      })
    ).toEqual([document])
  })

  test('a file within the declaration limit is left undivided', () => {
    const document = fileDocument()

    expect(
      splitDocumentByDeclarations(document, {
        maxDeclarationsPerCall: 16,
        maxGroupsPerFile: 3
      })
    ).toEqual([document])
  })
})
