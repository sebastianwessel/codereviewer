import { describe, expect, test } from 'vitest'
import { projectName } from './index.js'

// `runtimeBaseline.harnessVersion` used to be exported beside `projectName` and is
// deliberately gone rather than corrected. It restated `@purista/harness`'s version
// as a string literal, said `1.5.1` while `package.json` required `^1.7.1`, was read
// by nothing, and the assertion here pinned the wrong value — so it was dead code,
// drift, and a test guaranteeing nobody would notice either, all on the package's
// public export surface. The dependency range in `package.json` is the runtime
// floor and npm enforces it at install; a second copy could only ever disagree
// with it.
describe('project baseline', () => {
  test('exports the project identity', () => {
    expect(projectName).toBe('@sebastianwessel/codereviewer')
  })
})
