// Names the per-run archive directory both eval commands keep their artifacts
// in. The UTC timestamp makes a directory listing sort chronologically; the
// UUID keeps two runs started in the same second from writing over each other.
import { randomUUID } from 'node:crypto'

export const createEvalRunArchiveId = (): string => {
  const now = new Date()
  const padded = (value: number): string => String(value).padStart(2, '0')
  const timestamp = [
    now.getUTCFullYear(),
    padded(now.getUTCMonth() + 1),
    padded(now.getUTCDate()),
    'T',
    padded(now.getUTCHours()),
    padded(now.getUTCMinutes()),
    padded(now.getUTCSeconds())
  ].join('')

  return `${timestamp}-${randomUUID()}`
}
