import { describe, expect, test } from 'vitest'
import { languageReviewGuidance } from './language-guidance.js'

describe('languageReviewGuidance', () => {
  test('emits a focus section for the detected language', () => {
    const guidance = languageReviewGuidance(['src/app.ts'])

    expect(guidance).toContain('## Language-specific focus (TypeScript)')
    expect(guidance).toContain('### TypeScript')
    expect(guidance).toContain('unawaited promises')
  })

  test('lists each distinct language present in the change once', () => {
    const guidance = languageReviewGuidance([
      'src/app.ts',
      'src/other.ts',
      'service/main.go'
    ])

    expect(guidance).toContain('## Language-specific focus (TypeScript, Go)')
    expect(guidance).toContain('### TypeScript')
    expect(guidance).toContain('### Go')
    // The repeated TypeScript file does not duplicate the section.
    expect(guidance.match(/### TypeScript/gu)).toHaveLength(1)
  })

  test('returns an empty string when no supported language is detected', () => {
    expect(languageReviewGuidance(['config/settings.yaml', 'README.md'])).toBe('')
    expect(languageReviewGuidance([])).toBe('')
  })
})
