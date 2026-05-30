// Company enrichment — given a domain or company name, gather firmographics
// from every free public source we can use without paying for API access.
//
// Sources (in order of authority):
//   1. The company's own website (about page, contact page) — most reliable
//      source of name, industry, location, sometimes employee count
//   2. Tech-stack fingerprinting from the homepage (BuiltWith-style heuristics)
//   3. GitHub organization data for companies with an obvious org/repo presence
//   4. Crunchbase public profile scrape (funding, employee count, founded year)
//   5. WHOIS / domain metadata (domain age — newer domains carry risk)
//   6. SEC EDGAR for US public companies (10-K firmographic data)
//
// Each source is BEST-EFFORT — we never fail enrichment because one source
// times out or returns 404. Whatever signals we collect get merged into the
// returned object with provenance.

import axios from 'axios';
import * as cheerio from 'cheerio';
import { promises as dns } from 'node:dns';
import { logger } from '../../utils/logger.js';
import { normalizeDomain } from '../matching/fuzzy.js';

export interface CompanyFirmographics {
  domain: string;
  name?: string;
  description?: string;
  industry?: string;
  employeeCount?: number;
  employeeRange?: string;             // "11-50", "201-500", etc.
  foundedYear?: number;
  headquartersCountry?: string;
  headquartersCity?: string;
  linkedinUrl?: string;
  twitterUrl?: string;
  githubUrl?: string;
  crunchbaseUrl?: string;
  technologies: string[];
  totalFundingUSD?: number;
  lastFundingRound?: string;
  lastFundingDate?: string;
  hasSpf: boolean;
  hasDmarc: boolean;
  /** Best-effort age — number of years since domain registration */
  domainAgeYears?: number;
  /** Provenance — which sources contributed which fields */
  sources: Array<'website' | 'github' | 'crunchbase' | 'dns' | 'sec' | 'whois'>;
}

const UA = 'Mozilla/5.0 (compatible; LeadForgeIntel/1.0; +https://leadforge.ai/bot)';

export async function enrichCompany(input: string): Promise<CompanyFirmographics> {
  const domain = normalizeDomain(input);
  const out: CompanyFirmographics = {
    domain,
    technologies: [],
    hasSpf: false,
    hasDmarc: false,
    sources: [],
  };

  // Kick off all sources in parallel — they share nothing
  const [
    websiteData,
    githubData,
    crunchbaseData,
    dnsData,
  ] = await Promise.allSettled([
    enrichFromWebsite(domain),
    enrichFromGithub(domain),
    enrichFromCrunchbase(domain),
    enrichFromDns(domain),
  ]);

  // Merge — later sources don't overwrite earlier ones if both have a value.
  merge(out, settled(websiteData), 'website');
  merge(out, settled(githubData), 'github');
  merge(out, settled(crunchbaseData), 'crunchbase');
  merge(out, settled(dnsData), 'dns');

  return out;
}

// ─── Source: company's own website ─────────────────────────────────────────

async function enrichFromWebsite(domain: string): Promise<Partial<CompanyFirmographics>> {
  try {
    const res = await axios.get(`https://${domain}`, {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      timeout: 10_000,
      validateStatus: (s) => s < 500,
      maxRedirects: 3,
    });
    if (res.status >= 400) return {};
    const $ = cheerio.load(res.data);

    const name = $('meta[property="og:site_name"]').attr('content')
              ?? $('meta[name="application-name"]').attr('content')
              ?? $('title').first().text().trim();

    const description = $('meta[property="og:description"]').attr('content')
                     ?? $('meta[name="description"]').attr('content');

    // Social links — common in footers
    const linkedinUrl = findSocial($, 'linkedin.com');
    const twitterUrl  = findSocial($, 'twitter.com') ?? findSocial($, 'x.com');
    const githubUrl   = findSocial($, 'github.com');

    // Tech fingerprinting — cheap signature check against known JS/HTML markers
    const html = String(res.data);
    const technologies = detectTechStack(html, res.headers);

    return {
      name: cleanText(name),
      description: cleanText(description),
      linkedinUrl, twitterUrl, githubUrl,
      technologies,
    };
  } catch (err) {
    logger.debug({ domain, err: (err as Error).message }, 'website enrichment failed');
    return {};
  }
}

function findSocial($: cheerio.CheerioAPI, hostFragment: string): string | undefined {
  const hit = $(`a[href*="${hostFragment}"]`).attr('href');
  if (!hit) return undefined;
  try { return new URL(hit).toString(); } catch { return undefined; }
}

function cleanText(s: string | undefined): string | undefined {
  if (!s) return undefined;
  return s.replace(/\s+/g, ' ').trim().slice(0, 500);
}

const TECH_SIGNATURES: Array<[string, RegExp]> = [
  ['React',          /react[-.]\w+|__REACT_|reactdom/i],
  ['Next.js',        /\b__NEXT_DATA__|_next\/static/i],
  ['Vue',            /vue[-.]\w+|__vue_app__/i],
  ['Nuxt',           /\bnuxt\b|_nuxt\//i],
  ['Angular',        /\bng-version|@angular\b/i],
  ['Svelte',         /sveltejs|__svelte/i],
  ['Stripe',         /js\.stripe\.com|stripe\.com\/v\d/i],
  ['Shopify',        /cdn\.shopify\.com|Shopify\.theme/i],
  ['WordPress',      /wp-content|wp-includes/i],
  ['Webflow',        /webflow\.com|w-condition/i],
  ['HubSpot',        /hs-scripts|hsforms\.net/i],
  ['Salesforce',     /\bsalesforce\.com|sforce/i],
  ['Cloudflare',     /cf-ray|__cf_bm/i],
  ['Google Analytics', /google-analytics\.com|gtag\.js|googletagmanager/i],
  ['Segment',        /cdn\.segment\.com/i],
  ['Mixpanel',       /\bmixpanel\b/i],
  ['Amplitude',      /\bamplitude\b/i],
  ['Intercom',       /widget\.intercom\.io/i],
  ['Drift',          /js\.driftt\.com/i],
  ['Zendesk',        /zopim\.com|zendesk\.com/i],
  ['Tailwind CSS',   /\btailwindcss\b|class="[^"]*\bbg-[a-z]+-\d{2,3}/i],
  ['Bootstrap',      /bootstrap\.min\.(?:css|js)/i],
  ['jQuery',         /jquery[-.]\w+\.js/i],
  ['Algolia',        /\balgolia\b/i],
  ['Sentry',         /\bsentry\b/i],
  ['Plausible',      /plausible\.io\/js/i],
  ['Posthog',        /posthog-js|app\.posthog\.com/i],
];

function detectTechStack(html: string, headers: Record<string, any>): string[] {
  const found = new Set<string>();
  for (const [name, pattern] of TECH_SIGNATURES) {
    if (pattern.test(html)) found.add(name);
  }
  // Server / framework hints from response headers
  const server = String(headers['server'] ?? '').toLowerCase();
  if (server.includes('vercel')) found.add('Vercel');
  if (server.includes('cloudflare')) found.add('Cloudflare');
  if (server.includes('nginx')) found.add('Nginx');
  if (headers['x-powered-by']) found.add(String(headers['x-powered-by']));
  return [...found];
}

// ─── Source: GitHub organization ───────────────────────────────────────────

async function enrichFromGithub(domain: string): Promise<Partial<CompanyFirmographics>> {
  // Take the bare domain stem ("stripe.com" → "stripe") as the likely org slug
  const slug = domain.split('.').slice(0, -1).join('-').toLowerCase();
  if (!slug) return {};
  try {
    const res = await axios.get(`https://api.github.com/orgs/${slug}`, {
      headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json' },
      timeout: 8_000,
      validateStatus: (s) => s < 500,
    });
    if (res.status !== 200) return {};
    const d = res.data ?? {};
    // Verify the org's blog URL roughly matches our domain — otherwise we
    // might've matched a random org with the same slug.
    if (d.blog && !String(d.blog).toLowerCase().includes(domain)) return {};
    return {
      name: d.name ?? undefined,
      description: cleanText(d.description),
      headquartersCity: d.location ?? undefined,
      githubUrl: d.html_url ?? `https://github.com/${slug}`,
      twitterUrl: d.twitter_username ? `https://twitter.com/${d.twitter_username}` : undefined,
    };
  } catch {
    return {};
  }
}

// ─── Source: Crunchbase public profile (heuristic scrape) ────────────────

async function enrichFromCrunchbase(domain: string): Promise<Partial<CompanyFirmographics>> {
  // Crunchbase profiles are at /organization/<slug>; the slug usually matches
  // the domain stem. This is best-effort and may often fail; that's fine.
  const slug = domain.split('.').slice(0, -1).join('-').toLowerCase();
  if (!slug) return {};
  try {
    const res = await axios.get(`https://www.crunchbase.com/organization/${slug}`, {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      timeout: 10_000,
      validateStatus: (s) => s < 500,
      maxRedirects: 2,
    });
    if (res.status !== 200) return {};
    const $ = cheerio.load(res.data);
    // CB often inlines a JSON-LD blob with structured firmographics
    const ld = $('script[type="application/ld+json"]').text();
    let parsed: any = null;
    try { parsed = JSON.parse(ld); } catch {}
    if (!parsed || typeof parsed !== 'object') return { crunchbaseUrl: res.config.url };
    return {
      name: parsed.name,
      description: cleanText(parsed.description),
      foundedYear: parseFoundedYear(parsed.foundingDate),
      headquartersCity: parsed.address?.addressLocality,
      headquartersCountry: parsed.address?.addressCountry,
      crunchbaseUrl: res.config.url,
    };
  } catch {
    return {};
  }
}

function parseFoundedYear(input: any): number | undefined {
  if (typeof input !== 'string') return undefined;
  const m = input.match(/(\d{4})/);
  return m ? parseInt(m[1]!, 10) : undefined;
}

// ─── Source: DNS metadata (SPF, DMARC, MX) ──────────────────────────────

async function enrichFromDns(domain: string): Promise<Partial<CompanyFirmographics>> {
  const [spf, dmarc] = await Promise.all([
    safeTxt(domain),
    safeTxt(`_dmarc.${domain}`),
  ]);
  const hasSpf = spf.some((r) => /v=spf1/i.test(r));
  const hasDmarc = dmarc.some((r) => /v=DMARC1/i.test(r));
  return { hasSpf, hasDmarc };
}

async function safeTxt(host: string): Promise<string[]> {
  try {
    const records = await dns.resolveTxt(host);
    return records.map((parts) => parts.join(''));
  } catch {
    return [];
  }
}

// ─── Merge helpers ─────────────────────────────────────────────────────────

function settled<T>(s: PromiseSettledResult<T>): Partial<T> {
  return s.status === 'fulfilled' ? (s.value as Partial<T>) : ({} as Partial<T>);
}

function merge(
  target: CompanyFirmographics,
  source: Partial<CompanyFirmographics>,
  sourceName: CompanyFirmographics['sources'][number],
): void {
  let contributed = false;
  for (const key of Object.keys(source) as (keyof CompanyFirmographics)[]) {
    if (key === 'sources') continue;
    const v = (source as any)[key];
    if (v == null || v === '') continue;
    if (Array.isArray(v)) {
      const existing = (target[key] as any) ?? [];
      const merged = [...new Set([...existing, ...v])];
      if (merged.length !== existing.length) contributed = true;
      (target[key] as any) = merged;
    } else if ((target[key] as any) == null) {
      (target[key] as any) = v;
      contributed = true;
    }
  }
  if (contributed) target.sources.push(sourceName);
}
