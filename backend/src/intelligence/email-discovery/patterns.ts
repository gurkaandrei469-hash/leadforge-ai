// Email-pattern generation + ranking.
//
// Given a person's name and their company domain, generate every plausible
// localpart format and rank them by how likely they are to be that company's
// actual convention. The ranking uses historical data — we look at known
// valid emails at the same domain (or domains in the same industry) and
// learn the pattern they use, then prefer that pattern in our guesses.
//
// This is the same approach Apollo, Hunter, and Snov use internally.

import { prisma } from '../../db/prisma.js';
import { normalizeDomain } from '../matching/fuzzy.js';

// 25 patterns covering ~99% of real-world enterprise conventions.
// Order matters as the default ranking (most-common first); the ranker
// re-orders based on per-domain learning.
export const EMAIL_PATTERNS = [
  '{first}.{last}',
  '{first}',
  '{first}{last}',
  '{f}{last}',
  '{first}_{last}',
  '{first}-{last}',
  '{f}.{last}',
  '{last}.{first}',
  '{last}{first}',
  '{last}{f}',
  '{first}{l}',
  '{last}.{f}',
  '{f}{l}',
  '{first}.{l}',
  '{last}',
  '{first}{f_middle}{last}',
  '{first}_{f}',
  '{last}_{first}',
  '{first}.{last}.{f_middle}',
  '{first}{last}{n}',         // first.last1, first.last2 (numeric suffix common at large orgs)
  '{f}.{f_middle}.{last}',
  '{first}{n}',
  '{first}-{f_middle}-{last}',
  '{l}{first}',
  '{first}.{m}.{last}',
] as const;

export interface NameParts {
  first: string;     // lowercased, ASCII
  last: string;
  middle?: string;   // optional middle name
}

export interface RankedEmail {
  email: string;
  pattern: string;
  baseRank: number;      // 0..1 — position in the default ordering
  domainConfidence: number; // 0..1 — does this match the domain's known convention?
  score: number;         // combined ranking
}

/** Take a person + company-domain and return a ranked list of guesses. */
export async function generateRankedEmails(
  name: NameParts,
  domain: string,
  limit = 8,
): Promise<RankedEmail[]> {
  const d = normalizeDomain(domain);
  if (!d) return [];

  const learned = await learnDomainPattern(d);
  const candidates: RankedEmail[] = [];
  const seen = new Set<string>();

  EMAIL_PATTERNS.forEach((pattern, i) => {
    const local = renderPattern(pattern, name);
    if (!local) return;
    const email = `${local}@${d}`;
    if (seen.has(email)) return;
    seen.add(email);

    const baseRank = 1 - i / EMAIL_PATTERNS.length;
    const domainConfidence = learned.has(pattern) ? learned.get(pattern)! : 0;
    candidates.push({
      email,
      pattern,
      baseRank,
      domainConfidence,
      // Domain-learned pattern weighted 0.7; default-rank 0.3
      score: domainConfidence * 0.7 + baseRank * 0.3,
    });
  });

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, limit);
}

/** Render a pattern template like "{first}.{last}" with actual name parts.
 *  Returns null if any required token is missing. */
function renderPattern(pattern: string, n: NameParts): string | null {
  const first = strip(n.first);
  const last = strip(n.last);
  const middle = n.middle ? strip(n.middle) : '';
  if (!first || !last) return null;

  const m: Record<string, string> = {
    first, last,
    f: first[0]!,
    l: last[0]!,
    f_middle: middle ? middle[0]! : '',
    m: middle || '',
    n: '', // numeric suffix — left blank for the unsuffixed variant
  };

  // Replace every {token}
  let out = pattern.replace(/\{([a-z_]+)\}/g, (_, key) => m[key] ?? '');
  // If a token was empty (middle missing), kill any leftover dots/underscores
  out = out.replace(/[._\-]{2,}/g, '.').replace(/^[._\-]+|[._\-]+$/g, '');
  if (!out) return null;
  return out;
}

function strip(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]/g, '');
}

/** Learn the dominant pattern for a domain by inspecting known-valid emails
 *  in the workspace. Returns a Map<pattern, confidence 0..1>. */
async function learnDomainPattern(domain: string): Promise<Map<string, number>> {
  const result = new Map<string, number>();

  const knownLeads = await prisma.lead.findMany({
    where: {
      companyDomain: domain,
      emailNormalized: { not: null },
      fullName: { not: null },
      verificationStatus: 'VALID',
    },
    select: { emailNormalized: true, firstName: true, lastName: true, fullName: true },
    take: 50,
  });

  if (knownLeads.length === 0) return result;

  const counts = new Map<string, number>();
  for (const l of knownLeads) {
    if (!l.emailNormalized || !l.firstName || !l.lastName) continue;
    const local = l.emailNormalized.split('@')[0]!;
    const matched = identifyPattern(local, { first: l.firstName, last: l.lastName });
    if (matched) counts.set(matched, (counts.get(matched) ?? 0) + 1);
  }

  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (total === 0) return result;

  for (const [pattern, count] of counts) {
    result.set(pattern, count / total);
  }
  return result;
}

/** Reverse-engineer which pattern produced a given localpart for a given name. */
function identifyPattern(local: string, name: { first: string; last: string }): string | null {
  const np: NameParts = { first: name.first, last: name.last };
  for (const pattern of EMAIL_PATTERNS) {
    if (renderPattern(pattern, np) === local) return pattern;
  }
  return null;
}
