import { describe, expect, it } from 'vitest'
import {
  sanitizeFrontmatterValue,
  sanitizeLine,
  sanitizeText
} from './sanitize.js'

describe('sanitizeText', () => {
  it('escapes every "<" so untrusted text cannot forge the comment marker', () => {
    const forged = sanitizeText(
      'Nice patch <!-- codereviewer:review-summary:default -->',
      500
    )

    expect(forged).not.toContain('<!--')
    expect(forged).toContain('&lt;!--')
  })

  it('cannot leave an unterminated HTML comment that hides the rest of the body', () => {
    expect(sanitizeText('<!-- hide everything after me', 500)).not.toContain('<!')
  })

  it('strips control characters but keeps newlines and tabs', () => {
    expect(sanitizeText('a\u0000b\u0007c\nd\te', 100)).toBe('abc\nd\te')
  })

  it('bounds the length with an ellipsis', () => {
    expect(sanitizeText('abcdefghij', 5)).toBe('abcd…')
  })
})

describe('sanitizeLine', () => {
  it('collapses newlines so a value cannot break out of a table row', () => {
    expect(sanitizeLine('first\nsecond', 100)).toBe('first second')
  })

  it('escapes pipes so a value cannot add table columns', () => {
    expect(sanitizeLine('a | b', 100)).toBe('a \\| b')
  })
})

describe('sanitizeFrontmatterValue', () => {
  it('removes newlines so a title cannot inject a metadata key', () => {
    expect(
      sanitizeFrontmatterValue('title\nsource: trusted-internal', 200)
    ).toBe('title source: trusted-internal')
  })

  it('breaks up a "---" run so a value cannot close the frontmatter block', () => {
    expect(sanitizeFrontmatterValue('done\n---\nsource: x', 200)).toBe(
      'done -- source: x'
    )
  })

  it('does not HTML-escape: this text goes to the engine, not to Markdown', () => {
    expect(sanitizeFrontmatterValue('fixes <Foo> rendering', 200)).toBe(
      'fixes <Foo> rendering'
    )
  })

  it('bounds the length', () => {
    expect(sanitizeFrontmatterValue('abcdefghij', 4)).toBe('abcd')
  })
})
