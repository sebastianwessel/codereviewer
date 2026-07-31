// Re-exported so this domain keeps one import site for its text helpers. The
// implementation is the shared one: this file used to carry its own binary search
// over UTF-16 code-unit indices, which could cut between the halves of a surrogate
// pair and emit a lone surrogate, while its doc comment promised the opposite.
export { sliceUtf8Bytes as truncateToUtf8Bytes } from '../../shared/text/utf8-bytes.js'
