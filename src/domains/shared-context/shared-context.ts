import type {
  AdmittedFinding,
  EvidenceRecord,
  RejectedFinding
} from '../../shared/contracts/index.js'
import { sha256 } from '../../shared/hash/hash.js'
import type { SupportSignalFact } from '../deterministic-signals/index.js'
import type { ContextLedgerEntry } from '../review-planning/index.js'
import type { CandidateFinding } from '../admission/index.js'

export type ReviewTaskState = 'planned' | 'running' | 'completed' | 'failed'

export type ReviewTaskRecord = {
  readonly id: string
  readonly kind: 'file' | 'dependency-cluster' | 'policy'
  readonly round: number
  readonly paths: readonly string[]
  readonly state: ReviewTaskState
  readonly workerId?: string
  readonly message?: string
}

export type SharedContextEntryKind =
  | 'support-signal-fact'
  | 'task-state'
  | 'candidate-finding'
  | 'admitted-finding'
  | 'rejected-finding'
  | 'admission-decision'

export type SharedContextEntry = {
  readonly id: string
  readonly kind: SharedContextEntryKind
  readonly summary: string
  readonly source: string
  readonly taskId?: string
  readonly evidenceIds: readonly string[]
  readonly refIds: readonly string[]
}

export type AdmissionDecisionRecord = {
  readonly candidateId: string
  readonly status: 'admitted' | 'rejected' | 'needs-more-evidence'
  readonly findingId?: string
  readonly rejectedReason?: RejectedFinding['reason']
  readonly supersedes?: string
}

export type ReviewSharedContextSnapshot = {
  readonly sharedEntries: SharedContextEntry[]
  readonly supportSignalFacts: SupportSignalFact[]
  readonly taskEvents: ReviewTaskRecord[]
  readonly currentTasks: ReviewTaskRecord[]
  readonly contextLedgerEntries: ContextLedgerEntry[]
  readonly evidenceRecords: EvidenceRecord[]
  readonly candidateFindings: CandidateFinding[]
  readonly admissionDecisions: AdmissionDecisionRecord[]
  readonly admittedFindings: AdmittedFinding[]
  readonly rejectedFindings: RejectedFinding[]
}

export type ReviewSharedContext = {
  readonly appendSupportSignalFact: (fact: SupportSignalFact) => void
  readonly appendTask: (task: ReviewTaskRecord) => void
  readonly transitionTask: (
    taskId: string,
    state: Exclude<ReviewTaskState, 'planned'>,
    message?: string
  ) => void
  readonly appendContextLedgerEntry: (entry: ContextLedgerEntry) => void
  readonly appendEvidenceRecord: (record: EvidenceRecord) => void
  readonly appendCandidateFinding: (candidate: CandidateFinding) => void
  readonly appendAdmissionDecision: (decision: AdmissionDecisionRecord) => void
  readonly appendAdmittedFinding: (finding: AdmittedFinding) => void
  readonly appendRejectedFinding: (finding: RejectedFinding) => void
  readonly digest: () => readonly SharedContextEntry[]
  readonly unfoldEvidence: (entryId: string) => readonly EvidenceRecord[]
  readonly snapshot: () => ReviewSharedContextSnapshot
}

const clone = <T>(values: readonly T[]): T[] => values.map((value) => ({ ...value }))

const currentTasksFromEvents = (
  events: readonly ReviewTaskRecord[]
): ReviewTaskRecord[] =>
  [
    ...events
      .reduce<Map<string, ReviewTaskRecord>>(
        (latestById, event) => latestById.set(event.id, event),
        new Map()
      )
      .values()
  ].map((event) => ({ ...event }))

const sharedEntryIdFor = (value: unknown): string =>
  `shared_${sha256(JSON.stringify(value)).slice(0, 16)}`

const appendSharedEntry = (
  entries: SharedContextEntry[],
  entry: Omit<SharedContextEntry, 'id'>
): void => {
  entries.push({
    id: sharedEntryIdFor(entry),
    ...entry
  })
}

export const createReviewSharedContext = (): ReviewSharedContext => {
  const sharedEntries: SharedContextEntry[] = []
  const supportSignalFacts: SupportSignalFact[] = []
  const tasks: ReviewTaskRecord[] = []
  const contextLedgerEntries: ContextLedgerEntry[] = []
  const evidenceRecords: EvidenceRecord[] = []
  const candidateFindings: CandidateFinding[] = []
  const admissionDecisions: AdmissionDecisionRecord[] = []
  const admittedFindings: AdmittedFinding[] = []
  const rejectedFindings: RejectedFinding[] = []

  return {
    appendSupportSignalFact: (fact) => {
      supportSignalFacts.push(fact)
      appendSharedEntry(sharedEntries, {
        kind: 'support-signal-fact',
        summary: fact.summary,
        source: `${fact.language}-support-signal`,
        evidenceIds: [],
        refIds: [fact.id]
      })
    },
	    appendTask: (task) => {
	      tasks.push(task)
	      appendSharedEntry(sharedEntries, {
	        kind: 'task-state',
	        summary:
	          task.message === undefined
	            ? `${task.kind} task ${task.id} is ${task.state}.`
	            : `${task.kind} task ${task.id} is ${task.state}: ${task.message}`,
	        source: task.workerId ?? 'review-planner',
	        taskId: task.id,
	        evidenceIds: [],
        refIds: [task.id]
      })
    },
    transitionTask: (taskId, state, message) => {
      const latestTask = tasks.findLast((task) => task.id === taskId)

      if (latestTask === undefined) {
        throw new TypeError(`Cannot transition missing review task: ${taskId}`)
      }

      tasks.push(
        {
          id: latestTask.id,
          kind: latestTask.kind,
          round: latestTask.round,
          paths: latestTask.paths,
          state,
          ...(latestTask.workerId === undefined
            ? {}
            : { workerId: latestTask.workerId }),
          ...(message === undefined ? {} : { message })
        }
      )
      appendSharedEntry(sharedEntries, {
        kind: 'task-state',
        summary:
          message === undefined
            ? `${latestTask.kind} task ${taskId} is ${state}.`
            : `${latestTask.kind} task ${taskId} is ${state}: ${message}`,
        source: latestTask.workerId ?? 'review-task-queue',
        taskId,
        evidenceIds: [],
        refIds: [taskId]
      })
    },
    appendContextLedgerEntry: (entry) => {
      contextLedgerEntries.push(entry)
    },
    appendEvidenceRecord: (record) => {
      if (!evidenceRecords.some((existing) => existing.id === record.id)) {
        evidenceRecords.push(record)
      }
    },
    appendCandidateFinding: (candidate) => {
      if (
        candidateFindings.some((existing) => existing.id === candidate.id)
      ) {
        return
      }

      candidateFindings.push(candidate)
      appendSharedEntry(sharedEntries, {
        kind: 'candidate-finding',
        summary: candidate.title,
        source: candidate.proposedBy,
        taskId: candidate.taskId,
        evidenceIds: candidate.evidenceIds,
        refIds: [candidate.id]
      })
    },
    appendAdmissionDecision: (decision) => {
      admissionDecisions.push(decision)
      appendSharedEntry(sharedEntries, {
        kind: 'admission-decision',
        summary: `Candidate ${decision.candidateId} is ${decision.status}.`,
        source: 'admission-gate',
        evidenceIds: [],
        refIds: [
          decision.candidateId,
          ...(decision.findingId === undefined ? [] : [decision.findingId])
        ]
      })
    },
    appendAdmittedFinding: (finding) => {
      admittedFindings.push(finding)
      appendSharedEntry(sharedEntries, {
        kind: 'admitted-finding',
        summary: finding.title,
        source: 'admission-gate',
        taskId: finding.taskId,
        evidenceIds: finding.evidenceIds,
        refIds: [finding.id]
      })
    },
    appendRejectedFinding: (finding) => {
      rejectedFindings.push(finding)
      appendSharedEntry(sharedEntries, {
        kind: 'rejected-finding',
        summary: finding.message,
        source: 'admission-gate',
        evidenceIds: finding.evidenceIds ?? [],
        refIds: [finding.candidateId]
      })
    },
    digest: () => clone(sharedEntries),
    unfoldEvidence: (entryId) => {
      const entry = sharedEntries.find((candidate) => candidate.id === entryId)

      if (entry === undefined) {
        return []
      }

      const evidenceIds = new Set(entry.evidenceIds)

      return evidenceRecords
        .filter((record) => evidenceIds.has(record.id))
        .map((record) => ({ ...record }))
    },
    snapshot: () => {
      const taskEvents = clone(tasks)

      return {
        sharedEntries: clone(sharedEntries),
        supportSignalFacts: clone(supportSignalFacts),
        taskEvents,
        currentTasks: currentTasksFromEvents(taskEvents),
        contextLedgerEntries: clone(contextLedgerEntries),
        evidenceRecords: clone(evidenceRecords),
        candidateFindings: clone(candidateFindings),
        admissionDecisions: clone(admissionDecisions),
        admittedFindings: clone(admittedFindings),
        rejectedFindings: clone(rejectedFindings)
      }
    }
  }
}
