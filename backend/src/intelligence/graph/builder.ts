// Knowledge-graph builder.
//
// Takes an enriched company payload + extracted lead and inserts/updates the
// canonical nodes in the Postgres knowledge graph:
//
//   Company ─[in_industry]─ Industry
//      │
//      ├─[uses_tech]─ Technology
//      ├─[raised]──── FundingEvent
//      ├─[exec_move]─ ExecutiveMove
//      └─[employs]─── Lead
//
// All upserts are idempotent — running this twice produces the same graph.

import { prisma } from '../../db/prisma.js';
import { logger } from '../../utils/logger.js';
import { normalizeDomain } from '../matching/fuzzy.js';
import type { CompanyFirmographics } from '../enrichment/company.js';
import type { IntentSignal } from '../intent/signals.js';

export interface GraphUpsertResult {
  companyId: string;
  industryId: string | null;
  technologiesAdded: number;
  fundingEventsAdded: number;
  executiveMovesAdded: number;
}

const INDUSTRY_KEYWORDS: Record<string, RegExp[]> = {
  'fintech':         [/fintech|payments?|banking|insurance|crypto|trading|wealth/i],
  'saas':            [/\bsaas\b|software as a service|cloud software|b2b platform/i],
  'ecommerce':       [/\be-?commerce|online retail|d2c|shopify|marketplace/i],
  'healthcare':      [/healthcare|medical|biotech|pharma|wellness|telehealth/i],
  'cybersecurity':   [/cyber|security|infosec|threat detection|zero trust/i],
  'developer-tools': [/developer tools?|devtools|api platform|ci\/?cd|observability/i],
  'analytics':       [/analytics|business intelligence|\bbi\b|data platform|warehouse/i],
  'marketing-tech':  [/marketing automation|martech|ad tech|crm|email marketing/i],
  'productivity':    [/productivity|collaboration|project management|workflow/i],
  'ai-ml':           [/\bai\b|machine learning|\bml\b|generative ai|llm|deep learning/i],
  'edtech':          [/edtech|education technology|online learning|courseware/i],
  'real-estate':     [/real estate|proptech|property management|housing/i],
  'logistics':       [/logistics|supply chain|shipping|fleet|delivery/i],
  'media':           [/media|publishing|broadcasting|content platform/i],
  'gaming':          [/gaming|video game|esports|game development/i],
  'energy':          [/clean energy|solar|wind|battery|cleantech|grid/i],
  'travel':          [/travel|hospitality|booking|tourism|airline/i],
};

const TECH_CATEGORY: Record<string, string> = {
  'React': 'frontend', 'Next.js': 'frontend', 'Vue': 'frontend', 'Nuxt': 'frontend',
  'Angular': 'frontend', 'Svelte': 'frontend', 'Tailwind CSS': 'frontend', 'Bootstrap': 'frontend',
  'jQuery': 'frontend',
  'Stripe': 'payments', 'Shopify': 'ecommerce', 'WordPress': 'cms', 'Webflow': 'cms',
  'HubSpot': 'crm', 'Salesforce': 'crm', 'Cloudflare': 'infra', 'Vercel': 'infra', 'Nginx': 'infra',
  'Google Analytics': 'analytics', 'Segment': 'analytics', 'Mixpanel': 'analytics',
  'Amplitude': 'analytics', 'Posthog': 'analytics', 'Plausible': 'analytics',
  'Intercom': 'support', 'Drift': 'support', 'Zendesk': 'support',
  'Algolia': 'search', 'Sentry': 'observability',
};

export async function upsertCompanyNode(
  firmographics: CompanyFirmographics,
  intentSignals: IntentSignal[] = [],
): Promise<GraphUpsertResult> {
  const domain = normalizeDomain(firmographics.domain);
  if (!domain) throw new Error('cannot upsert company without a domain');

  // ── 1. Industry ─────────────────────────────────────────────────────────
  let industryId: string | null = null;
  const industryName = firmographics.industry ?? inferIndustryFromText(
    [firmographics.name, firmographics.description, firmographics.domain].filter(Boolean).join(' ')
  );
  if (industryName) {
    const slug = slugify(industryName);
    const industry = await prisma.industry.upsert({
      where: { slug },
      create: { slug, name: industryName },
      update: {},
    });
    industryId = industry.id;
  }

  // ── 2. Company ──────────────────────────────────────────────────────────
  const company = await prisma.company.upsert({
    where: { domain },
    create: {
      domain,
      name: firmographics.name ?? domain,
      description: firmographics.description,
      industryId,
      employeeCount: firmographics.employeeCount,
      employeeRange: firmographics.employeeRange,
      foundedYear: firmographics.foundedYear,
      hqCity: firmographics.headquartersCity,
      hqCountry: firmographics.headquartersCountry,
      linkedinUrl: firmographics.linkedinUrl,
      twitterUrl: firmographics.twitterUrl,
      githubUrl: firmographics.githubUrl,
      crunchbaseUrl: firmographics.crunchbaseUrl,
      totalFundingUsd: firmographics.totalFundingUSD ? BigInt(firmographics.totalFundingUSD) : null,
      lastFundingRound: firmographics.lastFundingRound,
      hasSpf: firmographics.hasSpf,
      hasDmarc: firmographics.hasDmarc,
      enrichedAt: new Date(),
      enrichmentSources: firmographics.sources,
    },
    update: {
      // Don't overwrite existing non-null values — merge-only
      name:           firmographics.name ?? undefined,
      description:    firmographics.description ?? undefined,
      industryId:     industryId ?? undefined,
      employeeCount:  firmographics.employeeCount ?? undefined,
      employeeRange:  firmographics.employeeRange ?? undefined,
      foundedYear:    firmographics.foundedYear ?? undefined,
      hqCity:         firmographics.headquartersCity ?? undefined,
      hqCountry:      firmographics.headquartersCountry ?? undefined,
      linkedinUrl:    firmographics.linkedinUrl ?? undefined,
      twitterUrl:     firmographics.twitterUrl ?? undefined,
      githubUrl:      firmographics.githubUrl ?? undefined,
      crunchbaseUrl:  firmographics.crunchbaseUrl ?? undefined,
      totalFundingUsd: firmographics.totalFundingUSD ? BigInt(firmographics.totalFundingUSD) : undefined,
      hasSpf:         firmographics.hasSpf,
      hasDmarc:       firmographics.hasDmarc,
      enrichedAt:     new Date(),
      enrichmentSources: firmographics.sources,
    },
  });

  // ── 3. Technologies (join table) ────────────────────────────────────────
  let technologiesAdded = 0;
  for (const techName of firmographics.technologies ?? []) {
    const slug = slugify(techName);
    const tech = await prisma.technology.upsert({
      where: { slug },
      create: { slug, name: techName, category: TECH_CATEGORY[techName] ?? null },
      update: { category: TECH_CATEGORY[techName] ?? undefined },
    });
    try {
      await prisma.companyTechnology.create({
        data: { companyId: company.id, technologyId: tech.id, confidence: 0.85 },
      });
      technologiesAdded++;
    } catch {
      // unique constraint — already linked, fine
    }
  }

  // ── 4. Funding + Executive intent signals ──────────────────────────────
  let fundingEventsAdded = 0;
  let executiveMovesAdded = 0;
  for (const signal of intentSignals) {
    if (signal.kind === 'FUNDING') {
      const round = inferFundingRound(signal.headline);
      try {
        await prisma.fundingEvent.create({
          data: {
            companyId: company.id,
            round,
            announcedOn: signal.detectedAt,
            sourceUrl: signal.url,
          },
        });
        fundingEventsAdded++;
      } catch (err) { logger.debug({ err: (err as Error).message }, 'funding event insert failed'); }
    } else if (signal.kind === 'EXEC_CHANGE') {
      const inferred = inferExecMove(signal.headline);
      if (inferred) {
        try {
          await prisma.executiveMove.create({
            data: {
              companyId: company.id,
              personName: inferred.personName,
              newTitle: inferred.title,
              changeType: 'APPOINTED',
              announcedOn: signal.detectedAt,
              sourceUrl: signal.url,
            },
          });
          executiveMovesAdded++;
        } catch (err) { logger.debug({ err: (err as Error).message }, 'exec move insert failed'); }
      }
    }
  }

  return {
    companyId: company.id,
    industryId,
    technologiesAdded,
    fundingEventsAdded,
    executiveMovesAdded,
  };
}

/** Link a Lead row into the graph by setting Lead.companyId. */
export async function linkLeadToCompany(leadId: string, companyId: string): Promise<void> {
  await prisma.lead.update({ where: { id: leadId }, data: { companyId } });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function slugify(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

function inferIndustryFromText(text: string): string | null {
  if (!text) return null;
  for (const [name, patterns] of Object.entries(INDUSTRY_KEYWORDS)) {
    if (patterns.some((p) => p.test(text))) return name;
  }
  return null;
}

function inferFundingRound(headline: string): 'PRE_SEED' | 'SEED' | 'SERIES_A' | 'SERIES_B' | 'SERIES_C' | 'SERIES_D' | 'SERIES_E_PLUS' | 'GROWTH' | 'DEBT' | 'IPO' | 'ACQUISITION' | 'SECONDARY' {
  const h = headline.toLowerCase();
  if (/\bipo\b|public offering/.test(h)) return 'IPO';
  if (/acquired by|acquisition/.test(h)) return 'ACQUISITION';
  if (/secondary tender|secondary offering/.test(h)) return 'SECONDARY';
  if (/series e|series f|series g|mega/.test(h)) return 'SERIES_E_PLUS';
  if (/series d/.test(h)) return 'SERIES_D';
  if (/series c/.test(h)) return 'SERIES_C';
  if (/series b/.test(h)) return 'SERIES_B';
  if (/series a/.test(h)) return 'SERIES_A';
  if (/\bseed\b/.test(h)) return 'SEED';
  if (/pre[- ]?seed/.test(h)) return 'PRE_SEED';
  if (/debt|credit facility/.test(h)) return 'DEBT';
  return 'GROWTH';
}

function inferExecMove(headline: string): { personName: string; title: string } | null {
  // "Acme appointed Jane Doe as CTO" — yields person="Jane Doe", title="CTO"
  const m = headline.match(/(appointed|named|hired|joined as)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s+(?:as\s+)?(?:its\s+)?(?:new\s+)?(CEO|CTO|CFO|COO|CMO|CPO|CRO|CISO|VP|President|Chief\s+\w+)/i);
  if (m) return { personName: m[2]!.trim(), title: m[3]!.toUpperCase() };
  const m2 = headline.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s+(?:joins|appointed)\s+(?:as\s+)?(CEO|CTO|CFO|COO|CMO|CPO|CRO|VP|President)/i);
  if (m2) return { personName: m2[1]!.trim(), title: m2[2]!.toUpperCase() };
  return null;
}
