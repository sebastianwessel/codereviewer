// The security pass must ask about every mechanism the eval scores it on.
//
// THE DEFECT CLASS. Three vocabularies describe the same set of security classes
// and nothing connected them: `SecurityMechanismSchema` (what an expectation may be
// labelled, and therefore what `securityRecallByMechanism` publishes a row for), the
// CWE→mechanism table in `security-mechanism-attribution.ts` (what a finding's CWE
// tags resolve to), and the dedicated pass's own checklist (what the model is
// actually asked to look for). Spec 15 requires the third to apply "across the
// mechanisms above" — the same eleven-item list the first is built from.
//
// It had already drifted. `open-redirect` was added to the spec's mechanism list, to
// the enum and to the CWE table on 2026-08-07; the checklist was not touched. The
// eval went on publishing an `open-redirect` recall row while the security pass had
// never named the class, and no test, type or schema noticed — the checklist is a
// string, and a string cannot be exhaustive over an enum.
//
// WHY IT ASSERTS THROUGH CWE IDS rather than by looking for each mechanism's NAME in
// the text. A name match would be satisfied by the word appearing anywhere and would
// force the checklist's headings to mirror the measurement vocabulary, which is a
// real constraint on prompt wording for no gain — the two are organised differently
// on purpose. The checklist groups by SINK, so CWE-79 sits with the other injection
// sinks a reviewer scans in one pass; the vocabulary groups by WEAKNESS CLASS, where
// CWE-79 is the `xss` family. Routing the assertion through the same CWE table that
// attribution uses tests the thing that matters — is this class in the prompt's
// scope at all — while leaving the prose free, and it fails if either the table or
// the checklist moves without the other.
//
// WHERE IT LIVES. In `evaluation`, importing the prompt, rather than in
// `review-workflow` importing the vocabulary. The engine must not depend on the
// measurement layer that scores it; `evaluation` already depends on
// `review-workflow` to run reviews, so the assertion goes on that side of the seam.

import { describe, expect, test } from 'vitest'
import { securityReviewChecklist } from '../../review-workflow/pipeline/discovery/holistic-task-review.js'
import { SecurityMechanismSchema } from '../corpus/eval-fixture.schema.js'
import { securityMechanismFromCwe } from './security-mechanism-attribution.js'

// The checklist writes families in slash shorthand — `CWE-89/78/94/79` — so a bare
// `CWE-\d+` scan would see only the first id of each group and report four classes
// missing that are present.
const cweIdsIn = (text: string): readonly string[] => {
  const ids: string[] = []

  for (const match of text.matchAll(/CWE-(\d+(?:\/\d+)*)/gu)) {
    const group = match[1]

    if (group !== undefined) {
      ids.push(...group.split('/').map((id) => `CWE-${id}`))
    }
  }

  return ids
}

describe('security checklist mechanism coverage', () => {
  const checklistCweIds = cweIdsIn(securityReviewChecklist)
  const mechanisms = SecurityMechanismSchema.options

  test('the checklist names CWE ids to check against', () => {
    // ANTI-VACUITY, both halves. Every assertion below is a lookup over these two
    // lists: an empty id scan (a shorthand this parser stopped understanding) or an
    // empty enum would satisfy the coverage test while proving nothing, which is
    // the same silent success the file exists to catch.
    expect(checklistCweIds.length).toBeGreaterThan(10)
    expect(mechanisms.length).toBeGreaterThan(10)
  })

  test('every CWE id in the checklist resolves to a mechanism', () => {
    // The reverse direction, and it is not redundant. It catches an id added to the
    // prompt that the attribution table does not know: the model would be asked to
    // report a class whose findings could never be attributed, so every
    // per-mechanism precision rate in the run would be nulled by the unattributed
    // bucket that class lands in.
    for (const cweId of checklistCweIds) {
      expect(securityMechanismFromCwe([cweId])).not.toBeUndefined()
    }
  })

  test.each([...mechanisms])(
    'the checklist asks about %s',
    (mechanism) => {
      // Spec 15: the checklist applies across the mechanisms the eval measures. A
      // failure here means one of two things, and both need a human ruling rather
      // than a quick edit: either a new mechanism was added to the vocabulary and
      // the security pass was never told to hunt it — in which case the eval is
      // about to publish a recall row for a class nothing asks about — or a class
      // was deliberately dropped from the prompt, which is a change to what the
      // engine looks for and belongs in spec 15 before it belongs here.
      const covered = checklistCweIds.some(
        (cweId) => securityMechanismFromCwe([cweId]) === mechanism
      )

      expect(covered).toBe(true)
    }
  )
})
