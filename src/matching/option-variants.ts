/**
 * Dropdown options often say the same thing as a saved answer in a different form:
 * "MA" vs "Massachusetts", "Bachelor of Science" vs "Bachelor's Degree", or "5" vs
 * "5-7 years". These helpers map both sides to a shared concept, or to a numeric
 * range, so an option can be chosen without fuzzy guessing.
 */

const states: Array<[string, string]> = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'],
  ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'], ['DC', 'District of Columbia'],
  ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'],
  ['IN', 'Indiana'], ['IA', 'Iowa'], ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'],
  ['ME', 'Maine'], ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'],
  ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'],
  ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'], ['NY', 'New York'],
  ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'], ['OK', 'Oklahoma'], ['OR', 'Oregon'],
  ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'], ['SC', 'South Carolina'], ['SD', 'South Dakota'],
  ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'],
  ['WA', 'Washington'], ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'], ['PR', 'Puerto Rico'],
];
const stateByName = new Map(states.map(([code, name]) => [name.toLocaleLowerCase('en-US'), code]));
const stateCodes = new Set(states.map(([code]) => code));

const countryAliases: Array<[string, string[]]> = [
  ['US', ['united states', 'united states of america', 'usa', 'us', 'u s', 'u s a', 'america']],
  ['GB', ['united kingdom', 'uk', 'u k', 'great britain', 'united kingdom of great britain and northern ireland']],
  ['KR', ['south korea', 'korea republic of', 'republic of korea', 'korea south']],
];

const degreePatterns: Array<[string, RegExp]> = [
  ['doctorate', /\b(?:ph\s?d|doctorate|doctoral|doctor of)\b/],
  ['master', /\b(?:master|masters|mba|m\s?sc|m\s?s|m\s?eng)\b/],
  ['bachelor', /\b(?:bachelor|bachelors|b\s?sc|b\s?s|b\s?a|b\s?eng|undergraduate degree)\b/],
  // No "AA"/"AS" abbreviations: they collide with ordinary words such as "as".
  ['associate', /\b(?:associate|associates) (?:degree|of)\b|^associates?$/],
  ['highschool', /\b(?:high school|ged|secondary school|hs diploma)\b/],
];

function simplify(text: string): string {
  return text.toLocaleLowerCase('en-US').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Concepts a short answer or option label stands for, such as "state:MA" or "degree:bachelor". */
export function conceptsOf(text: string): Set<string> {
  const concepts = new Set<string>();
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 80) return concepts;
  const simple = simplify(trimmed);

  // States: full name, the uppercase code, or "Massachusetts (MA)" / "MA - Massachusetts".
  const withoutParens = simplify(trimmed.replace(/\(([A-Z]{2})\)/, ''));
  const stateName = stateByName.get(withoutParens) ?? stateByName.get(simple);
  if (stateName) concepts.add(`state:${stateName}`);
  const codeMatch = trimmed.match(/^([A-Z]{2})$|^([A-Z]{2})\s*[-–]\s*\S|\(([A-Z]{2})\)\s*$/);
  const code = codeMatch?.[1] ?? codeMatch?.[2] ?? codeMatch?.[3];
  if (code && stateCodes.has(code)) concepts.add(`state:${code}`);

  for (const [id, aliases] of countryAliases) {
    if (aliases.includes(simple)) concepts.add(`country:${id}`);
  }
  for (const [id, pattern] of degreePatterns) {
    if (pattern.test(simple)) {
      concepts.add(`degree:${id}`);
      break;
    }
  }
  return concepts;
}

/** The single option that shares a concept with any of the saved values, or undefined. */
export function chooseConceptOption<T extends { label: string; value?: string }>(values: string[], options: T[]): T | undefined {
  const wanted = new Set(values.flatMap((value) => [...conceptsOf(value)]));
  if (wanted.size === 0) return undefined;
  const matches = options.filter((option) => [...conceptsOf(option.label), ...conceptsOf(option.value ?? '')]
    .some((concept) => wanted.has(concept)));
  return matches.length === 1 ? matches[0] : undefined;
}

type Range = { min: number; max: number; minInclusive: boolean; maxInclusive: boolean };

const number = String.raw`(\d+(?:\.\d+)?)`;

/** Parse option text such as "2-4 years", "5+ years", "Less than 1 year", or "10 or more". */
export function parseRange(label: string): Range | undefined {
  const text = label.toLocaleLowerCase('en-US').replace(/,/g, '').trim();
  let match = text.match(new RegExp(`^(?:between\\s+)?${number}\\s*(?:-|–|—|to|and)\\s*${number}\\b`));
  if (match) return { min: Number(match[1]), max: Number(match[2]), minInclusive: true, maxInclusive: true };
  match = text.match(new RegExp(`^${number}\\s*(?:\\+|or more\\b|and (?:above|up|over)\\b|or greater\\b)`));
  if (match) return { min: Number(match[1]), max: Infinity, minInclusive: true, maxInclusive: false };
  match = text.match(new RegExp(`^(?:more than|over|greater than)\\s+${number}\\b`));
  if (match) return { min: Number(match[1]), max: Infinity, minInclusive: false, maxInclusive: false };
  match = text.match(new RegExp(`^(?:at least|minimum of)\\s+${number}\\b`));
  if (match) return { min: Number(match[1]), max: Infinity, minInclusive: true, maxInclusive: false };
  match = text.match(new RegExp(`^(?:less than|under|fewer than|below)\\s+${number}\\b`));
  if (match) return { min: -Infinity, max: Number(match[1]), minInclusive: false, maxInclusive: false };
  match = text.match(new RegExp(`^${number}\\s*(?:or less|or fewer|and under)\\b`));
  if (match) return { min: -Infinity, max: Number(match[1]), minInclusive: false, maxInclusive: true };
  match = text.match(new RegExp(`^${number}\\s*(?:years?|yrs?)?$`));
  if (match) return { min: Number(match[1]), max: Number(match[1]), minInclusive: true, maxInclusive: true };
  return undefined;
}

function inRange(value: number, range: Range): boolean {
  const aboveMin = range.minInclusive ? value >= range.min : value > range.min;
  const belowMax = range.maxInclusive ? value <= range.max : value < range.max;
  return aboveMin && belowMax;
}

/** For a numeric answer such as "5" or "5 years", the single range option that contains it. */
export function chooseRangeOption<T extends { label: string }>(answer: string, options: T[]): T | undefined {
  const parsed = answer.trim().match(new RegExp(`^${number}\\s*(?:\\+|years?|yrs?)?$`, 'i'));
  if (!parsed) return undefined;
  const value = Number(parsed[1]);
  const ranged = options.map((option) => ({ option, range: parseRange(option.label) }))
    .filter((entry): entry is { option: T; range: Range } => entry.range !== undefined);
  // Only treat the list as ranges when most options are ranges.
  if (ranged.length < 2 || ranged.length < options.length * 0.6) return undefined;
  const matches = ranged.filter(({ range }) => inRange(value, range));
  return matches.length === 1 ? matches[0].option : undefined;
}
