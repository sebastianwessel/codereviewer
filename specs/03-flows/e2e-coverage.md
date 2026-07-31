# 03: End-To-End Coverage

Status: Approved
Date: 2026-07-22

## Coverage Rule

Each R1 capability must map to an actor, entrypoint, contract, side effect,
permission rule, unhappy path, recovery behavior, final state, and verification.
Implementation tickets must not invent missing behavior.

## Flow Matrix

| Flow ID | Capability | Actor/Consumer | Entrypoint | Preconditions | Data Touched | Side Effects | Final State | Verification |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| FLOW-REVIEW-LOCAL | CAP-CLI-001 | ACT-DEV | `codereviewer review` | valid config, repository or explicit files | git metadata, selected files, instructions, skills metadata | run artifact directory only | reports exist or structured error exits | CLI fixture integration test |
| FLOW-CONFIG-VALIDATE | CAP-CLI-002 | ACT-DEV, ACT-CI | `codereviewer config validate` | optional config path | config file and environment names | none | normalized redacted summary or schema error | config fixture tests |
| FLOW-REPO-INTAKE | CAP-REPO-001 | ACT-DEV, ACT-CI | repository intake step | valid repository root and refs | git diff, file stats, selected files | none | portable changed/skipped file records | POSIX/Windows and git fixture tests |
| FLOW-SIGNALS | CAP-SIGNAL-001 | ACT-CI, ACT-MODEL | deterministic support signal step | changed files and diff maps | reviewed source files, diff hunks, context hints | none | language-neutral deterministic signals/evidence plus no-content signal observability | signal fixture tests and review-runner observability test |
| FLOW-PROVIDER | CAP-PROV-001 | ACT-MODEL | provider resolution step | provider config requires model-backed review | provider config, credential presence | dynamic import of selected adapter | model alias registered or setup error | provider-resolution unit tests |
| FLOW-INSTRUCTIONS | CAP-INSTR-001 | ACT-DEV | config and CLI flags | repository-relative instruction paths | instruction files | hashes in run summary | model context receives allowed instructions | redaction and path tests |
| FLOW-SKILLS | CAP-SKILL-001 | ACT-DEV | config skills section | enabled skills with valid frontmatter and allowed directories | mounted harness skill index and controlled read/list/grep access | hash provenance and harness-mounted skill registry | selected skill content can inform model-backed task review through tool reads | traversal, frontmatter, mounting, and provenance tests |
| FLOW-HARNESS | CAP-AI-001 | ACT-MODEL | holistic discovery step | planned tasks and provider alias | task input, context ledger, evidence, signals | provider calls when configured | candidate findings or partial task state | hermetic provider fixture workflow and partial-failure tests |
| FLOW-CROSS-FILE | CAP-AI-006 | ACT-MODEL | holistic discovery step (when `review.crossFileRetrieval.enabled`, on by default) | mediated context retriever available | mediated `repo_read`/`repo_list`/`repo_grep` over eligible files, optionally narrowed to a line range | bounded provider tool steps and ledger `tool-result` entries, no writes | candidates carrying cross-file evidence, or (disabled) a single-shot tool-free review | cross-file tool and discovery wiring tests |
| FLOW-DISCOVERY-PARTITION | CAP-AI-010 | ACT-MODEL | holistic discovery step | a task with more review targets than `aiReview.maxFilesPerDiscoveryCall` | the task's review targets and its shared context documents | one sub-task and one sequential discovery call per partition, security pass partitioned identically | candidates unioned across partitions, each restricted to the files its own call saw | discovery partition unit tests |
| FLOW-TASK-SPLIT | CAP-AI-011 | ACT-MODEL | holistic discovery step | provider raised normalised `context_length_exceeded` | the refused task's review context | task halved and each half retried sequentially from its own rebuilt prompt, split count reported | findings from the halves concatenated, or `review_task_indivisible` when nothing is left to halve | reactive split unit tests |
| FLOW-SEMANTIC-MERGE | CAP-AI-005 | ACT-MODEL, ACT-REVIEWER | semantic finding merge step (after discovery, before admission) | a file with two or more discovery candidates | that file's candidates and its line-numbered content | one provider call per merging file | groups reduced to one representative each, non-representative members recorded as `duplicate` rejections | scripted-runner merge unit tests and discovery wiring tests |
| FLOW-REFUTATION | CAP-AI-004 | ACT-MODEL, ACT-REVIEWER | refutation step | candidate finding | candidate, evidence, reviewed diff ranges, review context, support signals | bounded provider calls and mediated reads/searches when needed | proved/refuted/needs-more-evidence/provider-error result | refutation tests and false-positive fixtures |
| FLOW-ADMISSION | CAP-ADM-001 | ACT-REVIEWER | admission step | candidate findings and refutation results | candidate findings, refutation results, evidence, policy | append-only decisions | admitted/rejected/artifact-only/needs-more-evidence records | promotion and admission matrix tests |
| FLOW-BASELINE | CAP-BASE-001 | ACT-CI | baseline matching step (after admission) | admitted findings | fingerprints, baseline file | read baseline file | baseline statuses and resolved entries | baseline fixture tests |
| FLOW-REPORT-JSON | CAP-REP-001 | ACT-DEV, ACT-CI | report rendering step | validated report object | admitted/rejected/evidence/run data | `report.json` | canonical JSON artifact | schema and snapshot tests |
| FLOW-REPORT-MD | CAP-REP-002 | ACT-DEV | report rendering step | validated report object | redacted report data | `report.md` | deterministic Markdown artifact | snapshot tests |
| FLOW-REPORT-SARIF | CAP-REP-003 | ACT-CI | report rendering step | validated report object | admitted findings and rule metadata | `report.sarif` | SARIF 2.1.0 artifact | schema/subset/redaction tests |
| FLOW-REPORT-REVIEW-COMMENTS | CAP-REP-004 | ACT-DEV, ACT-CI, ACT-REVIEWER | report rendering step | validated report object and `reporting.reviewComments.enabled` | admitted inline findings and structured fix proposals | `review-comments.json` and `review-comments.<platform>.json` | deterministic local platform-neutral comment drafts, no network publishing | renderer + detection contract tests |
| FLOW-CONTEXT-LEDGER | CAP-CTX-001 | ACT-OPS, ACT-DEV | review planning/context assembly/refutation | review task planning and refutation tool calls | file/diff/symbol/instruction/skill/signal/tool metadata | ledger artifact | included source chunks and context reads are traceable to task and candidate IDs | ledger snapshot tests |
| FLOW-CONTEXT-INGESTION | CAP-CTX-002 | ACT-CI, ACT-DEV | review run change-intent stage (after context assembly) | `contextSources.enabled` with providers configured | inbox/changed-files fragments, redacted and summarized | one bounded `change-intent` context document injected per task, ledger entry `task-context-change-intent` | brief injected or (disabled/failed provider) review unchanged and non-fatal | context-ingestion unit tests and CLI enabled/disabled integration test |
| FLOW-VERIFICATION | CAP-VERIFY-001 | ACT-CI, ACT-DEV, ACT-MODEL | verification flow (when `verification.enabled`) | claim providers configured, model provider resolvable | claims, mediated read/list/grep over eligible files, per-claim budgets | bounded agent tool calls, ledger entries, no network/write | claim verdicts (`confirmed`/`refuted`/`uncertain`) in a verification report, corroboration signal on matching findings | claim/verdict + tool-hardening unit tests and deterministic-provider integration test |
| FLOW-COVERAGE | CAP-COV-001 | ACT-DEV, ACT-CI, ACT-OPS | report assembly | context ledger and reviewed source files | source file hashes, byte counts, task IDs | coverage object in report artifacts | completed report has `coverage.status = complete` or run fails closed | runner large-file and schema tests |
| FLOW-FIX | CAP-VERIFY-004 | ACT-DEV, ACT-CI, ACT-MODEL | fix lane (when `fix.enabled`), after the review report exists | admitted findings at or above `fix.minSeverity`, provider resolvable | admitted findings, mediated reads over eligible files | bounded provider calls, `fix-report.json` in the run artifact directory | boolean finding judgments and apply-checked fix proposals, advisory only | fix lane and apply-check tests |
| FLOW-BASELINE-WRITE | CAP-BASE-001 | ACT-DEV, ACT-CI | `codereviewer baseline write` | a completed `report.json` resolvable from the run index or `--report` | admitted-finding fingerprints | writes the configured `baseline.path` | baseline file with fingerprints copied verbatim, or `baseline_source_unavailable` at exit `3` | baseline writer and CLI baseline command tests |
| FLOW-DRIFT | CAP-DRIFT-001 | ACT-DEV, ACT-CI, ACT-OPS | `codereviewer drift check`, and the review preflight | config loaded | specs, docs, CLI inventory, generated schemas, security config | none from the command itself | deterministic drift findings; exit `1` when the gate fails | drift checker tests |
| FLOW-IMPACT | CAP-IMPACT-001 | ACT-DEV, ACT-CI | `codereviewer impact check` | `changeImpact.enabled` | changed symbols and their reference sites, read through the mediated retriever | none; stdout only | bounded impact report, or a disabled report | change-impact and CLI tests |
| FLOW-INTENT | CAP-INTENT-001 | ACT-DEV, ACT-CI, ACT-MODEL | `codereviewer intent check` | `intentFulfilment.enabled`, provider configured | stated intent, the change diff | provider calls; stdout only | obligation checklist with per-obligation judgement, advisory only and never able to fail a pipeline | intent extraction/judgement and CLI tests |
| FLOW-CONFORMANCE | CAP-CONF-001 | ACT-DEV, ACT-CI, ACT-MODEL | `codereviewer conformance check` | `invariantConformance.enabled` | changed declarations and their peer sets | provider calls only when adjudication is enabled; stdout only | bounded divergence report, adjudicated or reported unjudged | peer-derivation, divergence, and adjudication tests |
| FLOW-EVAL | CAP-EVAL-001 | ACT-OPS | `codereviewer eval run` | fixture dataset exists | fixtures and hermetic provider fixture outputs | eval report artifacts under `.codereviewer/eval/` and `.codereviewer/eval/runs/<run-id>/` | metrics and regressions recorded; exit `1` when the regression gate fails | eval runner integration test |
| FLOW-EVAL-ANALYSIS | CAP-EVAL-002 | ACT-OPS | `codereviewer eval compare`, `eval recall-report`, `eval slice-manifest` | saved eval reports or a slice root | eval artifacts and slice metadata | none; stdout only | comparison, recall, or manifest output; comparison refuses across differing `metricsVersion` or `provenance.answerKeyDigest` | focused CLI tests |
| FLOW-EVAL-JUDGE | CAP-EVAL-003 | ACT-OPS | `codereviewer eval run` scoring a case with expected findings | provider configured | expected semantic summaries and admitted finding titles/descriptions only | provider calls for matching, plausibility, and both calibrations | judge decisions with reasons, agreement and trustworthiness recorded, or `eval_semantic_judge_missing` at exit `2` | hermetic scripted-judge, calibration, and CLI tests |
| FLOW-GATE | CAP-GATE-001 | ACT-CI | review or eval completion | configured thresholds | admitted findings and metrics | process exit code | pass/fail result with reasons | threshold matrix tests |
| FLOW-OBS | CAP-OPS-001 | ACT-OPS | every command | run starts | step events and redacted errors | logs, run summary, and `observability.json` | redacted observability artifacts | log/redaction tests |

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
| Provider packet exceeds the local runaway guard or a configured `contextMaxBytes` | exit `4` with `task_packet_budget_exceeded` before the provider call, no context mutation | reduce scope or raise the configured budget | packet-overflow workflow test |
| Provider refuses a packet as exceeding its context length | task halved and each half retried; no user-visible failure while a split is still possible | none required | reactive split test |
| Provider refuses a packet that cannot be split further | exit `4` with `review_task_indivisible`, nothing truncated | review a smaller change, or configure a model with a larger context window | indivisible-task test |
| Run cost exceeds `review.maxCostUsd` | exit `1` with `cost_budget_exceeded` | raise the budget or reduce scope | cost budget test |
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
