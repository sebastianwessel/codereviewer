import { describe, expect, test } from 'vitest'
import { projectName, runtimeBaseline } from './index.js'

describe('project baseline', () => {
  test('exports the project identity and runtime baselines', () => {
    expect(projectName).toBe('@sebastianwessel/codereviewer')
    expect(runtimeBaseline.harnessVersion).toBe('1.5.1')
  })
})
