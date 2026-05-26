import type { Filter } from '../filters/types.js';
import { ddgSearch } from './searchEngines.js';
import { logger } from '../utils/logger.js';

// Build candidate URL list from sources + filter keywords.
// - CUSTOM_URL_LIST: pulls explicit URLs from filter (special `__urls__` field)
// - WEB_SEARCH: free DuckDuckGo HTML scrape, expanded per keyword
// - SOCIAL_LINKEDIN: site-scoped DDG query for linkedin.com/in/ pages
// - DIRECTORY: site-scoped query for common public directories
export async function discoverSources(sources: any[], filters: Filter): Promise<string[]> {
  const keywords = extractKeywords(filters);
  const inlineUrls = extractInlineUrls(filters);
  const urls: string[] = [];

  for (const src of sources) {
    switch (src) {
      case 'CUSTOM_URL_LIST': {
        urls.push(...inlineUrls);
        break;
      }
      case 'WEB_SEARCH': {
        // Run a DDG search per keyword, collect first ~15 result URLs each
        for (const kw of keywords.slice(0, 5)) {
          try {
            const results = await ddgSearch(kw, 15);
            urls.push(...results.map((r) => r.url));
          } catch (err) {
            logger.warn({ kw, err: (err as Error).message }, 'WEB_SEARCH discovery failed');
          }
        }
        break;
      }
      case 'SOCIAL_LINKEDIN': {
        for (const kw of keywords.slice(0, 5)) {
          try {
            const results = await ddgSearch(`${kw} site:linkedin.com/in/`, 10);
            urls.push(...results.map((r) => r.url).filter((u) => /linkedin\.com\/in\//i.test(u)));
          } catch {}
        }
        break;
      }
      case 'DIRECTORY':
      case 'COMPANY_PAGE':
      case 'BLOG':
      case 'FORUM':
      case 'LISTING': {
        const hint = src.toLowerCase().replace(/_/g, ' ');
        for (const kw of keywords.slice(0, 3)) {
          try {
            const results = await ddgSearch(`${kw} ${hint} contact`, 8);
            urls.push(...results.map((r) => r.url));
          } catch {}
        }
        break;
      }
      default:
        // SOCIAL_TWITTER, CONTACT_PAGE, DATABASE — fall through to keyword search for now
        for (const kw of keywords.slice(0, 3)) {
          try {
            const results = await ddgSearch(kw, 5);
            urls.push(...results.map((r) => r.url));
          } catch {}
        }
    }
  }

  // De-dupe + sanity-cap
  const unique = [...new Set(urls.filter((u) => /^https?:\/\//.test(u)))];
  return unique.slice(0, 200);
}

// Walks the filter tree looking for a top-level `__urls__` array.
function extractInlineUrls(f: Filter): string[] {
  const out: string[] = [];
  const walk = (n: any) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n.__urls__)) out.push(...n.__urls__.map(String));
    if (n.AND) n.AND.forEach(walk);
    if (n.OR) n.OR.forEach(walk);
    if (n.NOT) walk(n.NOT);
  };
  walk(f);
  return out;
}

function extractKeywords(f: Filter): string[] {
  const out: string[] = [];
  const walk = (n: any) => {
    if (!n) return;
    if (n.field === 'keyword' || n.field === 'niche' || n.field === 'industry') {
      const v = n.value;
      if (Array.isArray(v)) out.push(...v.map(String));
      else if (v) out.push(String(v));
    }
    if (n.AND) n.AND.forEach(walk);
    if (n.OR) n.OR.forEach(walk);
    if (n.NOT) walk(n.NOT);
  };
  walk(f);
  return [...new Set(out)];
}
