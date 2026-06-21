import { createHash } from 'node:crypto'

// Single SHA-256 helper for content hashing across domains (ids, fingerprints,
// content hashes). Accepts strings or buffers so binary content can be hashed
// without an extra encoding step.
export const sha256 = (value: string | Buffer): string =>
  createHash('sha256').update(value).digest('hex')
