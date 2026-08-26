// The comparison key every model-bound enum answer in this domain is read
// through.
//
// Lowercased and punctuation-stripped, and deliberately the only tolerance
// applied: casing and a trailing full stop are formatting, whereas a paraphrase is
// a different answer and is not read as one of the permitted values. One
// definition, so every model-bound enum in this domain agrees about what counts
// as the same word.
export const answerKey = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z]+/gu, '')
