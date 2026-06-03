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
import { logger } from '../../utils/logger.js';

// Read directly from process.env so CLI-passed vars work alongside dotenv
const getKey = (name: string) => process.env[name] ?? '';

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
  const key = getKey('HUNTER_API_KEY');
  if (!key) return null;

  try {
    // Free plan: one request, 10 results max. Paid plans can increase limit.
    const { data } = await axios.get('https://api.hunter.io/v2/domain-search', {
      params: { domain, api_key: key, limit: 10, offset: 0 },
      timeout: 15000,
    });

    const d = data.data ?? {};
    const pattern = d.pattern as string | undefined;
    const organization = d.organization as string | undefined;
    const allEmails: any[] = d.emails ?? [];

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
  const key = getKey("APOLLO_API_KEY");
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
            'Authorization': `Bearer ${key}`,   // header-based auth (URL params deprecated)
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
  const key = getKey("PDL_API_KEY");
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

// ─── GitHub Org Scan ─────────────────────────────────────────────────────────

export async function searchGitHubOrg(domain: string, companyName: string): Promise<EnrichedEmployee[]> {
  const token = process.env.GITHUB_TOKEN ?? '';
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'LeadForge-OSINT/1.0',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
  };

  const employees: EnrichedEmployee[] = [];
  const seen = new Set<string>();

  const addEmployee = (firstName: string, lastName: string, email: string | undefined, source: string) => {
    if (!firstName || !lastName) return;
    const k = `${firstName.toLowerCase()}+${lastName.toLowerCase()}`;
    if (seen.has(k)) return;
    seen.add(k);
    employees.push({ firstName, lastName, fullName: `${firstName} ${lastName}`, email, source });
  };

  // Step 1: Find the GitHub org for this company
  let orgLogin: string | null = null;
  try {
    const { data } = await axios.get('https://api.github.com/search/users', {
      params: { q: `${companyName} type:org`, per_page: 5 },
      headers,
      timeout: 10000,
    });
    // Pick the best match: prefer exact name or one that contains the company keyword
    const items: any[] = data.items ?? [];
    const match = items.find((i: any) =>
      i.login?.toLowerCase().includes(companyName.toLowerCase().replace(/\s+/g, '')) ||
      i.login?.toLowerCase().includes(companyName.toLowerCase().split(' ')[0]!)
    ) ?? items[0];
    orgLogin = match?.login ?? null;
  } catch { /* ignore */ }

  if (orgLogin) {
    logger.info({ domain, org: orgLogin }, 'github org: found org');

    // Step 2: List org members
    try {
      const { data } = await axios.get(`https://api.github.com/orgs/${orgLogin}/members`, {
        params: { per_page: 100 },
        headers,
        timeout: 15000,
      });
      const members: any[] = data ?? [];

      // Step 3: Fetch each member's public profile for email
      await Promise.allSettled(members.slice(0, 50).map(async (member: any) => {
        try {
          const { data: user } = await axios.get(`https://api.github.com/users/${member.login}`, {
            headers,
            timeout: 8000,
          });
          const email: string | undefined = user.email && user.email.endsWith('@' + domain)
            ? user.email
            : undefined;
          const name: string = user.name ?? member.login ?? '';
          const parts = name.trim().split(/\s+/);
          if (parts.length >= 2) {
            addEmployee(parts[0]!, parts[parts.length - 1]!, email, `github-org:${orgLogin}`);
          }
        } catch { /* ignore individual fetch failures */ }
      }));
    } catch { /* ignore */ }
  }

  // Step 4: Search commits for emails matching the domain
  try {
    const { data } = await axios.get('https://api.github.com/search/commits', {
      params: { q: `author-email:${domain}`, per_page: 50 },
      headers: { ...headers, 'Accept': 'application/vnd.github.cloak-preview+json' },
      timeout: 15000,
    });
    for (const c of data.items ?? []) {
      const email: string = c.commit?.author?.email ?? '';
      if (!email.endsWith('@' + domain)) continue;
      const name: string = c.commit?.author?.name ?? '';
      const parts = name.trim().split(/\s+/);
      if (parts.length >= 2) {
        addEmployee(parts[0]!, parts[parts.length - 1]!, email, `github-commit:${orgLogin ?? 'public'}`);
      }
    }
  } catch { /* ignore */ }

  logger.info({ domain, employees: employees.length }, 'github org scan complete');
  return employees;
}

// ─── Main enrichment entry point ─────────────────────────────────────────────

export async function enrichDomain(domain: string, companyName?: string): Promise<DomainEnrichmentResult> {
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

  // 4. GitHub org scan — public member emails + commit emails
  if (companyName) {
    try {
      const ghEmps = await searchGitHubOrg(domain, companyName);
      if (ghEmps.length > 0) {
        result.sources.push('github-org');
        merge(ghEmps);
        // Collect any confirmed work emails from GitHub profiles
        for (const e of ghEmps) {
          if (e.email?.endsWith('@' + domain)) result.emails.push(e.email);
        }
      }
    } catch (e: any) {
      logger.warn({ domain, err: e.message }, 'github org scan failed — skipping');
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
