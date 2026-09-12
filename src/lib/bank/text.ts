// Used by scripts/build-bank.ts to validate that a word seed's
// `example.ja` (which keeps "。"/"、") agrees with its `example.tokens`
// (which never contain punctuation -- see ExampleToken in ./types.ts):
// stripping "。"/"、" out of `ja` must equal every token's surface
// concatenated, in order.

const EXAMPLE_PUNCTUATION_RE = /[。、]/g;

/** Remove the sentence punctuation allowed in example.ja (｡ and ､) so it can be compared against the tokens' concatenated surfaces. */
export function stripExamplePunctuation(text: string): string {
  return text.replace(EXAMPLE_PUNCTUATION_RE, "");
}
