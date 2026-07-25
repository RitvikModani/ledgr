/**
 * Word-boundary keyword matching.
 *
 * Plain `haystack.includes(keyword)` looks fine until it isn't: "premium"
 * contains "emi", so an insurance premium classifies as a loan instalment.
 * "gossip" contains "sip", "sloan" contains "loan". Every keyword here has to
 * match whole words, including multi-word phrases.
 *
 * Regexes are compiled once and cached — classification runs per imported row,
 * and building a RegExp for every keyword on every row is measurably slow on a
 * few thousand transactions.
 */
const cache = new Map<string, RegExp>();

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matcher(keyword: string): RegExp {
  const trimmed = keyword.trim();
  let regex = cache.get(trimmed);
  if (!regex) {
    // Spaces in a phrase tolerate any run of whitespace, so "home loan" still
    // matches "home  loan" after normalisation collapses oddly.
    const body = escape(trimmed).replace(/\\?\s+/g, "\\s+");
    regex = new RegExp(`(?:^|[\\s&])${body}(?:[\\s&]|$)`, "i");
    cache.set(trimmed, regex);
  }
  return regex;
}

export function matchesKeyword(haystack: string, keyword: string): boolean {
  return matcher(keyword).test(haystack);
}

/** First matching keyword, or null. */
export function findKeyword(haystack: string, keywords: string[]): string | null {
  for (const keyword of keywords) {
    if (matchesKeyword(haystack, keyword)) return keyword;
  }
  return null;
}
