# 03: End-To-End Coverage

Status: Approved
Date: 2026-06-20

## Coverage Rule

Each R1 capability must map to an actor, entrypoint, contract, side effect,
permission rule, unhappy path, recovery behavior, final state, and verification.
Implementation tickets must not invent missing behavior.

## Flow Matrix

| Flow ID | Capability | Actor/Consumer | Entrypoint | Preconditions | Data Touched | Side Effects | Final State | Verification |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| FLOW-REVIEW-LOCAL | CAP-CLI-001 | ACT-DEV | `codereviewer review` | valid config, repository or explicit files | git metadata, selected files, instructions, skills metadata | run artifact directory only | reports exist or structured error exits | CLI fixture integration test |
| FLOW-CONFIG-VALIDATE | CAP-CLI-002 | ACT-DEV, ACT-CI | `codereviewer config validate` | optional config path | config file and environment names | none | normalized redacted summary or schema error | config fixture tests |
| FLOW-REPO-INTAKE | CAP-REPO-001 | ACT-DEV, ACT-CI | review run step 5 | valid repository root and refs | git diff, file stats, selected files | none | portable changed/skipped file records | POSIX/Windows and git fixture tests |
| FLOW-LANGUAGE-ANALYSIS | CAP-LANG-001 | ACT-CI | review run step 8 | changed files for a first-class language | source files for TypeScript, JavaScript, Python, Go, Rust, or Java | none | language-neutral facts/evidence/test mappings | analyzer fixture tests |
| FLOW-PROVIDER | CAP-PROV-001 | ACT-MODEL | review run step 10 | provider config requires model-backed review | provider config, credential presence | dynamic import of selected adapter | model alias registered or setup error | provider-resolution unit tests |
| FLOW-INSTRUCTIONS | CAP-INSTR-001 | ACT-DEV | config and CLI flags | repository-relative instruction paths | instruction files | hashes in run summary | model context receives allowed instructions | redaction and path tests |
| FLOW-SKILLS | CAP-SKILL-001 | ACT-DEV | config skills section | enabled skills with valid frontmatter and allowed directories | mounted harness skill index and controlled read/list/grep access | hash provenance and harness-mounted skill registry | selected skill content can inform model-backed task review through tool reads | traversal, frontmatter, mounting, and provenance tests |
| FLOW-HARNESS | CAP-WF-001 | ACT-MODEL | review run step 11 | planned tasks and provider alias when needed | task input, context ledger, evidence | provider calls when configured | candidate findings/evidence or partial task state | scripted provider workflow and partial-failure tests |
| FLOW-ADMISSION | CAP-ADM-001 | ACT-REVIEWER | review run step 12 | candidate findings | candidates, evidence, policy | append-only decisions | admitted/rejected/needs-more-evidence records | admission matrix tests |
| FLOW-BASELINE | CAP-BASE-001 | ACT-CI | review run step 13 | admitted findings | fingerprints, baseline file | read baseline file | baseline statuses and resolved entries | baseline fixture tests |
| FLOW-REPORT-JSON | CAP-REP-001 | ACT-DEV, ACT-CI | review run step 14 | validated report object | admitted/rejected/evidence/run data | `report.json` | canonical JSON artifact | schema and snapshot tests |
| FLOW-REPORT-MD | CAP-REP-002 | ACT-DEV | review run step 14 | validated report object | redacted report data | `report.md` | deterministic Markdown artifact | snapshot tests |
| FLOW-REPORT-SARIF | CAP-REP-003 | ACT-CI | review run step 14 | validated report object | admitted findings and rule metadata | `report.sarif` | SARIF 2.1.0 artifact | schema/subset/redaction tests |
| FLOW-CONTEXT-LEDGER | CAP-CTX-001 | ACT-OPS, ACT-DEV | review planning/context assembly | review task planning | file/diff/symbol/instruction/skill metadata | ledger artifact | included source chunks are traceable to task IDs | ledger snapshot tests |
| FLOW-COVERAGE | CAP-COV-001 | ACT-DEV, ACT-CI, ACT-OPS | report assembly | context ledger and reviewed source files | source file hashes, byte counts, task IDs | coverage object in report artifacts | completed report has `coverage.status = complete` or run fails closed | runner large-file and schema tests |
| FLOW-EVAL | CAP-EVAL-001 | ACT-OPS | `codereviewer eval run` | fixture dataset exists | fixtures and scripted provider outputs | eval report artifacts | metrics and regressions recorded | eval runner integration test |
| FLOW-GATE | CAP-GATE-001 | ACT-CI | review or eval completion | configured thresholds | admitted findings and metrics | process exit code | pass/fail result with reasons | threshold matrix tests |
| FLOW-OBS | CAP-OPS-001 | ACT-OPS | every command | run starts | step events and redacted errors | logs and run summary | redacted observability artifacts | log/redaction tests |

## Unhappy Paths

| Path | Error/Exit | Recovery | Verification |
| --- | --- | --- | --- |
| Invalid config | exit `2` | edit config and rerun | invalid config fixture |
| Git ref starts with `-` | exit `2` | use valid ref | repository intake test |
| Missing provider adapter package | exit `2` | install named optional adapter | provider-resolution test |
| Missing credentials | exit `2` | configure named credential source | provider-resolution test |
| Provider timeout or runtime failure after task start | exit `4` with `artifactDir`; partial `run-summary.json`, `context-ledger.json`, `shared-context.json`, and `error.json` | inspect partial artifacts, reduce scope, rerun, or change provider config | scripted provider failure and runner partial-failure tests |
| Path escapes repository | exit `2` or `3` by phase | correct path/config | path traversal test |
| Budget exceeded before task | structured error, no task start | change budget/depth | planning budget test |
| Provider packet exceeds budget | exit `4` before provider call, no context mutation | split task further, increase budget, or reduce non-required scope | packet-overflow workflow test |
| Coverage incomplete | exit `1` with `coverage_incomplete` partial artifacts | inspect coverage reason, fix packetization, or adjust scope | coverage summary runner test |
| Report rendering failure | exit `5` unless input validation error maps earlier | inspect structured error | report error test |
| CLI interrupt | partial run summary | rerun with new run ID | cancellation test |

## Data Lifecycle

| Data | Source | Classification | Retention | Deletion |
| --- | --- | --- | --- | --- |
| Source content | repository checkout | sensitive customer data | not stored in default reports/logs/traces | user deletes checkout or sensitive debug artifact |
| Evidence summary | analyzers/model/admission | internal redacted data | run artifact lifetime | delete run artifact directory |
| Config summary | config/env/CLI | internal redacted data | run artifact lifetime | delete run artifact directory |
| Secrets | environment/config | secret | never intentionally stored | rotate outside tool if leaked |
| Metrics | run steps/provider usage | operational | run artifact lifetime | delete run artifact directory |

## N/A Coverage

| Area | R1 Status | Evidence |
| --- | --- | --- |
| Frontend/browser UI | not applicable | CLI and local artifacts only. |
| Remote API/SDK server | not applicable | no service process. |
| Database/migrations | not applicable | filesystem run artifacts only. |
| Authentication/session management | not applicable | local/CI environment credentials only. |
| Notifications | not applicable | no outbound communication channel. |
| Payments/entitlements | not applicable | no commercial flow. |
| Media upload/processing | not applicable | repository checkout files only. |
| Import/export sync | not applicable | reports are generated artifacts, not remote sync. |
