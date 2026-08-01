import { describe, expect, test } from 'vitest'
import { declarationTraitKey } from '../declaration-analysis/declaration-shape.js'
import { derivePeerSets, type ConformanceSourceFile } from './peer-sets.js'

const bounds = {
  maxChangedDeclarations: 50,
  maxPeersPerDeclaration: 60
} as const

// A whole-file hunk, which is what a change rewriting the file produces.
const wholeFileHunks = (content: string) => [
  {
    oldStartLine: 1,
    oldLineCount: 1,
    newStartLine: 1,
    newLineCount: content.split('\n').length
  }
]

// Every fixture body contains at least one call, because a declaration with no
// extracted trait is deliberately not comparable and is dropped before it can be
// a peer or a subject.
const handlerSource = (name: string, body: readonly string[]): string =>
  [`export const ${name} = (request) => {`, ...body, '}', ''].join('\n')

describe('peer set derivation', () => {
  test('derives siblings from the same file and from the same directory', () => {
    const changed: ConformanceSourceFile = {
      path: 'src/handlers/delete.ts',
      content: handlerSource('remove', ['  return store.load(request)']),
      hunks: [
        { oldStartLine: 1, oldLineCount: 0, newStartLine: 1, newLineCount: 4 }
      ]
    }
    const sibling: ConformanceSourceFile = {
      path: 'src/handlers/read.ts',
      content:
        handlerSource('readOne', ['  requireAuth(request)', '  return load(request)']) +
        handlerSource('readAll', ['  requireAuth(request)', '  return load(request)'])
    }
    const result = derivePeerSets({ files: [changed, sibling], ...bounds })

    expect(result.changedDeclarationCount).toBe(1)
    expect(result.peerSets).toHaveLength(1)
    expect(result.peerSets[0]?.subject.name).toBe('remove')
    expect(result.peerSets[0]?.scope).toBe('directory')
    expect(
      result.peerSets[0]?.members.map((member) => member.name)
    ).toEqual(['remove', 'readOne', 'readAll'])
  })

  test('a declaration with no sibling yields no peer set at all', () => {
    const changed: ConformanceSourceFile = {
      path: 'src/only.ts',
      content: 'export const solo = () => 1\n',
      hunks: [
        { oldStartLine: 1, oldLineCount: 1, newStartLine: 1, newLineCount: 1 }
      ]
    }

    expect(derivePeerSets({ files: [changed], ...bounds }).peerSets).toEqual([])
  })

  test('a change inside a body attributes the declaration even though its header is untouched', () => {
    const content = [
      'export const handler = (request) => {',
      '  const value = load(request)',
      '  return value',
      '}',
      '',
      'export const other = (request) => {',
      '  return load(request)',
      '}',
      ''
    ].join('\n')
    const result = derivePeerSets({
      files: [
        {
          path: 'src/a.ts',
          content,
          // Only line 2 changed. The header on line 1 is untouched, which is the
          // shape spec 24 exists to catch: a guard removed from a body leaves
          // the signature alone.
          hunks: [
            {
              oldStartLine: 2,
              oldLineCount: 1,
              newStartLine: 2,
              newLineCount: 1
            }
          ]
        }
      ],
      ...bounds
    })

    expect(result.changedDeclarationCount).toBe(1)
    expect(result.peerSets[0]?.subject.name).toBe('handler')
  })

  test('every declaration of a new file is attributed to the change', () => {
    const content =
      handlerSource('a', ['  return load(request)']) + handlerSource('b', ['  return load(request)'])
    const result = derivePeerSets({
      files: [{ path: 'src/new.ts', content, hunks: [], isNewFile: true }],
      ...bounds
    })

    expect(result.changedDeclarationCount).toBe(2)
  })

  test('a sibling file supplies peers but never seeds a peer set of its own', () => {
    const result = derivePeerSets({
      files: [
        {
          path: 'src/changed.ts',
          content: handlerSource('a', ['  return load(request)']),
          hunks: wholeFileHunks(handlerSource('a', ['  return load(request)']))
        },
        {
          path: 'src/peer.ts',
          content:
            handlerSource('b', ['  return load(request)']) + handlerSource('c', ['  return load(request)'])
        }
      ],
      ...bounds
    })

    expect(result.peerSets.map((set) => set.subject.name)).toEqual(['a'])
    // The untouched peers are still members, because a pre-existing divergence is
    // reported about a member the change did not touch.
    expect(
      result.peerSets[0]?.members.map((member) => member.changeAttributed)
    ).toEqual([true, false, false])
  })

  test('a re-export list is not a declaration and never becomes a peer', () => {
    const content = [
      'export const kept = () => load()',
      'const one = () => load()',
      'const two = () => load()',
      'export { one, two }',
      ''
    ].join('\n')
    const result = derivePeerSets({
      files: [{ path: 'src/barrel.ts', content, hunks: wholeFileHunks(content) }],
      ...bounds
    })

    // Only `kept` survives: `export { one, two }` is one construct with two
    // names and no body, and admitting it would fill a barrel file's peer set
    // with members whose shared pattern is that none of them do anything.
    // `one` and `two` are genuine function declarations — `const one = () => load()`
    // has a name and a body — so they now count, and being alike they form peer
    // sets. That is not what this rule protects against.
    //
    // The invariant is that the re-export LIST on line 4 never becomes a member:
    // one construct carrying two names and no body, whose only shared pattern with
    // anything is that it does nothing. Asserting an empty peer set used to imply
    // that only because ECMAScript emitted no declarations at all, which made the
    // proxy indistinguishable from the property. Assert the property.
    expect(result.changedDeclarationCount).toBe(3)
    expect(
      result.peerSets.flatMap((peerSet) =>
        peerSet.members.map((member) => member.span.startLine)
      )
    ).not.toContain(4)
  })

  // The regression this rule exists for. The first real run of the capability
  // produced 28 divergences over this repository and every one of them was a
  // type alias or a bare constant "failing" to call what the schema builders
  // around it call. A declaration that does nothing cannot omit a call.
  test('a declaration with no observable behaviour is neither a subject nor a peer', () => {
    const content = [
      'export const SeveritySchema = z.enum(["low", "high"])',
      'export const ReviewConfigSchema = z.strictObject({ a: z.string() })',
      'export const PathsConfigSchema = z.strictObject({ b: z.string() })',
      'export const BaselineConfigSchema = z.strictObject({ c: z.string() })',
      'export const QualityGateConfigSchema = z.strictObject({ d: z.string() })',
      'export type Severity = z.infer<typeof SeveritySchema>',
      'export type ReviewConfig = z.infer<typeof ReviewConfigSchema>',
      'export const MAX_RESULTS = 500',
      ''
    ].join('\n')
    const result = derivePeerSets({
      files: [{ path: 'src/config.ts', content, hunks: wholeFileHunks(content) }],
      ...bounds
    })

    // The five schema builders are comparable; the two type aliases and the bare
    // constant are not, so they neither seed a peer set nor dilute the majority
    // denominator of the ones that do.
    expect(result.changedDeclarationCount).toBe(5)
    expect(
      result.peerSets.map((set) => [
        set.subject.name,
        set.members.length - 1
      ])
    ).toEqual([
      ['SeveritySchema', 4],
      ['ReviewConfigSchema', 4],
      ['PathsConfigSchema', 4],
      ['BaselineConfigSchema', 4],
      ['QualityGateConfigSchema', 4]
    ])
  })

  test('a re-export from another module is not a declaration', () => {
    const content = 'export { readOne } from "./read.js"\n'
    const result = derivePeerSets({
      files: [{ path: 'src/barrel.ts', content, hunks: wholeFileHunks(content) }],
      ...bounds
    })

    expect(result.changedDeclarationCount).toBe(0)
  })

  test('declarations at different nesting depths are not siblings', () => {
    const content = [
      'class Service:',
      '    def read(self, request):',
      '        require_auth(request)',
      '        return 1',
      '',
      '    def write(self, request):',
      '        require_auth(request)',
      '        return 2',
      '',
      '    def remove(self, request):',
      '        return load(request)',
      ''
    ].join('\n')
    const result = derivePeerSets({
      files: [{ path: 'src/service.py', content, hunks: wholeFileHunks(content) }],
      ...bounds
    })
    const remove = result.peerSets.find((set) => set.subject.name === 'remove')

    // The class itself sits at column 0 and the methods at column 4, so the
    // class is never compared against its own methods.
    expect(remove?.members.map((member) => member.name)).toEqual([
      'remove',
      'read',
      'write'
    ])
    expect(
      result.peerSets.find((set) => set.subject.name === 'Service')
    ).toBeUndefined()
  })

  test('an exported and an unexported Go function land in the same peer set', () => {
    const content = [
      'package handlers',
      '',
      'func Public(request string) error {',
      '\treturn check(request)',
      '}',
      '',
      'func private(request string) error {',
      '\treturn check(request)',
      '}',
      '',
      'func Another(request string) error {',
      '\treturn load(request)',
      '}',
      ''
    ].join('\n')
    const result = derivePeerSets({
      files: [{ path: 'src/handlers.go', content, hunks: wholeFileHunks(content) }],
      ...bounds
    })
    const another = result.peerSets.find((set) => set.subject.name === 'Another')

    // The polyglot extractors report `declaration` and `public-symbol` at the
    // same line for a public declaration. Collapsing to the more inclusive kind
    // is what keeps `Public` and `private` comparable.
    expect(another?.members.map((member) => member.name)).toEqual([
      'Another',
      'Public',
      'private'
    ])
    expect(another?.members.every((member) => member.kind === 'declaration')).toBe(
      true
    )
  })

  test('the peer cap bounds the set and is reported rather than hidden', () => {
    const content = Array.from({ length: 10 }, (_unused, index) =>
      handlerSource(`h${index}`, ['  return load(request)'])
    ).join('')
    const result = derivePeerSets({
      files: [{ path: 'src/many.ts', content, hunks: wholeFileHunks(content) }],
      maxChangedDeclarations: 1,
      maxPeersPerDeclaration: 4
    })

    expect(result.changedDeclarationCount).toBe(10)
    expect(result.changedDeclarationsTruncated).toBe(true)
    expect(result.peerSets).toHaveLength(1)
    expect(result.peerSets[0]?.members).toHaveLength(5)
    expect(result.peerSets[0]?.truncated).toBe(true)
  })

  // The bound used to be `slice(0, limit)` over a path-sorted list, so a change
  // wider than the cap was not sampled but amputated: every seed came from the
  // files whose paths sort first, and a divergence anywhere later in the alphabet
  // was invisible. Measured on this repository, that turned a 23-divergence range
  // into an empty report — and the wider the change, the more of it went unread.
  test('the seed cap samples the whole change rather than its alphabetical front', () => {
    const files: readonly ConformanceSourceFile[] = Array.from(
      { length: 26 },
      (_unused, index) => {
        const letter = String.fromCharCode(97 + index)
        const content =
          handlerSource(`${letter}One`, ['  return load(request)']) +
          handlerSource(`${letter}Two`, ['  return load(request)'])

        return {
          path: `src/${letter}.ts`,
          content,
          hunks: wholeFileHunks(content)
        }
      }
    )
    const result = derivePeerSets({
      files,
      maxChangedDeclarations: 6,
      maxPeersPerDeclaration: 60
    })
    const seededFiles = result.peerSets.map((set) => set.subject.path)

    expect(result.changedDeclarationCount).toBe(52)
    expect(result.changedDeclarationsTruncated).toBe(true)
    expect(result.peerSets).toHaveLength(6)
    // Six distinct files, drawn from across the twenty-six rather than from the
    // first three. `slice(0, 6)` would have seeded `src/a.ts` … `src/c.ts` twice
    // each and never looked past `c`.
    expect(new Set(seededFiles).size).toBe(6)
    expect(seededFiles.some((path) => path > 'src/m.ts')).toBe(true)
  })

  test('derivation is deterministic and needs no model', () => {
    const files: readonly ConformanceSourceFile[] = [
      {
        path: 'src/a.ts',
        content: handlerSource('a', ['  requireAuth(request)', '  return 1']),
        hunks: wholeFileHunks(
          handlerSource('a', ['  requireAuth(request)', '  return 1'])
        )
      },
      {
        path: 'src/b.ts',
        content:
          handlerSource('b', ['  requireAuth(request)']) +
          handlerSource('c', ['  requireAuth(request)'])
      }
    ]
    const serialize = () =>
      JSON.stringify(
        derivePeerSets({ files, ...bounds }).peerSets.map((set) => ({
          subject: set.subject.name,
          members: set.members.map((member) => ({
            name: member.name,
            traits: member.traits.map(declarationTraitKey)
          }))
        }))
      )

    expect(serialize()).toBe(serialize())
    expect(serialize()).toContain('call:requireAuth')
  })
})
