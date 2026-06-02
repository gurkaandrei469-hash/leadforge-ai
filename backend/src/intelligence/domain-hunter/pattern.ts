/**
 * Email pattern detection — given a set of confirmed emails for a domain,
 * figure out the company's naming convention.
 *
 * Patterns ranked by confidence:
 *   {first}.{last}       john.smith@
 *   {first}{last}        johnsmith@
 *   {f}{last}            jsmith@
 *   {first}              john@
 *   {first}_{last}       john_smith@
 *   {f}.{last}           j.smith@
 *   {first}{l}           johns@
 */

export type PatternType =
  | 'first.last'
  | 'firstlast'
  | 'flast'
  | 'first'
  | 'first_last'
  | 'f.last'
  | 'firstl'
  | 'last'
  | 'last.first'
  | 'unknown';

export interface DetectedPattern {
  pattern: PatternType;
  confidence: number;   // 0–1
  examples: string[];
}

export function applyPattern(pattern: PatternType, first: string, last: string, domain: string): string | null {
  const f = first.toLowerCase().replace(/[^a-z]/g, '');
  const l = last.toLowerCase().replace(/[^a-z]/g, '');
  if (!f || !l) return null;

  switch (pattern) {
    case 'first.last':  return `${f}.${l}@${domain}`;
    case 'firstlast':   return `${f}${l}@${domain}`;
    case 'flast':       return `${f[0]}${l}@${domain}`;
    case 'first':       return `${f}@${domain}`;
    case 'first_last':  return `${f}_${l}@${domain}`;
    case 'f.last':      return `${f[0]}.${l}@${domain}`;
    case 'firstl':      return `${f}${l[0]}@${domain}`;
    case 'last':        return `${l}@${domain}`;
    case 'last.first':  return `${l}.${f}@${domain}`;
    default:            return null;
  }
}

// Generate ALL pattern variants for a name so we can verify each
export function generateAllCandidates(first: string, last: string, domain: string): string[] {
  const patterns: PatternType[] = [
    'first.last','firstlast','flast','f.last','first_last','firstl','first','last','last.first',
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of patterns) {
    const email = applyPattern(p, first, last, domain);
    if (email && !seen.has(email)) { seen.add(email); out.push(email); }
  }
  return out;
}

export function detectPattern(emails: string[], domain: string): DetectedPattern {
  const votes: Record<PatternType, number> = {
    'first.last': 0, 'firstlast': 0, 'flast': 0, 'first': 0,
    'first_last': 0, 'f.last': 0, 'firstl': 0, 'last': 0, 'last.first': 0, 'unknown': 0,
  };
  const examples: Record<PatternType, string[]> = Object.fromEntries(
    Object.keys(votes).map(k => [k, []])
  ) as any;

  for (const email of emails) {
    const local = email.split('@')[0]?.toLowerCase() ?? '';
    if (!local) continue;

    // first.last  ← dot + looks like two name parts
    if (/^[a-z]+\.[a-z]{2,}$/.test(local)) { votes['first.last']++; examples['first.last'].push(email); continue; }
    // last.first
    if (/^[a-z]{3,}\.[a-z]+$/.test(local) && local.indexOf('.') > 2) { votes['last.first']++; examples['last.first'].push(email); continue; }
    // f.last  ← single char + dot + last
    if (/^[a-z]\.[a-z]{2,}$/.test(local)) { votes['f.last']++; examples['f.last'].push(email); continue; }
    // first_last
    if (/^[a-z]+_[a-z]{2,}$/.test(local)) { votes['first_last']++; examples['first_last'].push(email); continue; }
    // flast  ← single char + 3–8 chars
    if (/^[a-z][a-z]{2,8}$/.test(local) && local.length <= 9) { votes['flast']++; examples['flast'].push(email); continue; }
    // firstlast  ← merged, longer
    if (/^[a-z]{6,}$/.test(local)) { votes['firstlast']++; examples['firstlast'].push(email); continue; }
    // first  ← short single word
    if (/^[a-z]{3,8}$/.test(local)) { votes['first']++; examples['first'].push(email); continue; }
    votes['unknown']++;
  }

  const sorted = (Object.entries(votes) as [PatternType, number][])
    .filter(([k]) => k !== 'unknown')
    .sort(([, a], [, b]) => b - a);

  const [topPattern, topVotes] = sorted[0] ?? ['unknown', 0];
  const total = Object.values(votes).reduce((a, b) => a + b, 0) || 1;

  return {
    pattern: topVotes > 0 ? topPattern : 'unknown',
    confidence: topVotes / total,
    examples: examples[topPattern]?.slice(0, 3) ?? [],
  };
}
