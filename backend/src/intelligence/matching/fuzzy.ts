// String-similarity primitives used by the identity-resolution layer.
// Levenshtein for general edit distance, Jaro-Winkler for names (gives extra
// weight to common prefixes — "Jon" and "John" should match strongly), and
// token-cosine for company descriptions / longer bodies of text.
//
// These are pure functions; the higher-level resolver in resolver.ts decides
// HOW to combine them for a given decision (lead-vs-lead, company-vs-company,
// etc.). Keeping primitives separate makes it easy to A/B test thresholds
// without rewriting the orchestration.

// ─── Levenshtein distance ───────────────────────────────────────────────────
// Classic dynamic-programming edit distance. O(m*n) time, O(min(m,n)) space.
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  // Ensure b is the shorter — we keep a single-row buffer for it
  if (a.length < b.length) [a, b] = [b, a];

  let prev = new Array(b.length + 1).fill(0).map((_, i) => i);
  let curr = new Array(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,        // insertion
        prev[j] + 1,            // deletion
        prev[j - 1] + cost,     // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/** Normalized similarity 0..1 (1 = identical). */
export function levenshteinSimilarity(a: string, b: string): number {
  if (!a.length && !b.length) return 1;
  const maxLen = Math.max(a.length, b.length);
  return 1 - levenshtein(a, b) / maxLen;
}

// ─── Jaro-Winkler similarity ────────────────────────────────────────────────
// Tuned for short strings, especially person names. Boosts the score when the
// strings share a common prefix (e.g. "Jon" vs "John", "Mike" vs "Mikael").
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;

  const matchWindow = Math.floor(Math.max(a.length, b.length) / 2) - 1;
  const aMatches: boolean[] = new Array(a.length).fill(false);
  const bMatches: boolean[] = new Array(b.length).fill(false);
  let matches = 0;

  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bMatches[j]) continue;
      if (a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  // Count transpositions
  let k = 0;
  let transpositions = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }

  const jaro = (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) / 3;

  // Winkler prefix boost — up to 4 leading-match characters, scaling factor 0.1
  let prefix = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] === b[i]) prefix++;
    else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

// ─── Token cosine similarity ────────────────────────────────────────────────
// For longer bodies (company descriptions, job titles). Treats each input as
// a bag-of-words vector and measures the angle between them.
export function tokenCosine(a: string, b: string): number {
  const tokA = tokenize(a);
  const tokB = tokenize(b);
  if (tokA.size === 0 || tokB.size === 0) return 0;

  const allTokens = new Set([...tokA.keys(), ...tokB.keys()]);
  let dot = 0, magA = 0, magB = 0;
  for (const tok of allTokens) {
    const x = tokA.get(tok) ?? 0;
    const y = tokB.get(tok) ?? 0;
    dot += x * y;
    magA += x * x;
    magB += y * y;
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB) || 1);
}

function tokenize(s: string): Map<string, number> {
  const counts = new Map<string, number>();
  const words = s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);
  for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
  return counts;
}

// ─── Normalization helpers ──────────────────────────────────────────────────

/** Strip common company suffixes so "IBM Corp" and "IBM Inc" both → "IBM". */
const COMPANY_SUFFIXES = [
  'inc', 'incorporated', 'corp', 'corporation', 'co', 'company',
  'ltd', 'limited', 'llc', 'llp', 'lp', 'gmbh', 'ag', 'sa', 'srl',
  'bv', 'nv', 'oy', 'ab', 'as', 'pty', 'plc', 'holdings', 'group',
];
const COMPANY_SUFFIX_RE = new RegExp(`\\b(?:${COMPANY_SUFFIXES.join('|')})\\.?$`, 'i');

export function normalizeCompanyName(name: string): string {
  let n = name.trim();
  // Strip trailing parenthetical clarifiers like "(formerly Acme)"
  n = n.replace(/\s*\([^)]*\)\s*$/, '');
  // Strip suffix once
  n = n.replace(COMPANY_SUFFIX_RE, '').trim();
  // Collapse internal whitespace + punctuation
  n = n.replace(/[,.&]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  return n;
}

/** Normalize a person name for matching — strip honorifics/suffixes, casefold. */
const HONORIFICS = ['mr', 'mrs', 'ms', 'miss', 'dr', 'prof', 'sir', 'lord', 'lady'];
const NAME_SUFFIXES = ['jr', 'sr', 'ii', 'iii', 'iv', 'phd', 'md', 'esq', 'cpa'];

export function normalizePersonName(name: string): { full: string; first: string; last: string } {
  const cleaned = name
    .trim()
    .replace(/[,.]/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
  const parts = cleaned.split(' ').filter((p) => p && !HONORIFICS.includes(p) && !NAME_SUFFIXES.includes(p));
  const first = parts[0] ?? '';
  const last = parts[parts.length - 1] ?? '';
  return { full: parts.join(' '), first, last };
}

/** Normalize a domain — lowercase, strip www., trim trailing slash, strip port. */
export function normalizeDomain(host: string): string {
  return host.trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/:\d+$/, '')
    .replace(/\/.*$/, '');
}
