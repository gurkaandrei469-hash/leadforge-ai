import axios from 'axios';
import * as cheerio from 'cheerio';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { getSerperPool } from '../intelligence/domain-hunter/key-pool.js';
const serperPool = getSerperPool();

export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
}

const UA_POOL = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0',
];
const pickUA = () => UA_POOL[Math.floor(Math.random() * UA_POOL.length)]!;

/**
 * Multi-backend free web search. Tries in order:
 *   1. Brave Search API   — best quality, free tier (~2k queries/mo), needs BRAVE_SEARCH_API_KEY
 *   2. Serper.dev         — alternative, free trial (2500 queries), needs SERPER_API_KEY
 *   3. DuckDuckGo HTML    — keyless, but heavily anti-bot'd in 2024+, often returns empty
 * Returns empty array (with a logged warning) if all backends fail.
 */
export async function ddgSearch(query: string, limit = 25): Promise<SearchResult[]> {
  if (env.BRAVE_SEARCH_API_KEY) {
    try {
      const results = await searchBrave(query, limit, env.BRAVE_SEARCH_API_KEY);
      if (results.length > 0) return results;
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'Brave search failed; trying next backend');
    }
  }

  // Serper — try all pooled keys in rotation until one works
  const serperKey = serperPool.getKey();
  if (serperKey) {
    try {
      const results = await searchSerper(query, limit, serperKey);
      if (results.length > 0) return results;
    } catch (err: any) {
      const msg = err?.message ?? '';
      if (/429|quota|credits|rate/i.test(msg)) serperPool.markExhausted(serperKey);
      // Try next key in pool immediately
      const nextKey = serperPool.getKey();
      if (nextKey && nextKey !== serperKey) {
        try {
          const r2 = await searchSerper(query, limit, nextKey);
          if (r2.length > 0) return r2;
        } catch { /* fall through */ }
      }
      logger.warn({ err: msg }, 'Serper search failed; trying next backend');
    }
  }

  // Last resort: DDG. Often returns 0 in 2024+ due to anti-bot.
  try {
    const r1 = await tryDdgHtml(query, limit);
    if (r1.length > 0) return r1;
    const r2 = await tryDdgLite(query, limit);
    if (r2.length > 0) return r2;
  } catch { /* swallow */ }

  logger.warn({ query }, 'all search backends returned 0 results — add BRAVE_SEARCH_API_KEY for reliable search');
  return [];
}

// ─────────────────────────── Brave Search API ───────────────────────────

async function searchBrave(query: string, limit: number, apiKey: string): Promise<SearchResult[]> {
  const { data } = await axios.get('https://api.search.brave.com/res/v1/web/search', {
    headers: {
      'X-Subscription-Token': apiKey,
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip',
    },
    params: { q: query, count: Math.min(limit, 20), country: 'US', safesearch: 'off' },
    timeout: 15_000,
  });
  const results: SearchResult[] = (data?.web?.results ?? []).map((r: any) => ({
    url: r.url,
    title: r.title ?? '',
    snippet: r.description ?? '',
  }));
  return results.slice(0, limit);
}

// ─────────────────────────── Serper.dev (Google results) ───────────────────────────

async function searchSerper(query: string, limit: number, apiKey: string): Promise<SearchResult[]> {
  const { data } = await axios.post(
    'https://google.serper.dev/search',
    { q: query, num: Math.min(limit, 20) },
    { headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' }, timeout: 15_000 },
  );
  const results: SearchResult[] = (data?.organic ?? []).map((r: any) => ({
    url: r.link,
    title: r.title ?? '',
    snippet: r.snippet ?? '',
  }));
  return results.slice(0, limit);
}

// ─────────────────────────── DuckDuckGo (best-effort fallback) ───────────────────────────

function unwrapDdg(href: string): string {
  if (!href) return '';
  if (href.startsWith('//duckduckgo.com/l/')) {
    const u = new URL('https:' + href);
    return decodeURIComponent(u.searchParams.get('uddg') ?? '');
  }
  if (href.startsWith('/l/')) {
    const u = new URL('https://duckduckgo.com' + href);
    return decodeURIComponent(u.searchParams.get('uddg') ?? '');
  }
  if (href.startsWith('http')) return href;
  return '';
}

async function tryDdgHtml(query: string, limit: number): Promise<SearchResult[]> {
  const { data } = await axios.get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { 'User-Agent': pickUA(), Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.5' },
    timeout: 10_000,
    validateStatus: (s) => s < 500,
  });
  if (typeof data === 'string' && data.includes('anomaly-modal')) return [];
  const $ = cheerio.load(data);
  const out: SearchResult[] = [];
  $('div.result, div.web-result').each((_i, el) => {
    if (out.length >= limit) return false;
    const $el = $(el);
    const title = $el.find('a.result__a, a.result__url').first().text().trim();
    const url = unwrapDdg($el.find('a.result__a, a.result__url').first().attr('href') ?? '');
    const snippet = $el.find('.result__snippet, a.result__snippet').text().trim();
    if (url && url.startsWith('http')) out.push({ url, title, snippet });
  });
  return out;
}

async function tryDdgLite(query: string, limit: number): Promise<SearchResult[]> {
  const { data } = await axios.post(
    'https://lite.duckduckgo.com/lite/',
    new URLSearchParams({ q: query }).toString(),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': pickUA(),
      },
      timeout: 10_000,
      validateStatus: (s) => s < 500,
    },
  );
  if (typeof data === 'string' && data.includes('anomaly-modal')) return [];
  const $ = cheerio.load(data);
  const out: SearchResult[] = [];
  $('a[href]').each((_i, el) => {
    if (out.length >= limit) return false;
    const url = unwrapDdg($(el).attr('href') ?? '');
    const title = $(el).text().trim();
    if (url && url.startsWith('http') && !url.includes('duckduckgo.com') && title.length > 5) {
      out.push({ url, title, snippet: '' });
    }
  });
  return out;
}

// ─────────────────────────── LinkedIn discovery ───────────────────────────

export async function findLinkedInProfile(name: string, company?: string): Promise<string | null> {
  const query = `"${name}"${company ? ` "${company}"` : ''} site:linkedin.com/in/`;
  const results = await ddgSearch(query, 5);
  const hit = results.find((r) => /linkedin\.com\/in\//i.test(r.url));
  return hit?.url ?? null;
}

/** Public helper: which search backend is active? */
export function activeSearchBackend(): 'brave' | 'serper' | 'ddg' | 'none' {
  if (env.BRAVE_SEARCH_API_KEY) return 'brave';
  if (env.SERPER_API_KEY) return 'serper';
  return 'ddg';
}
