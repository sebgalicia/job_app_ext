const stopWords = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'could', 'do', 'does', 'did',
  'for', 'from', 'have', 'has', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'may', 'of',
  'on', 'or', 'our', 'please', 'the', 'this', 'to', 'us', 'we', 'what', 'when', 'where', 'which',
  'who', 'will', 'would', 'you', 'your', 'currently', 'now', 'future', 'ever',
]);

const synonymGroups: string[][] = [
  ['company', 'employer', 'organization', 'organisation', 'business'],
  ['job', 'role', 'position', 'title', 'opportunity'],
  ['salary', 'compensation', 'pay', 'wage', 'remuneration'],
  ['sponsor', 'sponsorship', 'sponsored'],
  ['relocate', 'relocation', 'moving'],
  ['authorized', 'authorised', 'eligible', 'authorization', 'authorisation'],
  ['united', 'states', 'usa'],
];

const canonical = new Map<string, string>();
for (const group of synonymGroups) {
  const root = group[0];
  for (const word of group) canonical.set(word, root);
}

function stem(token: string): string {
  if (token.length > 5 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.length > 5 && token.endsWith('ing')) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith('ed')) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

/** Lowercase, remove punctuation and stopwords, lightly stem, and canonicalize synonyms. */
export function normalizeText(text: string): string[] {
  // Only the capitalized abbreviation means the country; lowercase "us" is a pronoun.
  const words = text
    .replace(/\bU\.?S\.?(?:A\.?)?(?![\p{L}\p{N}])/gu, ' united states ')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return words
    .filter((word) => !stopWords.has(word))
    // Look synonyms up before stemming too: stemming turns "united" into "unit" and
    // "moving" into "mov", which would otherwise never reach their synonym group.
    .map((word) => canonical.get(word) ?? canonical.get(stem(word)) ?? stem(word));
}
