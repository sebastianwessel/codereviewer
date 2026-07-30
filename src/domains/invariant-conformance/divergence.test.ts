import { describe, expect, test } from 'vitest'
import {
  guardedHandlerPeersSource,
  unguardedHandlerSource
} from '../../shared/testing/conformance-control-fixtures.js'
import {
  ConformanceDivergenceSchema,
  MINIMUM_CITED_PEERS
} from './conformance-report.js'
import { collectDivergences } from './divergence.js'
import { derivePeerSets, type ConformanceSourceFile } from './peer-sets.js'

const bounds = {
  maxChangedDeclarations: 50,
  maxPeersPerDeclaration: 60
} as const

const divergenceBounds: {
  maxDivergences: number
  maxPreExistingDivergences: number
} = {
  maxDivergences: 50,
  maxPreExistingDivergences: 25
}

// Every fixture body contains at least one call, because a declaration with no
// extracted trait is deliberately not comparable and is dropped before it can be
// a peer or a subject.
const handler = (name: string, body: readonly string[]): string =>
  [`export const ${name} = (request) => {`, ...body, '}', ''].join('\n')

const wholeFileHunks = (content: string) => [
  {
    oldStartLine: 1,
    oldLineCount: 1,
    newStartLine: 1,
    newLineCount: content.split('\n').length
  }
]

// A directory where `peerCount` conforming handlers guard with `requireAuth` and
// the changed one does not.
const conformingDirectory = (
  peerCount: number,
  changedBody: readonly string[]
): readonly ConformanceSourceFile[] => {
  const changed = handler('changed', changedBody)
  const peers = Array.from({ length: peerCount }, (_unused, index) =>
    handler(`peer${index}`, [
      '  if (!requireAuth(request)) {',
      '    return deny()',
      '  }',
      '  return load(request)'
    ])
  ).join('')

  return [
    { path: 'src/handlers/changed.ts', content: changed, hunks: wholeFileHunks(changed) },
    { path: 'src/handlers/peers.ts', content: peers }
  ]
}

const divergencesFor = (
  files: readonly ConformanceSourceFile[],
  overrides: Partial<typeof divergenceBounds> = {}
) =>
  collectDivergences({
    peerSets: derivePeerSets({ files, ...bounds }).peerSets,
    ...divergenceBounds,
    ...overrides
  })

describe('majority pattern divergence', () => {
  test('reports the missing call as a fact plus a question, citing the peers', () => {
    const result = divergencesFor(conformingDirectory(4, ['  return load(request)']))
    const divergence = result.changeAttributed.find(
      (candidate) => candidate.pattern.symbol === 'requireAuth'
    )

    expect(divergence?.attribution).toBe('change-attributed')
    expect(divergence?.pattern.kind).toBe('call')
    expect(divergence?.peerCount).toBe(4)
    expect(divergence?.citedPeerCount).toBe(4)
    expect(divergence?.citedPeers.map((peer) => peer.name)).toEqual([
      'peer0',
      'peer1',
      'peer2',
      'peer3'
    ])
    expect(divergence?.statement).toBe(
      '4 of 4 sibling declarations call requireAuth; changed does not.'
    )
    expect(divergence?.question).toContain('convention')
    // The fact is stated; the consequence is not, anywhere.
    expect(JSON.stringify(divergence)).not.toMatch(
      /vulnerab|exploit|insecure|severity/iu
    )
  })

  test('rejects a pattern that fewer than three peers hold, however unanimous', () => {
    // Two peers, both guarding. A unanimous majority — and still a coincidence.
    const result = divergencesFor(conformingDirectory(2, ['  return load(request)']))

    expect(result.changeAttributed).toEqual([])
    expect(result.preExisting).toEqual([])
    expect(MINIMUM_CITED_PEERS).toBe(3)
  })

  test('rejects a pattern three peers hold when they are not a majority', () => {
    const changed = handler('changed', ['  return load(request)'])
    const guarding = Array.from({ length: 3 }, (_unused, index) =>
      handler(`guard${index}`, ['  requireAuth(request)', '  return load(request)'])
    ).join('')
    const plain = Array.from({ length: 4 }, (_unused, index) =>
      handler(`plain${index}`, ['  return load(request)'])
    ).join('')
    const result = divergencesFor([
      { path: 'src/h/changed.ts', content: changed, hunks: wholeFileHunks(changed) },
      { path: 'src/h/guarding.ts', content: guarding },
      { path: 'src/h/plain.ts', content: plain }
    ])

    // Three of seven peers is above the citation floor and below the majority.
    expect(
      result.changeAttributed.map((divergence) => divergence.pattern.symbol)
    ).not.toContain('requireAuth')
  })

  test('reports no divergence rather than manufacturing one when the declaration conforms', () => {
    const result = divergencesFor(
      conformingDirectory(4, [
        '  if (!requireAuth(request)) {',
        '    return deny()',
        '  }',
        '  return load(request)'
      ])
    )

    expect(result.changeAttributed).toEqual([])
    expect(result.preExisting).toEqual([])
  })

  test('labels a divergence in untouched code as pre-existing and counts it apart', () => {
    // The changed handler conforms; one untouched sibling does not.
    const changed = handler('changed', [
      '  if (!requireAuth(request)) {',
      '    return deny()',
      '  }',
      '  return load(request)'
    ])
    const peers =
      Array.from({ length: 3 }, (_unused, index) =>
        handler(`peer${index}`, [
          '  if (!requireAuth(request)) {',
          '    return deny()',
          '  }',
          '  return load(request)'
        ])
      ).join('') + handler('oddOneOut', ['  return load(request)'])
    const result = divergencesFor([
      { path: 'src/h/changed.ts', content: changed, hunks: wholeFileHunks(changed) },
      { path: 'src/h/peers.ts', content: peers }
    ])

    expect(result.changeAttributed).toEqual([])
    expect(
      result.preExisting.map((divergence) => [
        divergence.declaration.name,
        divergence.pattern.kind,
        divergence.pattern.symbol,
        divergence.attribution
      ])
    ).toEqual([
      ['oddOneOut', 'call', 'deny', 'pre-existing'],
      ['oddOneOut', 'call', 'requireAuth', 'pre-existing']
    ])
  })

  test('reports a guard divergence when the call is present but not as a check', () => {
    const changed = handler('changed', ['  requireAuth(request)', '  return load(request)'])
    const peers = Array.from({ length: 4 }, (_unused, index) =>
      handler(`peer${index}`, [
        '  if (!requireAuth(request)) {',
        '    return load(request)',
        '  }',
        '  return load(request)'
      ])
    ).join('')
    const result = divergencesFor([
      { path: 'src/h/changed.ts', content: changed, hunks: wholeFileHunks(changed) },
      { path: 'src/h/peers.ts', content: peers }
    ])

    expect(
      result.changeAttributed.map((divergence) => [
        divergence.pattern.kind,
        divergence.pattern.symbol
      ])
    ).toEqual([['guard', 'requireAuth']])
    expect(result.changeAttributed[0]?.statement).toContain('in a conditional')
  })

  test('reports a differing call argument, which no removal-shaped trigger would see', () => {
    const changed = handler('changed', ['  requireRole("user")', '  return 1'])
    const peers = Array.from({ length: 4 }, (_unused, index) =>
      handler(`peer${index}`, ['  requireRole("admin")', '  return 1'])
    ).join('')
    const result = divergencesFor([
      { path: 'src/h/changed.ts', content: changed, hunks: wholeFileHunks(changed) },
      { path: 'src/h/peers.ts', content: peers }
    ])
    const divergence = result.changeAttributed.find(
      (candidate) => candidate.pattern.kind === 'call-argument'
    )

    // Nothing was deleted and no call is missing: the role was loosened in place.
    expect(divergence?.pattern.symbol).toBe('requireRole')
    expect(divergence?.pattern.argument).toBe('"admin"')
    expect(
      result.changeAttributed.map((candidate) => candidate.pattern.kind)
    ).not.toContain('call')
  })

  test('a missing call is reported once, not restated as a guard and an argument', () => {
    const result = divergencesFor(conformingDirectory(4, ['  return load(request)']))

    // The peers hold `call:requireAuth`, `guard:requireAuth` and
    // `call-argument:requireAuth(request)`. All three are absent, and reporting
    // all three would triple the count for one missing call.
    expect(
      result.changeAttributed.filter(
        (divergence) => divergence.pattern.symbol === 'requireAuth'
      )
    ).toHaveLength(1)
  })

  // Spec 24, "Positional Traits". The declaration is not missing the call — it
  // makes it, three levels down inside a loop the declaration carries on past,
  // while every peer makes it on the way out. A set-membership trait cannot see
  // this, and the statement must not claim the declaration "does not" do something
  // it plainly does.
  test('reports a pattern the declaration holds at a materially different position', () => {
    const changed = handler('changed', [
      '  for (const item of request.items) {',
      '    if (item.stale) {',
      '      release(item)',
      '    }',
      '  }',
      '  return load(request)'
    ])
    const peers = Array.from({ length: 4 }, (_unused, index) =>
      handler(`peer${index}`, [
        '  for (const item of request.items) {',
        '    touch(item)',
        '  }',
        '  release(request)',
        '  return load(request)'
      ])
    ).join('')
    const result = divergencesFor([
      { path: 'src/h/changed.ts', content: changed, hunks: wholeFileHunks(changed) },
      { path: 'src/h/peers.ts', content: peers }
    ])
    const divergence = result.changeAttributed.find(
      (candidate) => candidate.pattern.symbol === 'release'
    )

    expect(divergence?.statement).toBe(
      "4 of 4 sibling declarations call release on the declaration's exit path; changed does so inside a nested block."
    )
    expect(divergence?.question).toContain('exit path')
    expect(divergence?.citedPeerCount).toBe(4)
  })

  // The other half of the same rule: a symbol both sides use in the same band is
  // still one trait, so re-indenting a body cannot invent a divergence.
  test('does not report a position difference that is one level of wrapping', () => {
    const changed = handler('changed', [
      '  if (!requireAuth(request)) {',
      '    return deny()',
      '  }',
      '  return load(request)'
    ])
    const peers = Array.from({ length: 4 }, (_unused, index) =>
      handler(`peer${index}`, [
        '  requireAuth(',
        '    request',
        '  )',
        '  return load(request)'
      ])
    ).join('')
    const result = divergencesFor([
      { path: 'src/h/changed.ts', content: changed, hunks: wholeFileHunks(changed) },
      { path: 'src/h/peers.ts', content: peers }
    ])

    expect(
      result.changeAttributed.map((divergence) => divergence.pattern.symbol)
    ).not.toContain('requireAuth')
  })

  // Positional traits let one symbol be a majority pattern at two positions at
  // once. A declaration holding neither is one absence and is reported once.
  test('a symbol the peers hold at two positions is still one divergence', () => {
    const changed = handler('changed', ['  return load(request)'])
    const peers = Array.from({ length: 4 }, (_unused, index) =>
      handler(`peer${index}`, [
        '  for (const item of request.items) {',
        '    if (item.stale) {',
        '      audit(item)',
        '    }',
        '  }',
        '  audit(request)',
        '  return load(request)'
      ])
    ).join('')
    const result = divergencesFor([
      { path: 'src/h/changed.ts', content: changed, hunks: wholeFileHunks(changed) },
      { path: 'src/h/peers.ts', content: peers }
    ])

    expect(
      result.changeAttributed.filter(
        (divergence) => divergence.pattern.symbol === 'audit'
      )
    ).toHaveLength(1)
  })

  test('bounds each list independently and reports the truncation', () => {
    const result = divergencesFor(conformingDirectory(4, ['  return load(request)']), {
      maxDivergences: 1,
      maxPreExistingDivergences: 0
    })

    expect(result.changeAttributed).toHaveLength(1)
    expect(result.changeAttributedTruncated).toBe(true)
    expect(result.preExisting).toEqual([])
  })

  test('every emitted divergence satisfies the report contract', () => {
    const result = divergencesFor(conformingDirectory(5, ['  return load(request)']))

    expect(result.changeAttributed.length).toBeGreaterThan(0)
    for (const divergence of result.changeAttributed) {
      expect(() => ConformanceDivergenceSchema.parse(divergence)).not.toThrow()
      expect(divergence.citedPeers.length).toBeGreaterThanOrEqual(
        MINIMUM_CITED_PEERS
      )
    }
  })

  // The citation floor is enforced twice: once by the extraction above, and once
  // by the contract, so no report can ever carry a weaker citation however it was
  // produced.
  test('the contract itself refuses a divergence citing fewer than three peers', () => {
    const admissible = divergencesFor(conformingDirectory(4, ['  return load(request)']))
      .changeAttributed[0]

    expect(admissible).toBeDefined()
    expect(
      ConformanceDivergenceSchema.safeParse({
        ...admissible,
        citedPeers: admissible?.citedPeers.slice(0, 2),
        citedPeerCount: 2,
        peerCount: 2
      }).success
    ).toBe(false)
  })

  test('the contract refuses a divergence carrying a verdict field', () => {
    const admissible = divergencesFor(conformingDirectory(4, ['  return load(request)']))
      .changeAttributed[0]

    expect(
      ConformanceDivergenceSchema.safeParse({ ...admissible, severity: 'high' })
        .success
    ).toBe(false)
  })

  test('is deterministic over the same peer sets', () => {
    const files = conformingDirectory(4, ['  return load(request)'])
    const serialize = () => JSON.stringify(divergencesFor(files))

    expect(serialize()).toBe(serialize())
  })
})

// The membership precondition, and the four shapes that established it.
//
// Peer-set derivation groups declarations structurally — same fact kind, same
// language, same indentation column. In a language whose module-level exports all
// sit at column 0 that groups declarations which have nothing in common, and the
// majority rule alone will then report the odd kind of declaration for not doing
// what the other kind does. The first three fixtures are the shapes measured on a
// real TypeScript branch, reduced to their mechanism; the fourth is the control
// that must keep firing, where the member genuinely belongs to the group.
describe('peer-set membership precondition', () => {
  // Four schema builders, an error class and a type alias — one file, one
  // indentation column, three unrelated kinds of declaration.
  const mixedModuleExports = (): readonly ConformanceSourceFile[] => {
    const content = [
      "import { z } from 'zod'",
      '',
      'export const AlphaSchema = z.strictObject({',
      '  name: z.string().min(1)',
      '})',
      '',
      'export const BetaSchema = z.strictObject({',
      '  size: z.int().min(0)',
      '})',
      '',
      'export const GammaSchema = z.strictObject({',
      '  tags: z.array(z.string())',
      '})',
      '',
      'export const DeltaSchema = z.strictObject({',
      '  mode: z.enum(["a", "b"])',
      '})',
      '',
      'export class BudgetExceededError extends Error {',
      '  constructor(limit: number) {',
      '    super(formatLimit(limit))',
      '  }',
      '}',
      '',
      'export type RetrievalTools = {',
      '  read(input: { readonly path: string }): Promise<string>',
      '  list(input: { readonly path: string }): Promise<string>',
      '}',
      ''
    ].join('\n')

    return [
      {
        path: 'src/contracts/tools.ts',
        content,
        hunks: wholeFileHunks(content)
      }
    ]
  }

  test('an error class among schema builders shares no trait with them and is not compared', () => {
    const result = divergencesFor(mixedModuleExports())

    // The peers agree on `strictObject`; the error class calls `constructor` and
    // nothing else. It is not a deviant schema — it is not a schema.
    expect(
      [...result.changeAttributed, ...result.preExisting].filter(
        (divergence) => divergence.declaration.name === 'BudgetExceededError'
      )
    ).toEqual([])
  })

  test('a type alias among schema builders shares no trait with them and is not compared', () => {
    const result = divergencesFor(mixedModuleExports())

    expect(
      [...result.changeAttributed, ...result.preExisting].filter(
        (divergence) => divergence.declaration.name === 'RetrievalTools'
      )
    ).toEqual([])
  })

  test('a synchronous parser among asynchronous functions is not compared', () => {
    const parser = [
      'export const parseConfigPath = (args) => {',
      "  const index = args.indexOf('--config')",
      '  return index === -1 ? undefined : args[index + 1]',
      '}',
      ''
    ].join('\n')
    const asyncPeers = Array.from({ length: 8 }, (_unused, index) =>
      [
        `export const loadStep${index} = async (path) => {`,
        '  const raw = await readSource(path)',
        '  return parseSource(raw)',
        '}',
        ''
      ].join('\n')
    ).join('')
    const result = divergencesFor([
      { path: 'src/cli/args.ts', content: parser, hunks: wholeFileHunks(parser) },
      { path: 'src/cli/loaders.ts', content: asyncPeers }
    ])

    expect(
      [...result.changeAttributed, ...result.preExisting].filter(
        (divergence) => divergence.declaration.name === 'parseConfigPath'
      )
    ).toEqual([])
  })

  // The fixture is shared with the end-to-end control suite
  // (`conformance-controls.test.ts`), so the deterministic core and the adjudication
  // layer are held to the same case rather than to two copies that can drift.
  test('the control still fires: a handler that shares the group trait but drops the guard', () => {
    const base = guardedHandlerPeersSource
    const added = unguardedHandlerSource
    const content = `${base}\n${added}`
    const addedStartLine = base.split('\n').length + 1
    const result = divergencesFor([
      {
        path: 'handlers/users.go',
        content,
        hunks: [
          {
            oldStartLine: addedStartLine,
            oldLineCount: 0,
            newStartLine: addedStartLine,
            newLineCount: added.split('\n').length
          }
        ]
      }
    ])
    const divergence = result.changeAttributed.find(
      (candidate) => candidate.pattern.symbol === 'requireAuth'
    )

    // `ExportUsers` calls `respond`, which all three peers call: it genuinely is
    // one of them, so the missing guard is reported with the peers as evidence.
    expect(divergence?.declaration.name).toBe('ExportUsers')
    expect(divergence?.statement).toBe(
      '3 of 3 sibling declarations call requireAuth; ExportUsers does not.'
    )
    expect(divergence?.citedPeers.map((peer) => peer.name)).toEqual([
      'ListUsers',
      'GetUser',
      'DeleteUser'
    ])
  })

  test('the precondition does not weaken the majority or citation gates', () => {
    // A member that belongs to its group is still refused when the pattern is
    // held by too few peers, or by a non-majority of them.
    expect(divergencesFor(conformingDirectory(2, ['  return load(request)']))
      .changeAttributed).toEqual([])

    const changed = handler('changed', ['  load(request)', '  return 1'])
    const guarding = Array.from({ length: 3 }, (_unused, index) =>
      handler(`guard${index}`, ['  requireAuth(request)', '  load(request)', '  return 1'])
    ).join('')
    const plain = Array.from({ length: 4 }, (_unused, index) =>
      handler(`plain${index}`, ['  load(request)', '  return 1'])
    ).join('')
    const nonMajority = divergencesFor([
      { path: 'src/h/changed.ts', content: changed, hunks: wholeFileHunks(changed) },
      { path: 'src/h/guarding.ts', content: guarding },
      { path: 'src/h/plain.ts', content: plain }
    ])

    // `changed` shares `load` with every peer, so it is a member; `requireAuth` is
    // still only three of seven and is still refused.
    expect(
      nonMajority.changeAttributed.map((divergence) => divergence.pattern.symbol)
    ).not.toContain('requireAuth')
  })

  // The adjudication packet describes the group by what a majority of the peers do.
  // A schema-heavy module can agree on dozens of traits, and listing all of them
  // spends input tokens describing the group in ever finer detail without changing
  // what the group is — so both trait lists are bounded, strongest agreement first.
  test('the adjudication packet bounds the trait lists it carries', () => {
    const sharedCalls = Array.from(
      { length: 20 },
      (_unused, index) => `  shared${index}(request)`
    )
    const changed = handler('changed', [...sharedCalls, '  return 1'])
    const peers = Array.from({ length: 4 }, (_unused, index) =>
      handler(`peer${index}`, [
        ...sharedCalls,
        '  requireAuth(request)',
        '  return 1'
      ])
    ).join('')
    const result = divergencesFor([
      {
        path: 'src/wide/changed.ts',
        content: changed,
        hunks: wholeFileHunks(changed)
      },
      { path: 'src/wide/peers.ts', content: peers }
    ])
    const divergence = result.changeAttributed.find(
      (candidate) => candidate.pattern.symbol === 'requireAuth'
    )
    const packet = result.adjudicationInputsById.get(divergence?.id ?? '')

    expect(divergence).toBeDefined()
    expect(packet?.sharedPeerTraits.length).toBe(12)
    expect(packet?.declaration.traits.length).toBe(12)
    // The bound truncates the packet, never the divergence's own evidence.
    expect(divergence?.citedPeerCount).toBe(4)
  })
})
