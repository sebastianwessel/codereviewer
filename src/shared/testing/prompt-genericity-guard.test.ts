import { describe, expect, test } from 'vitest'
import {
  bannedPromptVocabulary,
  findPromptGenericityViolations
} from './prompt-genericity-guard.js'

describe('prompt genericity guard', () => {
  test('a prompt built only from public defect vocabulary is clean', () => {
    expect(
      findPromptGenericityViolations({
        promptName: 'sample',
        prompt: [
          'Report SQL injection (CWE-89), SSRF, and TOCTOU races.',
          'Judge each candidate strictly on the provided context.'
        ].join('\n')
      })
    ).toEqual([])
  })

  test('every banned category is detected, and the message names spec 15', () => {
    for (const [category, tokens] of bannedPromptVocabulary) {
      for (const token of tokens) {
        const violations = findPromptGenericityViolations({
          promptName: 'sample',
          prompt: `Apply this rule when reviewing ${token} code.`
        })

        expect(
          violations.some(
            (violation) =>
              violation.category === category &&
              violation.token === token &&
              violation.message.includes('spec 15')
          ),
          `expected "${token}" to be reported as a ${category}`
        ).toBe(true)
      }
    }
  })

  // The token match is bounded on identifier characters rather than `\b`, so an
  // ordinary word that merely CONTAINS a banned token must not fail a prompt.
  test('a banned token embedded in a longer word is not a violation', () => {
    expect(
      findPromptGenericityViolations({
        promptName: 'sample',
        prompt: 'Reactivity, Javanese, and Rustic are ordinary words.'
      })
    ).toEqual([])
  })

  // "Next.js" and "C#" contain regex metacharacters and non-word characters; a
  // naive `\b` boundary would fail to match them as written.
  test('tokens carrying punctuation are matched as written', () => {
    const tokens = findPromptGenericityViolations({
      promptName: 'sample',
      prompt: 'Prefer Next.js conventions and idiomatic C# style.'
    }).map((violation) => violation.token)

    expect(tokens).toContain('Next.js')
    expect(tokens).toContain('C#')
  })
})
