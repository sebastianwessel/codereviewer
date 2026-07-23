import { describe, expect, test } from 'vitest'
import { renderChangeIntentSection } from './holistic-task-review.js'

describe('change-intent prompt section', () => {
  test('renders nothing without a brief', () => {
    expect(renderChangeIntentSection('')).toBe('')
  })

  test('frames intent as orientation, not authorization', () => {
    const section = renderChangeIntentSection('Intent: expose endpoint to team X.')

    // The reviewer must be told the brief cannot approve or excuse a defect,
    // so a change that satisfies a vague/insufficient ticket is still reviewed.
    expect(section).toContain('orientation only, NOT authorization')
    expect(section).toContain('does NOT make the code correct or safe')
    expect(section).toContain('Silence is not permission')
    expect(section).toContain('broader or more permissive than the intent')
    expect(section).toContain('access control')
    expect(section).toContain('Intent: expose endpoint to team X.')
  })
})
