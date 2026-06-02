/**
 * Employee name finder — uses web search to discover people who work
 * at the target company, then returns structured name + title data.
 *
 * Sources:
 *  1. LinkedIn profiles (via Serper site:linkedin.com/in search)
 *  2. Company "About/Team" pages (via Serper site:domain)
 *  3. GitHub profiles (via Serper site:github.com)
 *  4. News/press mentions
 */
import { ddgSearch } from '../../scraping/searchEngines.js';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { logger } from '../../utils/logger.js';

export interface Employee {
  fullName: string;
  firstName: string;
  lastName: string;
  title?: string;
  source: string;
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36';

function parseName(raw: string): { firstName: string; lastName: string } | null {
  const cleaned = raw
    .replace(/\b(Mr|Mrs|Ms|Dr|Prof|Jr|Sr|II|III|IV)\b\.?/gi, '')
    .replace(/[^a-zA-Z\s\-']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const parts = cleaned.split(' ').filter(p => p.length >= 2);
  if (parts.length < 2) return null;

  const firstName = parts[0]!;
  const lastName = parts[parts.length - 1]!;

  // Sanity checks
  if (firstName.length < 2 || lastName.length < 2) return null;
  if (!/^[A-Z]/.test(firstName) || !/^[A-Z]/.test(lastName)) return null;
  if (firstName.length > 20 || lastName.length > 20) return null;

  return { firstName, lastName };
}

async function fetchText(url: string): Promise<string> {
  try {
    const { data } = await axios.get(url, {
      timeout: 10000,
      headers: { 'User-Agent': UA },
      maxRedirects: 3,
      validateStatus: s => s < 400,
    });
    return typeof data === 'string' ? data : '';
  } catch { return ''; }
}

// Extract name + title from a LinkedIn search result snippet
function extractFromLinkedIn(snippet: string, title: string): Employee | null {
  // LinkedIn titles look like: "John Smith - Senior Manager at Breezeline"
  const nameMatch = title.match(/^([A-Z][a-z]+ [A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/);
  const jobMatch = snippet.match(/(?:^|\.\s)([A-Za-z\s]+(?:Manager|Director|Engineer|VP|President|Officer|Lead|Head|Specialist|Analyst|Coordinator|Representative|Technician|Supervisor|Administrator)[^.]*)/i);

  if (!nameMatch) return null;
  const parsed = parseName(nameMatch[1]);
  if (!parsed) return null;

  return {
    fullName: nameMatch[1],
    ...parsed,
    title: jobMatch?.[1]?.trim(),
    source: 'linkedin',
  };
}

export async function findEmployees(
  domain: string,
  companyName: string,
  maxEmployees = 500,
): Promise<Employee[]> {
  const employees = new Map<string, Employee>(); // keyed by "first+last" to dedup

  const add = (e: Employee) => {
    const key = `${e.firstName.toLowerCase()}+${e.lastName.toLowerCase()}`;
    if (!employees.has(key)) employees.set(key, e);
  };

  const queries = [
    // LinkedIn
    `site:linkedin.com/in "${companyName}"`,
    `site:linkedin.com/in "${domain.split('.')[0]}"`,
    `site:linkedin.com/in "${companyName}" manager`,
    `site:linkedin.com/in "${companyName}" director`,
    `site:linkedin.com/in "${companyName}" engineer`,
    `site:linkedin.com/in "${companyName}" VP`,
    `site:linkedin.com/in "${companyName}" coordinator`,
    `site:linkedin.com/in "${companyName}" specialist`,
    // Company pages
    `site:${domain} team`,
    `site:${domain} staff`,
    `site:${domain} leadership`,
    `site:${domain} about`,
    `site:${domain} contact`,
    // Press/news with employee names
    `"${companyName}" employee contact email`,
    `"${companyName}" "@${domain}"`,
    `"${companyName}" director manager contact`,
    // GitHub
    `site:github.com "${companyName}"`,
    // Staff directories
    `"${companyName}" staff directory`,
    `"${companyName}" leadership team`,
  ];

  logger.info({ domain, queries: queries.length }, 'searching for employees');

  for (const query of queries) {
    if (employees.size >= maxEmployees) break;
    try {
      const results = await ddgSearch(query, 10);

      for (const r of results) {
        // LinkedIn profile page
        if (r.url.includes('linkedin.com/in/')) {
          const emp = extractFromLinkedIn(r.snippet ?? '', r.title ?? '');
          if (emp) add(emp);
          continue;
        }

        // Company own pages — fetch and extract names
        if (r.url.includes(domain)) {
          const html = await fetchText(r.url);
          if (!html) continue;
          const $ = cheerio.load(html);

          // Schema.org Person markup
          $('[itemtype*="Person"],[itemtype*="person"]').each((_i, el) => {
            const name = $( el).find('[itemprop="name"]').first().text().trim();
            const jobTitle = $(el).find('[itemprop="jobTitle"]').first().text().trim();
            const parsed = parseName(name);
            if (parsed) add({ fullName: name, ...parsed, title: jobTitle || undefined, source: r.url });
          });

          // h2/h3 + following role text
          $('h2,h3,h4').each((_i, el) => {
            const name = $(el).text().trim();
            const parsed = parseName(name);
            if (!parsed) return;
            const sibling = $(el).next('p,span,div').first().text().trim();
            add({ fullName: name, ...parsed, title: sibling.length < 80 ? sibling : undefined, source: r.url });
          });
        }

        // Generic result with name in title
        const titleName = r.title?.match(/^([A-Z][a-z]+ [A-Z][a-z]+)/);
        if (titleName) {
          const parsed = parseName(titleName[1]);
          if (parsed) add({ fullName: titleName[1], ...parsed, source: r.url });
        }
      }
    } catch (e) {
      logger.warn({ query, err: (e as Error).message }, 'employee search query failed');
    }

    await new Promise(r => setTimeout(r, 300));
  }

  const list = Array.from(employees.values());
  logger.info({ domain, found: list.length }, 'employee discovery complete');
  return list;
}
