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
| FLOW-SIGNALS | CAP-SIGNAL-001 | ACT-CI, ACT-MODEL | review run step 10 | changed files and diff maps | reviewed source files, diff hunks, context hints | none | language-neutral deterministic signals/evidence plus no-content signal observability | signal fixture tests and review-runner observability test |
| FLOW-PROVIDER | CAP-PROV-001 | ACT-MODEL | review run step 10 | provider config requires model-backed review | provider config, credential presence | dynamic import of selected adapter | model alias registered or setup error | provider-resolution unit tests |
| FLOW-INSTRUCTIONS | CAP-INSTR-001 | ACT-DEV | config and CLI flags | repository-relative instruction paths | instruction files | hashes in run summary | model context receives allowed instructions | redaction and path tests |
| FLOW-SKILLS | CAP-SKILL-001 | ACT-DEV | config skills section | enabled skills with valid frontmatter and allowed directories | mounted harness skill index and controlled read/list/grep access | hash provenance and harness-mounted skill registry | selected skill content can inform model-backed task review through tool reads | traversal, frontmatter, mounting, and provenance tests |
| FLOW-HARNESS | CAP-AI-001 | ACT-MODEL | holistic discovery step | planned tasks and provider alias | task input, context ledger, evidence, signals | provider calls when configured | candidate findings or partial task state | hermetic provider fixture workflow and partial-failure tests |
| FLOW-REFUTATION | CAP-AI-004 | ACT-MODEL, ACT-REVIEWER | refutation step | candidate finding | candidate, evidence, reviewed diff ranges, review context, support signals | bounded provider calls and mediated reads/searches when needed | proved/refuted/needs-more-evidence/provider-error result | refutation tests and false-positive fixtures |
| FLOW-ADMISSION | CAP-ADM-001 | ACT-REVIEWER | admission step | candidate findings and refutation results | candidate findings, refutation results, evidence, policy | append-only decisions | admitted/rejected/artifact-only/needs-more-evidence records | promotion and admission matrix tests |
| FLOW-BASELINE | CAP-BASE-001 | ACT-CI | review run step 13 | admitted findings | fingerprints, baseline file | read baseline file | baseline statuses and resolved entries | baseline fixture tests |
| FLOW-REPORT-JSON | CAP-REP-001 | ACT-DEV, ACT-CI | review run step 14 | validated report object | admitted/rejected/evidence/run data | `report.json` | canonical JSON artifact | schema and snapshot tests |
| FLOW-REPORT-MD | CAP-REP-002 | ACT-DEV | review run step 14 | validated report object | redacted report data | `report.md` | deterministic Markdown artifact | snapshot tests |
| FLOW-REPORT-SARIF | CAP-REP-003 | ACT-CI | review run step 14 | validated report object | admitted findings and rule metadata | `report.sarif` | SARIF 2.1.0 artifact | schema/subset/redaction tests |
| FLOW-REPORT-GITHUB-COMMENTS | CAP-REP-004 | ACT-DEV, ACT-CI, ACT-REVIEWER | review run step 14 | validated report object and GitHub comment format enabled | admitted inline findings and structured fix proposals | `github-review-comments.json` | deterministic local PR comment drafts, no network publishing | renderer contract tests |
| FLOW-CONTEXT-LEDGER | CAP-CTX-001 | ACT-OPS, ACT-DEV | review planning/context assembly/refutation | review task planning and refutation tool calls | file/diff/symbol/instruction/skill/signal/tool metadata | ledger artifact | included source chunks and context reads are traceable to task and candidate IDs | ledger snapshot tests |
| FLOW-COVERAGE | CAP-COV-001 | ACT-DEV, ACT-CI, ACT-OPS | report assembly | context ledger and reviewed source files | source file hashes, byte counts, task IDs | coverage object in report artifacts | completed report has `coverage.status = complete` or run fails closed | runner large-file and schema tests |
| FLOW-EVAL | CAP-EVAL-001 | ACT-OPS | `codereviewer eval run` | fixture dataset exists | fixtures and hermetic provider fixture outputs | eval report artifacts | metrics and regressions recorded | eval runner integration test |
| FLOW-GATE | CAP-GATE-001 | ACT-CI | review or eval completion | configured thresholds | admitted findings and metrics | process exit code | pass/fail result with reasons | threshold matrix tests |
| FLOW-OBS | CAP-OPS-001 | ACT-OPS | every command | run starts | step events and redacted errors | logs and run summary | redacted observability artifacts | log/redaction tests |

## Unhappy Paths

| Path | Error/Exit | Recovery | Verification |
| --- | --- | --- | --- |
| Invalid config | exit `2` | edit config and rerun | invalid config fixture |
| Git ref starts with `-` | exit `2` | use valid ref | repository intake test |
| Missing provider adapter package | exit `2` | install named optional adapter | provider-resolution test |
| Missing credentials | exit `2` | configure named credential source | provider-resolution test |
| Provider timeout or runtime failure after task start | exit `4` with `artifactDir`; partial `run-summary.json`, `context-ledger.json`, `shared-context.json`, and `error.json` | inspect partial artifacts, reduce scope, rerun, or change provider config | hermetic provider fixture failure and runner partial-failure tests |
| Path escapes repository | exit `2` or `3` by phase | correct path/config | path traversal test |
| Budget exceeded before task | structured error, no task start | change budget/depth | planning budget test |
| Provider packet exceeds budget | exit `4` before provider call, no context mutation | split task further, increase budget, or reduce non-required scope | packet-overflow workflow test |
| Refutation packet exceeds budget | provider issue for that candidate before provider call | split task further, increase budget, or reduce non-required scope | refutation packet-overflow workflow test |
| Model candidate fails refutation | candidate remains `needs-more-evidence`, `refuted`, `artifact-only`, or rejected and is excluded from quality gate/report comments | inspect artifact-only refutation evidence and rerun with richer context or prompt changes | refutation rejection test |
| Coverage incomplete | exit `1` with `coverage_incomplete` partial artifacts | inspect coverage reason, fix packetization, or adjust scope | coverage summary runner test |
| Report rendering failure | exit `5` unless input validation error maps earlier | inspect structured error | report error test |
| CLI interrupt | partial run summary | rerun with new run ID | cancellation test |

## Data Lifecycle

| Data | Source | Classification | Retention | Deletion |
| --- | --- | --- | --- | --- |
| Source content | repository checkout | sensitive customer data | not stored in default reports/logs/traces | user deletes checkout or sensitive debug artifact |
| Evidence summary | support signals/model/admission | internal redacted data | run artifact lifetime | delete run artifact directory |
| Config summary | config/env/CLI | internal redacted data | run artifact lifetime | delete run artifact directory |
| Secrets | environment/config | secret | never intentionally stored | rotate outside tool if leaked |
| Metrics | run steps/provider usage | operational | run artifact lifetime | delete run artifact directory |

## N/A Coverage

| Area | R1 Status | Evidence |
| --- | --- | --- |
| Frontend/browser UI | not applicable | CLI and local artifacts only. |
| Remote API/SDK server | not applicable | no service process. |
| Database/schema changes | not applicable | filesystem run artifacts only. |
| Authentication/session management | not applicable | local/CI environment credentials only. |
| Notifications | not applicable | no outbound communication channel. |
| Payments/entitlements | not applicable | no commercial flow. |
| Media upload/processing | not applicable | repository checkout files only. |
| Import/export sync | not applicable | reports are generated artifacts, not remote sync. |
