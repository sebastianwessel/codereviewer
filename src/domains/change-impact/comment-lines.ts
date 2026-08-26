// The one definition of "this line is a comment, not code", for the two places in
// this domain that read raw source text.
//
// Both of them exist because this capability reads TEXT rather than resolving
// bindings or comparing parse trees: dependent discovery matches a symbol name
// against lines, and the contract delta matches language-neutral markers against
// the lines a diff added and removed. Text search cannot tell a call from a
// sentence that mentions one, and neither can a marker match tell a `raise` from a
// `# raise` — so both need the same predicate, and having two of it would let them
// disagree about what code is.

// Comment leaders across the seven supported languages. `#` is unambiguous here:
// none of them uses it for a preprocessor directive, so a line starting with it is
// a comment in Python and Ruby and nothing else anywhere.
const COMMENT_LEADERS = [
  '//',
  '/*',
  '*',
  '#',
  '--',
  ';',
  '"""',
  "'''",
  '<!--'
] as const

/**
 * Whether a line is a comment rather than code.
 *
 * In DISCOVERY, a symbol mentioned in prose matches exactly as strongly as one
 * that is called. Rack's `scheme` returned 53 references, and among them was
 * `## The URL scheme, which must be one of <tt>http</tt>…` — documentation, listed
 * beside real call sites with nothing to distinguish them. A reviewer handed an
 * unranked list cannot tell which is which without opening every one, and a list
 * that looks like signal while carrying prose is worse than a shorter honest one.
 *
 * In the CONTRACT DELTA, a commented-out construct is not something a caller can
 * observe, so it can neither create a contract change nor cancel one.
 *
 * Only WHOLE-LINE comments are dropped. A trailing `// …` after real code still
 * contains that code, and stripping on a trailing marker would need to know
 * whether the marker is inside a string literal — which text matching cannot know.
 * Under-filtering is the right direction for both callers: in discovery a kept
 * comment is noise while a dropped call site is a missed dependent, and in the
 * delta a kept comment is the behaviour that already shipped.
 */
export const isCommentLine = (text: string): boolean => {
  const trimmed = text.trim()

  return COMMENT_LEADERS.some((leader) => trimmed.startsWith(leader))
}

/** The subset of `lines` that is code. */
export const withoutCommentLines = (
  lines: readonly string[]
): readonly string[] => lines.filter((line) => !isCommentLine(line))
