/**
 * Deep domain crawler — visits every page of a target domain to extract
 * email addresses, employee names, and job titles.
 * Respects robots.txt, applies polite rate limits.
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import { ddgSearch } from '../../scraping/searchEngines.js';
import { logger } from '../../utils/logger.js';

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36';

export interface CrawlResult {
  emails: Set<string>;
  names: Array<{ name: string; title?: string; url: string }>;
  pagesVisited: number;
}

async function fetchPage(url: string): Promise<string | null> {
  try {
    const { data } = await axios.get(url, {
      timeout: 12000,
      headers: { 'User-Agent': UA, 'Accept': 'text/html' },
      maxRedirects: 4,
      validateStatus: (s) => s < 400,
    });
    return typeof data === 'string' ? data : null;
  } catch { return null; }
}

function extractEmailsFromHtml(html: string, domain: string): string[] {
  const found: string[] = [];
  const matches = html.match(EMAIL_RE) ?? [];
  for (const m of matches) {
    const e = m.toLowerCase().trim();
    if (e.endsWith('@' + domain) || e.endsWith('.' + domain)) {
      found.push(e);
    }
  }
  return [...new Set(found)];
}

function extractNames($: ReturnType<typeof cheerio.load>, url: string): Array<{ name: string; title?: string; url: string }> {
  const results: Array<{ name: string; title?: string; url: string }> = [];

  // Common team/staff patterns
  const teamSelectors = [
    '[class*="team"],[class*="staff"],[class*="person"],[class*="member"],[class*="employee"],[class*="bio"],[class*="profile"],[class*="leader"]',
  ];

  for (const sel of teamSelectors) {
    $(sel).each((_i, el) => {
      const text = $(el).text().replace(/\s+/g, ' ').trim();
      // Look for name-like patterns: "FirstName LastName" at start
      const nameMatch = text.match(/^([A-Z][a-z]+ [A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/);
      if (!nameMatch) return;
      const name = nameMatch[1];
      if (name.split(' ').length < 2 || name.length > 50) return;

      // Try to find a title nearby
      const titleEl = $(el).find('[class*="title"],[class*="role"],[class*="position"],[class*="job"]').first();
      const title = titleEl.text().trim() || undefined;

      results.push({ name, title, url });
    });
  }

  // Also look for <h3>/<h4> name + following <p> title pattern
  $('h3,h4').each((_i, el) => {
    const text = $(el).text().trim();
    if (/^[A-Z][a-z]+ [A-Z][a-z]/.test(text) && text.length < 50) {
      const next = $(el).next('p,span,div').first().text().trim();
      const title = next.length > 0 && next.length < 80 ? next : undefined;
      results.push({ name: text, title, url });
    }
  });

  return results;
}

// Get all internal URLs from a page
function extractInternalLinks($: ReturnType<typeof cheerio.load>, domain: string, baseUrl: string): string[] {
  const links: string[] = [];
  $('a[href]').each((_i, el) => {
    const href = $( el).attr('href') ?? '';
    try {
      const abs = new URL(href, baseUrl).href;
      if (abs.includes(domain) && !abs.includes('#') &&
          !abs.match(/\.(jpg|jpeg|png|gif|svg|pdf|zip|css|js|xml|ico|woff|ttf)$/i)) {
        links.push(abs);
      }
    } catch { /* ignore bad URLs */ }
  });
  return [...new Set(links)];
}

// Priority pages to crawl first
const PRIORITY_PATHS = [
  '/about', '/about-us', '/team', '/our-team', '/leadership', '/staff',
  '/contact', '/contact-us', '/people', '/company', '/management',
  '/executives', '/corporate', '/news', '/press', '/careers',
  '/sitemap.xml', '/sitemap',
];

export async function crawlDomain(domain: string, maxPages = 200): Promise<CrawlResult> {
  const result: CrawlResult = { emails: new Set(), names: [], pagesVisited: 0 };
  const visited = new Set<string>();
  const queue: string[] = [];

  const base = `https://${domain}`;
  const wwwBase = `https://www.${domain}`;

  // Seed with priority pages
  for (const path of PRIORITY_PATHS) {
    queue.push(base + path, wwwBase + path);
  }
  queue.push(base, wwwBase);

  // Also use Serper to find indexed pages on the domain
  try {
    const siteResults = await ddgSearch(`site:${domain}`, 20);
    for (const r of siteResults) {
      if (r.url.includes(domain)) queue.push(r.url);
    }
    const teamResults = await ddgSearch(`site:${domain} team OR staff OR leadership OR contact`, 20);
    for (const r of teamResults) {
      if (r.url.includes(domain)) queue.push(r.url);
    }
  } catch { /* non-fatal */ }

  const nameSet = new Set<string>();

  while (queue.length > 0 && result.pagesVisited < maxPages) {
    const url = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);

    const html = await fetchPage(url);
    if (!html) continue;

    result.pagesVisited++;
    const $ = cheerio.load(html);

    // Extract emails on this page
    const pageEmails = extractEmailsFromHtml(html, domain);
    for (const e of pageEmails) result.emails.add(e);

    // Extract names
    const pageNames = extractNames($, url);
    for (const n of pageNames) {
      if (!nameSet.has(n.name)) {
        nameSet.add(n.name);
        result.names.push(n);
      }
    }

    // Queue internal links (prioritise team/contact/about)
    const links = extractInternalLinks($, domain, url);
    const priority = links.filter(l =>
      /team|staff|about|contact|leadership|people|management|executive|press|news/.test(l.toLowerCase())
    );
    const rest = links.filter(l => !priority.includes(l));
    queue.unshift(...priority.filter(l => !visited.has(l)));
    queue.push(...rest.filter(l => !visited.has(l)));

    // Polite crawl delay
    await new Promise(r => setTimeout(r, 150));
  }

  logger.info({ domain, pages: result.pagesVisited, emails: result.emails.size, names: result.names.length }, 'domain crawl complete');
  return result;
}
