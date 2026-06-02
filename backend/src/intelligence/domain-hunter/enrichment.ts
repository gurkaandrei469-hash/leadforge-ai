/**
 * Free-tier enrichment APIs for domain hunter.
 *
 * Priority chain:
 *  1. Hunter.io  — domain search → returns real emails + pattern (25 searches/mo free)
 *  2. Apollo.io  — people search by domain → employee names + titles (free unlimited)
 *  3. PDL        — person search by company → detailed profiles (1000 calls/mo free)
 *
 * Set API keys via env:
 *   HUNTER_API_KEY, APOLLO_API_KEY, PDL_API_KEY
 */
import axios from 'axios';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

export interface EnrichedEmployee {
  firstName: string;
  lastName: string;
  fullName: string;
  email?: string;        // confirmed email if available
  title?: string;
  linkedin?: string;
  source: string;
}

export interface DomainEnrichmentResult {
  emails: string[];       // confirmed emails found
  employees: EnrichedEmployee[];
  pattern?: string;       // e.g. "{first}.{last}" from Hunter
  organization?: string;
  sources: string[];
}

// ─── Hunter.io ───────────────────────────────────────────────────────────────

async function hunterDomainSearch(domain: string): Promise<DomainEnrichmentResult | null> {
  const key = (env as any).HUNTER_API_KEY;
  if (!key) return null;

  try {
    let allEmails: any[] = [];
    let pattern: string | undefined;
    let organization: string | undefined;
    let offset = 0;
    const limit = 100;

    // Paginate through all results
    while (true) {
      const { data } = await axios.get('https://api.hunter.io/v2/domain-search', {
        params: { domain, api_key: key, limit, offset },
        timeout: 15000,
      });

      const d = data.data;
      if (!pattern) pattern = d.pattern;
      if (!organization) organization = d.organization;
      allEmails = allEmails.concat(d.emails ?? []);

      if ((d.emails?.length ?? 0) < limit) break;
      offset += limit;
      await new Promise(r => setTimeout(r, 200));
    }

    const employees: EnrichedEmployee[] = allEmails
      .filter(e => e.first_name && e.last_name)
      .map(e => ({
        firstName: e.first_name,
        lastName: e.last_name,
        fullName: `${e.first_name} ${e.last_name}`,
        email: e.value,
        title: e.position,
        linkedin: e.linkedin,
        source: 'hunter.io',
      }));

    const emails = allEmails.map(e => e.value).filter(Boolean);
    logger.info({ domain, emails: emails.length, employees: employees.length, pattern }, 'hunter.io enrichment');

    return { emails, employees, pattern, organization, sources: ['hunter.io'] };
  } catch (e: any) {
    logger.warn({ domain, err: e.message }, 'hunter.io failed');
    return null;
  }
}

// ─── Apollo.io ───────────────────────────────────────────────────────────────

async function apolloPeopleSearch(domain: string): Promise<EnrichedEmployee[]> {
  const key = (env as any).APOLLO_API_KEY;
  if (!key) return [];

  const employees: EnrichedEmployee[] = [];
  const seen = new Set<string>();

  try {
    let page = 1;
    const perPage = 100;

    while (employees.length < 500) {
      const { data } = await axios.post(
        'https://api.apollo.io/v1/mixed_people/search',
        {
          organization_domains: [domain],
          page,
          per_page: perPage,
        },
        {
          headers: {
            'X-Api-Key': key,
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache',
          },
          timeout: 15000,
        }
      );

      const people: any[] = data.people ?? [];
      if (people.length === 0) break;

      for (const p of people) {
        const key_ = `${p.first_name?.toLowerCase()}+${p.last_name?.toLowerCase()}`;
        if (!p.first_name || !p.last_name || seen.has(key_)) continue;
        seen.add(key_);

        employees.push({
          firstName: p.first_name,
          lastName: p.last_name,
          fullName: `${p.first_name} ${p.last_name}`,
          email: p.email ?? undefined,       // may be masked as "****@domain" on free tier
          title: p.title ?? p.headline,
          linkedin: p.linkedin_url,
          source: 'apollo.io',
        });
      }

      if (people.length < perPage) break;
      page++;
      await new Promise(r => setTimeout(r, 300));
    }

    logger.info({ domain, employees: employees.length }, 'apollo.io enrichment');
  } catch (e: any) {
    logger.warn({ domain, err: e.message }, 'apollo.io failed');
  }

  return employees;
}

// ─── PDL (People Data Labs) ──────────────────────────────────────────────────

async function pdlCompanySearch(domain: string): Promise<EnrichedEmployee[]> {
  const key = (env as any).PDL_API_KEY;
  if (!key) return [];

  const employees: EnrichedEmployee[] = [];
  const seen = new Set<string>();

  try {
    let from = 0;
    const size = 100;

    while (employees.length < 300) {
      const { data } = await axios.get('https://api.peopledatalabs.com/v5/person/search', {
        params: {
          query: JSON.stringify({ query: { term: { 'job_company_website': domain } } }),
          size,
          from,
          api_key: key,
        },
        timeout: 15000,
      });

      const records: any[] = data.data ?? [];
      if (records.length === 0) break;

      for (const r of records) {
        const firstName = r.first_name;
        const lastName = r.last_name;
        if (!firstName || !lastName) continue;
        const key_ = `${firstName.toLowerCase()}+${lastName.toLowerCase()}`;
        if (seen.has(key_)) continue;
        seen.add(key_);

        const workEmail = r.work_email ?? r.emails?.find((e: any) => e.address?.endsWith('@' + domain))?.address;

        employees.push({
          firstName,
          lastName,
          fullName: r.full_name ?? `${firstName} ${lastName}`,
          email: workEmail,
          title: r.job_title,
          linkedin: r.linkedin_url,
          source: 'peopledatalabs.com',
        });
      }

      if (records.length < size) break;
      from += size;
      await new Promise(r => setTimeout(r, 300));
    }

    logger.info({ domain, employees: employees.length }, 'pdl enrichment');
  } catch (e: any) {
    logger.warn({ domain, err: e.message }, 'pdl failed');
  }

  return employees;
}

// ─── Main enrichment entry point ─────────────────────────────────────────────

export async function enrichDomain(domain: string): Promise<DomainEnrichmentResult> {
  const result: DomainEnrichmentResult = {
    emails: [],
    employees: [],
    sources: [],
  };

  const seen = new Map<string, EnrichedEmployee>(); // first+last → employee

  const merge = (emps: EnrichedEmployee[]) => {
    for (const e of emps) {
      const k = `${e.firstName.toLowerCase()}+${e.lastName.toLowerCase()}`;
      if (!seen.has(k)) seen.set(k, e);
      else if (e.email && !seen.get(k)!.email) {
        // Update with email if we now have one
        seen.set(k, { ...seen.get(k)!, email: e.email });
      }
    }
  };

  // 1. Hunter.io — best source (has pattern + verified emails)
  const hunter = await hunterDomainSearch(domain);
  if (hunter) {
    result.emails.push(...hunter.emails);
    result.pattern = hunter.pattern;
    result.organization = hunter.organization;
    result.sources.push('hunter.io');
    merge(hunter.employees);
  }

  // 2. Apollo.io — large employee database
  const apolloEmps = await apolloPeopleSearch(domain);
  if (apolloEmps.length > 0) {
    result.sources.push('apollo.io');
    merge(apolloEmps);
  }

  // 3. PDL — fallback
  const pdlEmps = await pdlCompanySearch(domain);
  if (pdlEmps.length > 0) {
    result.sources.push('peopledatalabs.com');
    merge(pdlEmps);

    // PDL often has work emails — add them to our known emails list
    for (const e of pdlEmps) {
      if (e.email?.endsWith('@' + domain)) result.emails.push(e.email);
    }
  }

  result.employees = Array.from(seen.values());
  result.emails = [...new Set(result.emails)];

  logger.info({
    domain,
    emails: result.emails.length,
    employees: result.employees.length,
    sources: result.sources,
    pattern: result.pattern,
  }, 'domain enrichment complete');

  return result;
}
