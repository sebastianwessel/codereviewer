# 09: Readiness Self-Audit

Status: Approved
Date: 2026-06-22

This is an author self-audit only. It is not readiness approval.

## The Checklist Walk Below Is A 2026-06-22 Snapshot, Not A Current Gap List

**Amendment 2026-08-14.** The walk records `gaps: []` on every topic and
`blocking_findings_count: 0`, and it is dated 2026-06-22. Read as current, that says
this spec set has no open gaps — from the one document whose purpose is to record
them. It does not, and the document had no mechanism to notice: nothing re-runs the
walk when a spec changes, and no check compares its zero against anything.

Open gaps as of this amendment, each recorded in the spec that owns it rather than
duplicated here, so this list points and does not become a fifth copy to go stale:

| where | gap |
| --- | --- |
| `07-security-privacy-operations.md` | Redaction completeness beyond the pattern list is not claimed; over-redaction of model input is now counted and disclosed, and the ledger records its own measured rate. |
| `04-configuration-and-providers.md` | The fix and verification lanes spend after the review's budget check: counted, not gated. |
| `22-change-impact-review.md` | Adjudication is undecided, not rejected, on a corpus that cannot resolve its bar. |
| `28-targeted-reads.md` | Shipped on by default and never measured. |
| `30-review-conversation.md` | Requirement 5's bound has no configured value and no disclosure; requirement 3's vocabulary is amended to what the instrument can distinguish. |
| `11-external-context-ingestion.md` | Model resistance to a suppression payload is unmeasured in both directions. |

The walk is left as written because it is a dated record of what was audited then,
and its evidence lists remain accurate. `blocking_findings_count: 0` means *no
blocking finding was recorded on 2026-06-22*; it does not mean none exists.

**One claim checked and rejected.** The 2026-08-12 audit read the `performance_capacity`
and `ai_automation` evidence lists as stale because they cite
`specs/27-discovery-partitioning.md`, *"whose central design was measured and
removed"*. That does not hold: what was measured and removed is **sub-file**
partitioning, one section of spec 27; across-file discovery partitioning is shipped
and is the always-on default at `maxFilesPerDiscoveryCall: 2`. The citation is
correct and stays.

## Checklist Walk

```yaml
checklist_walk:
  status: draft_self_audited
  topics:
    core:
      applicability: relevant
      checklist: checklist-core.md
      evidence:
        - specs/00-scope-and-glossary.md
        - specs/02-capabilities/capability-inventory.md
      gaps: []
    end_to_end:
      applicability: relevant
      checklist: checklist-end-to-end-definition.md
      evidence:
        - specs/02-capabilities/capability-inventory.md
      gaps: []
    architecture_structure:
      applicability: relevant
      checklist: checklist-architecture-structure.md
      evidence:
        - specs/01-architecture-and-structure.md
      gaps: []
    contracts_generation:
      applicability: relevant
      checklist: checklist-contracts-generation.md
      evidence:
        - specs/03-contracts/finding-evidence-report.md
        - specs/04-configuration-and-providers.md
      gaps: []
    service_topology:
      applicability: relevant
      checklist: checklist-service-topology.md
      evidence:
        - specs/01-architecture-and-structure.md
      gaps: []
    testing_verification:
      applicability: relevant
      checklist: checklist-testing-verification.md
      evidence:
        - specs/05-review-workflow-and-runtime.md
        - specs/06-evaluation-and-quality-gates.md
        - specs/17-real-repository-eval-corpus.md
      gaps: []
    security_abuse:
      applicability: relevant
      checklist: checklist-security-abuse.md
      evidence:
        - specs/07-security-privacy-operations.md
        - specs/15-security-focused-review.md
        - specs/16-agentic-cross-file-discovery.md
      gaps: []
    secrets_privacy:
      applicability: relevant
      checklist: checklist-secrets-privacy.md
      evidence:
        - specs/07-security-privacy-operations.md
        - specs/11-external-context-ingestion.md
      gaps: []
    performance_capacity:
      applicability: relevant
      checklist: checklist-performance-capacity.md
      evidence:
        - specs/04-configuration-and-providers.md
        - specs/06-evaluation-and-quality-gates.md
        - specs/26-reactive-task-splitting.md
        - specs/27-discovery-partitioning.md
      gaps: []
    runtime_platform:
      applicability: relevant
      checklist: checklist-runtime-platform.md
      evidence:
        - specs/01-architecture-and-structure.md
        - specs/08-dependencies-and-release.md
      gaps: []
    dependencies_research:
      applicability: relevant
      checklist: checklist-dependencies-research.md
      evidence:
        - specs/08-dependencies-and-release.md
        - specs/10-state-of-the-art-research-synthesis.md
      gaps: []
    data_persistence:
      applicability: limited
      checklist: checklist-data-persistence.md
      evidence:
        - specs/01-architecture-and-structure.md
        - specs/07-security-privacy-operations.md
      gaps: []
    auth_permissions:
      applicability: limited
      checklist: checklist-auth-permissions.md
      evidence:
        - specs/07-security-privacy-operations.md
      gaps: []
    async_integrations:
      applicability: relevant
      checklist: checklist-async-integrations.md
      evidence:
        - specs/05-review-workflow-and-runtime.md
        - specs/04-configuration-and-providers.md
      gaps: []
    reporting_analytics:
      applicability: relevant
      checklist: checklist-search-reporting-analytics.md
      evidence:
        - specs/03-contracts/finding-evidence-report.md
        - specs/06-evaluation-and-quality-gates.md
      gaps: []
    import_export_sync:
      applicability: not_applicable
      checklist: checklist-import-export-sync.md
      evidence:
        - specs/02-capabilities/capability-inventory.md
      gaps: []
    ai_automation:
      applicability: relevant
      checklist: checklist-ai-ml-automation.md
      evidence:
        - specs/04-configuration-and-providers.md
        - specs/05-review-workflow-and-runtime.md
        - specs/06-evaluation-and-quality-gates.md
        - specs/07-security-privacy-operations.md
        - specs/10-state-of-the-art-research-synthesis.md
        - specs/12-verification-flow.md
        - specs/15-security-focused-review.md
        - specs/16-agentic-cross-file-discovery.md
        - specs/22-change-impact-review.md
        - specs/23-intent-fulfilment-review.md
        - specs/26-reactive-task-splitting.md
        - specs/27-discovery-partitioning.md
        - specs/28-targeted-reads.md
      gaps: []
    operations_release:
      applicability: relevant
      checklist: checklist-operations-release.md
      evidence:
        - specs/07-security-privacy-operations.md
        - specs/08-dependencies-and-release.md
      gaps: []
    frontend_ux:
      applicability: not_applicable
      checklist: checklist-index-frontend.md
      evidence:
        - specs/00-scope-and-glossary.md
      gaps: []
  blocking_findings_count: 0
```

## Known Draft Gaps

None recorded. The one gap this audit carried — `28-targeted-reads.md` being Draft
while its behaviour shipped, with its read-budget-reduction-then-retry requirement
unimplemented — no longer holds on either count, checked 2026-08-06:

- The spec is **Approved** (human, 2026-07-31); the gap text was stale.
- Reduce-then-retry **is** implemented and now has a test that pins the ORDERING
  the requirement is about: `runDiscoveryCall` narrows the read budget and retries
  the whole task on a normalised `context_length_exceeded`, and splits the task
  only once the reads cannot be narrowed further
  (`src/domains/review-workflow/pipeline/discovery/discovery-call.test.ts`). The
  verification lane does the same per claim, ending `uncertain` with bound reason
  `context-length-exceeded` rather than truncating anything to force it through.

This audit is still not approval. Readiness review can find further issues.

## Authoring Assumptions

- R1 intentionally focuses on local CLI and CI artifact behavior.
- PR publishing, automatic fixes, hosted service, browser UI, and database
  persistence are future specs.
- Provider adapter package names, ranges, and resolved versions are read from the
  committed `package.json` and lockfile, refreshed on 2026-07-31 in
  `08-dependencies-and-release.md`.
- State-of-practice review, reporting, evaluation, security, and supply-chain
  sources were retrieved or verified on 2026-06-20.
- Accuracy figures quoted in `05-review-workflow-and-runtime.md` and
  `06-evaluation-and-quality-gates.md` are audit trail, not current performance.
  Only runs from 2026-08-01 onward were produced by a pinned engine. **This
  disclaimer no longer has to reach the reader from here (2026-08-14):** spec 05
  carries the rule at its own point of use, under *The Published Rate Has One Owner*,
  which is where a reader about to quote a figure actually is. A containment
  statement filed in a document nobody opens before quoting is not containment.

## Readiness Handoff

Next step: run `spec-readiness-review` against the spec set.

**Stale as written, corrected 2026-08-14.** This section read *"These specs are not
approved until that review and human approval are recorded"* while every spec in the
set carries `Status: Approved`, most of them human-approved during July. Read
literally it says the approvals on those pages do not count. What was meant, and what
now stands: **this self-audit is not itself an approval**, as the header says; the
per-spec approvals are recorded on the specs and are not conditional on a review this
document schedules.
