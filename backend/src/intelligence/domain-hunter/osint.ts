/**
 * OSINT email discovery — finds company emails via open-source intelligence:
 *
 *  1. GitHub code/commit search — @domain.com in public repos
 *  2. Google dorks — PDFs, spreadsheets, cached pages with the domain
 *  3. Industry conference / event pages (SCTE, NCTA, NCTC etc.)
 *  4. LinkedIn deep search via Serper
 *  5. Job postings (HR/recruiter contact emails)
 *  6. Certificate Transparency logs (crt.sh)
 *  7. Pastebin / public data dumps
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import { ddgSearch } from '../../scraping/searchEngines.js';
import { logger } from '../../utils/logger.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36';
const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

export interface OsintResult {
  emails: Map<string, { source: string; name?: string; context?: string }>;
  totalSources: number;
}

async function fetchText(url: string, timeout = 12000): Promise<string> {
  try {
    const { data } = await axios.get(url, {
      timeout,
      headers: { 'User-Agent': UA },
      maxRedirects: 3,
      validateStatus: s => s < 400,
    });
    return typeof data === 'string' ? data : JSON.stringify(data);
  } catch { return ''; }
}

function extractDomainEmails(text: string, domain: string): string[] {
  const matches = text.match(EMAIL_RE) ?? [];
  return [...new Set(
    matches
      .map(e => e.toLowerCase().trim())
      .filter(e => e.endsWith('@' + domain) || e.endsWith('.' + domain))
  )];
}

// ─── 1. GitHub ───────────────────────────────────────────────────────────────

async function searchGitHub(domain: string): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const token = process.env.GITHUB_TOKEN ?? '';
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'LeadForge-OSINT/1.0',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
  };

  const queries = [
    `"@${domain}" in:file`,
    `"${domain}" author-email:${domain.replace('.', '\\.')}`,
  ];

  for (const q of queries) {
    try {
      const { data } = await axios.get('https://api.github.com/search/code', {
        params: { q, per_page: 30 },
        headers,
        timeout: 15000,
      });

      for (const item of data.items ?? []) {
        // Fetch raw file content to extract emails
        const raw = item.html_url?.replace('github.com', 'raw.githubusercontent.com')
          .replace('/blob/', '/') ?? '';
        if (!raw) continue;
        const content = await fetchText(raw, 8000);
        for (const email of extractDomainEmails(content, domain)) {
          found.set(email, `github:${item.repository?.full_name ?? 'unknown'}`);
        }
        await new Promise(r => setTimeout(r, 200));
      }
    } catch { /* rate limit or no token */ }
  }

  // Also search commit emails via GitHub search API
  try {
    const { data } = await axios.get('https://api.github.com/search/commits', {
      params: { q: `author-email:${domain}`, per_page: 30 },
      headers: { ...headers, 'Accept': 'application/vnd.github.cloak-preview+json' },
      timeout: 15000,
    });
    for (const c of data.items ?? []) {
      const email = c.commit?.author?.email ?? '';
      if (extractDomainEmails(email, domain).length > 0) {
        const name = c.commit?.author?.name;
        found.set(email.toLowerCase(), `github-commit:${name ?? 'unknown'}`);
      }
    }
  } catch { /* ignore */ }

  return found;
}

// ─── 2. Google Dorks ─────────────────────────────────────────────────────────

async function googleDorks(domain: string): Promise<Map<string, string>> {
  const found = new Map<string, string>();

  const dorks = [
    `"@${domain}" filetype:pdf`,
    `"@${domain}" filetype:xlsx OR filetype:csv`,
    `"@${domain}" contact OR team OR staff OR speaker`,
    `"${domain}" "@" email staff directory`,
    `"${domain}" employee email linkedin`,
    `"@${domain}" resume OR cv OR bio`,
    `"${domain}" press contact OR spokesperson`,
    `"@${domain}" site:slideshare.net OR site:scribd.com`,
  ];

  for (const dork of dorks) {
    try {
      const results = await ddgSearch(dork, 10);
      for (const r of results) {
        // Extract emails from snippet
        for (const email of extractDomainEmails(r.snippet ?? '', domain)) {
          found.set(email, `google-dork:${r.url}`);
        }
        for (const email of extractDomainEmails(r.title ?? '', domain)) {
          found.set(email, `google-dork:${r.url}`);
        }

        // Fetch the page if snippet had something promising
        if (r.url && !r.url.includes('linkedin.com') && !r.url.includes('facebook.com')) {
          const html = await fetchText(r.url, 8000);
          for (const email of extractDomainEmails(html, domain)) {
            found.set(email, `page:${r.url}`);
          }
        }
      }
      await new Promise(r => setTimeout(r, 400));
    } catch { /* non-fatal */ }
  }

  return found;
}

// ─── 3. Industry conferences / event pages ────────────────────────────────────

async function industryConferences(domain: string, companyName: string): Promise<Map<string, string>> {
  const found = new Map<string, string>();

  // ISP/cable industry conference sites known to list speakers + emails
  const conferenceSites = [
    `site:scte.org "${companyName}"`,
    `site:ncta.com "${companyName}"`,
    `site:nctc.org "${companyName}"`,
    `site:cablelabs.com "${companyName}"`,
    `site:americascableshows.com "${companyName}"`,
    `"${companyName}" cable OR broadband conference speaker`,
    `"${companyName}" SCTE OR NCTA OR NCTC speaker presenter`,
    `"${companyName}" ieee broadband conference`,
    `"${companyName}" employee speaker webinar panelist`,
  ];

  for (const query of conferenceSites) {
    try {
      const results = await ddgSearch(query, 10);
      for (const r of results) {
        const html = await fetchText(r.url, 8000);
        for (const email of extractDomainEmails(html, domain)) {
          found.set(email, `conference:${r.url}`);
        }
        // Also extract emails from snippet
        for (const email of extractDomainEmails((r.snippet ?? '') + (r.title ?? ''), domain)) {
          found.set(email, `conference-snippet:${r.url}`);
        }
        await new Promise(r => setTimeout(r, 300));
      }
    } catch { /* non-fatal */ }
  }

  return found;
}

// ─── 4. Certificate Transparency (crt.sh) ─────────────────────────────────────

async function certTransparency(domain: string): Promise<string[]> {
  // crt.sh reveals all SSL certificates issued for a domain — sometimes
  // includes email addresses in the Subject Alternative Names or org fields
  try {
    const { data } = await axios.get(`https://crt.sh/?q=%25@${domain}&output=json`, {
      timeout: 15000,
      headers: { 'User-Agent': UA },
    });
    const rows: any[] = Array.isArray(data) ? data : [];
    const emails: string[] = [];
    for (const row of rows) {
      const nameValue = String(row.name_value ?? '').toLowerCase();
      const commonName = String(row.common_name ?? '').toLowerCase();
      const combined = nameValue + ' ' + commonName;
      for (const email of extractDomainEmails(combined, domain)) {
        emails.push(email);
      }
    }
    return [...new Set(emails)];
  } catch { return []; }
}

// ─── 5. Pastebin / paste sites ───────────────────────────────────────────────

async function searchPasteSites(domain: string): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const queries = [
    `site:pastebin.com "${domain}"`,
    `site:pastecode.io "${domain}"`,
    `site:hastebin.com "${domain}"`,
    `site:gist.github.com "@${domain}"`,
  ];

  for (const q of queries) {
    try {
      const results = await ddgSearch(q, 5);
      for (const r of results) {
        const html = await fetchText(r.url, 8000);
        for (const email of extractDomainEmails(html, domain)) {
          found.set(email, `paste:${r.url}`);
        }
        await new Promise(r => setTimeout(r, 300));
      }
    } catch { /* ignore */ }
  }

  return found;
}

// ─── 6. Job boards ────────────────────────────────────────────────────────────

async function jobBoards(domain: string, companyName: string): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const queries = [
    `"${companyName}" jobs hiring email contact`,
    `site:indeed.com "${companyName}" recruiter`,
    `site:glassdoor.com "${companyName}" contact`,
    `"${companyName}" careers "@${domain}"`,
  ];

  for (const q of queries) {
    try {
      const results = await ddgSearch(q, 5);
      for (const r of results) {
        const html = await fetchText(r.url, 8000);
        for (const email of extractDomainEmails(html, domain)) {
          found.set(email, `jobs:${r.url}`);
        }
        for (const email of extractDomainEmails(r.snippet ?? '', domain)) {
          found.set(email, `jobs-snippet:${r.url}`);
        }
        await new Promise(r => setTimeout(r, 300));
      }
    } catch { /* ignore */ }
  }

  return found;
}

// ─── Main OSINT entry point ───────────────────────────────────────────────────

export async function osintDomain(
  domain: string,
  companyName: string,
  onProgress?: (msg: string, count: number) => void,
): Promise<OsintResult> {
  const allEmails = new Map<string, { source: string; name?: string; context?: string }>();
  let sources = 0;

  const merge = (emails: Map<string, string>, sourceName: string) => {
    for (const [email, src] of emails) {
      if (!allEmails.has(email)) allEmails.set(email, { source: src });
    }
    sources++;
    onProgress?.(`${sourceName}: +${emails.size} emails`, allEmails.size);
  };

  logger.info({ domain, companyName }, 'osint scan started');

  // Run all sources
  onProgress?.('GitHub search...', 0);
  const gh = await searchGitHub(domain);
  merge(gh, 'github');

  onProgress?.('Google dorks...', allEmails.size);
  const gd = await googleDorks(domain);
  merge(gd, 'google-dorks');

  onProgress?.('Industry conferences...', allEmails.size);
  const conf = await industryConferences(domain, companyName);
  merge(conf, 'conferences');

  onProgress?.('Certificate Transparency...', allEmails.size);
  const certs = await certTransparency(domain);
  const certMap = new Map(certs.map(e => [e, `crt.sh:${domain}`]));
  merge(certMap, 'crt.sh');

  onProgress?.('Paste sites...', allEmails.size);
  const pastes = await searchPasteSites(domain);
  merge(pastes, 'pastes');

  onProgress?.('Job boards...', allEmails.size);
  const jobs = await jobBoards(domain, companyName);
  merge(jobs, 'jobs');

  logger.info({ domain, emails: allEmails.size, sources }, 'osint scan complete');

  return { emails: allEmails, totalSources: sources };
}
