// Identity resolution — given a new lead candidate, find the best-matching
// existing lead (if any) so we can merge instead of creating duplicates.
//
// Resolution pipeline (cheap → expensive):
//   1. Deterministic match — exact email or exact linkedin URL
//   2. Strong heuristic   — same normalized name + same company domain
//   3. Fuzzy match        — Jaro-Winkler on name × company similarity > 0.85
//
// We bail at the first match because the cheapest stage almost always wins.
// The fuzzy stage is the slowest (DB scan within the same company) but is
// what catches "Jon Smith" vs "John Smith" at the same employer.

import type { Lead } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import {
  jaroWinkler, normalizeCompanyName, normalizePersonName, normalizeDomain,
} from './fuzzy.js';

export interface LeadCandidate {
  email?: string | null;
  fullName?: string | null;
  linkedinUrl?: string | null;
  companyName?: string | null;
  companyDomain?: string | null;
}

export interface ResolutionResult {
  match: Lead | null;
  /** "exact_email" | "exact_linkedin" | "name_company" | "fuzzy" | "none" */
  reason: string;
  confidence: number;
}

const FUZZY_NAME_THRESHOLD = 0.92;
const FUZZY_COMPANY_THRESHOLD = 0.85;

export async function resolveLead(
  teamId: string,
  candidate: LeadCandidate,
): Promise<ResolutionResult> {
  // ── Stage 1: exact email ──────────────────────────────────────────────
  if (candidate.email) {
    const norm = candidate.email.toLowerCase().trim();
    const hit = await prisma.lead.findFirst({
      where: { teamId, emailNormalized: norm },
    });
    if (hit) return { match: hit, reason: 'exact_email', confidence: 1 };
  }

  // ── Stage 2: exact LinkedIn URL ──────────────────────────────────────
  if (candidate.linkedinUrl) {
    const li = candidate.linkedinUrl.replace(/\/$/, '').toLowerCase();
    const hit = await prisma.lead.findFirst({
      where: { teamId, linkedinUrl: { equals: li, mode: 'insensitive' } },
    });
    if (hit) return { match: hit, reason: 'exact_linkedin', confidence: 0.99 };
  }

  // ── Stage 3: same normalized name + same company domain ─────────────
  // This is the "common case" for partial matches where someone is
  // extracted twice from different pages of the same site.
  if (candidate.fullName && candidate.companyDomain) {
    const name = normalizePersonName(candidate.fullName);
    const domain = normalizeDomain(candidate.companyDomain);
    if (name.full && domain) {
      const hits = await prisma.lead.findMany({
        where: {
          teamId,
          companyDomain: domain,
          OR: [
            { fullName: { equals: candidate.fullName, mode: 'insensitive' } },
            // first + last (common reorderings handled by normalize)
            { AND: [
              { firstName: { equals: name.first, mode: 'insensitive' } },
              { lastName: { equals: name.last, mode: 'insensitive' } },
            ] },
          ],
        },
        take: 5,
      });
      if (hits.length > 0) return { match: hits[0]!, reason: 'name_company', confidence: 0.95 };
    }
  }

  // ── Stage 4: fuzzy match within the candidate's company ─────────────
  // Only scan within the same company domain (or close company-name match)
  // to keep this O(employees-per-company) instead of O(workspace).
  if (candidate.fullName && (candidate.companyDomain || candidate.companyName)) {
    const name = normalizePersonName(candidate.fullName);
    const companyKey = candidate.companyDomain
      ? { companyDomain: normalizeDomain(candidate.companyDomain) }
      : { companyName: candidate.companyName ?? undefined };

    const peers = await prisma.lead.findMany({
      where: { teamId, ...(companyKey as any) },
      take: 200,
    });

    let best: { lead: Lead; score: number } | null = null;
    for (const peer of peers) {
      if (!peer.fullName) continue;
      const peerName = normalizePersonName(peer.fullName);
      const nameScore = jaroWinkler(name.full, peerName.full);
      if (nameScore < FUZZY_NAME_THRESHOLD) continue;

      const candCompany = normalizeCompanyName(candidate.companyName ?? '');
      const peerCompany = normalizeCompanyName(peer.companyName ?? '');
      const companyScore = candCompany && peerCompany
        ? jaroWinkler(candCompany, peerCompany)
        : 1; // if either is missing, don't penalize

      const combined = nameScore * 0.7 + companyScore * 0.3;
      if (combined >= FUZZY_NAME_THRESHOLD * 0.7 + FUZZY_COMPANY_THRESHOLD * 0.3) {
        if (!best || combined > best.score) best = { lead: peer, score: combined };
      }
    }
    if (best) return { match: best.lead, reason: 'fuzzy', confidence: best.score };
  }

  return { match: null, reason: 'none', confidence: 0 };
}

/** Decide whether two company records refer to the same entity. Used during
 *  company-side deduplication when the orchestrator has firmographics for
 *  both candidates. */
export function companyMatches(
  a: { name?: string | null; domain?: string | null },
  b: { name?: string | null; domain?: string | null },
): boolean {
  // Same domain wins outright
  if (a.domain && b.domain && normalizeDomain(a.domain) === normalizeDomain(b.domain)) return true;
  if (!a.name || !b.name) return false;
  const na = normalizeCompanyName(a.name);
  const nb = normalizeCompanyName(b.name);
  if (!na || !nb) return false;
  return na === nb || jaroWinkler(na, nb) >= 0.92;
}
