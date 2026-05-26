import tldts from 'tldts';
import type { CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import type { ScrapedPage } from './scraper.js';

// Negative lookbehind so we don't grab "Founderemma@..." when text concatenates across block tags.
const EMAIL_RE = /(?<![A-Za-z0-9._%+\-])[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g;
const LINKEDIN_RE = /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9\-_%]+/gi;
const TWITTER_RE = /(?:https?:\/\/)?(?:www\.)?(?:twitter|x)\.com\/[A-Za-z0-9_]+/gi;

const CARD_SELECTORS = [
  'section',
  'article',
  '[class*="team-member"]',
  '[class*="profile"]',
  'li',
] as const;

export interface LeadCandidate {
  email: string | null;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  companyName: string | null;
  companyDomain: string | null;
  companyWebsite: string | null;
  linkedinUrl: string | null;
  twitterUrl: string | null;
  matchedKeywords: string[];
  sourceType: any;
  sourceUrl: string;
  sourcePageTitle: string;
  technologies: string[];
}

const ROLE_KEYWORDS = [
  'ceo', 'cto', 'cmo', 'cfo', 'coo', 'cpo', 'founder', 'co-founder',
  'vp engineering', 'vp marketing', 'vp sales', 'vp product', 'vp',
  'vice president', 'head of', 'director', 'sales director',
  'lead', 'manager', 'engineer', 'designer', 'developer',
  'marketing', 'sales', 'growth', 'operations', 'product', 'business',
  'analyst', 'consultant', 'specialist',
];

// Find a role-keyword phrase in `text` and return a clean ~40-char snippet
// snapped to word boundaries on both sides.
function deriveTitle(text: string, knownName?: string | null): string | null {
  let stripped = text
    .replace(EMAIL_RE, '')
    .replace(LINKEDIN_RE, '')
    .replace(TWITTER_RE, '')
    .replace(/mailto:[^\s]*/gi, '')
    .replace(/\bmailto\b/gi, '')
    .replace(/Email:|LinkedIn:|Twitter:|@\w+/gi, '')
    .replace(STRIP_SEP_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (knownName) {
    // remove name occurrences so the title doesn't duplicate it
    const escaped = knownName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    stripped = stripped.replace(new RegExp(escaped, 'g'), '').replace(/^[\s—–\-:,|]+/, '').replace(/\s+/g, ' ').trim();
  }
  const lower = stripped.toLowerCase();
  let best: { start: number; end: number; len: number } | null = null;
  for (const role of ROLE_KEYWORDS) {
    const idx = lower.indexOf(role);
    if (idx === -1) continue;
    // snap backward to a word boundary (space) or start
    let start = idx;
    while (start > 0 && /[A-Za-z]/.test(stripped[start - 1]!)) start--;
    // snap forward up to 60 chars or a sentence break
    let end = idx + role.length;
    let extras = 0;
    while (end < stripped.length && extras < 40 && !/[.!?\n—–\-,]/.test(stripped[end]!)) {
      end++;
      extras++;
    }
    while (start > 0 && /[A-Za-z]/.test(stripped[start - 1]!)) start--;
    const len = end - start;
    if (!best || len > best.len) best = { start, end, len };
  }
  if (!best) return null;
  return stripped.slice(best.start, best.end).trim().replace(/[<>·•|]/g, '').replace(/\s+/g, ' ').trim();
}

function deriveCompanyDomain(url: string): string | null {
  const parsed = tldts.parse(url);
  if (parsed.domain) return parsed.domain;
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

function detectTech(html: string): string[] {
  const techs: string[] = [];
  if (/cdn\.shopify\.com/.test(html)) techs.push('shopify');
  if (/wp-content/i.test(html)) techs.push('wordpress');
  if (/_next\/static/.test(html)) techs.push('next.js');
  if (/react(\.|-)/.test(html)) techs.push('react');
  if (/cloudflare/i.test(html)) techs.push('cloudflare');
  if (/hubspot/i.test(html)) techs.push('hubspot');
  if (/segment\.io/.test(html)) techs.push('segment');
  if (/klaviyo/i.test(html)) techs.push('klaviyo');
  return [...new Set(techs)];
}

function splitName(full: string): { first: string | null; last: string | null } {
  if (!full) return { first: null, last: null };
  const parts = full.replace(/[—–\-].*$/, '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: null, last: null };
  if (parts.length === 1) return { first: parts[0]!, last: null };
  return { first: parts[0]!, last: parts.slice(1).join(' ') };
}

function normalizeUrl(maybe: string): string {
  if (/^https?:\/\//i.test(maybe)) return maybe;
  return `https://${maybe}`;
}

// Extract text from an element using a unicode SEP that won't match the email regex
// but isn't visible in title output. Guarantees concatenated children don't fuse "WordEmail@x.com".
const SEP = '';
const STRIP_SEP_RE = /[]+/g;

function clean(s: string): string {
  return s.replace(STRIP_SEP_RE, ' ').replace(/\s+/g, ' ').trim();
}

function blockText($: CheerioAPI, el: Element): string {
  const $el = $(el);
  const blockTags = 'p, br, div, dt, dd, h1, h2, h3, h4, h5, h6, li, section, article';
  $el.find(blockTags).each((_i, c) => {
    $(c).prepend(SEP).append(SEP);
  });
  $el.find('br').replaceWith(SEP);
  return $el.text();
}

function collectHrefs($: CheerioAPI, el: Element): string[] {
  const hrefs: string[] = [];
  $(el).find('a[href]').each((_i, a) => {
    const h = $(a).attr('href');
    if (h) hrefs.push(h);
  });
  return hrefs;
}

function deriveName($: CheerioAPI, el: Element): string | null {
  const $el = $(el);
  const heading = $el.find('h1, h2, h3, h4, h5, h6, strong, b, dt').first().text();
  if (!heading) return null;
  const trimmed = clean(heading);
  return trimmed && trimmed.length < 80 ? trimmed : null;
}

function emit(
  base: Omit<LeadCandidate, 'email' | 'fullName' | 'firstName' | 'lastName' | 'jobTitle' | 'linkedinUrl' | 'twitterUrl'>,
  email: string,
  name: string | null,
  title: string | null,
  linkedins: string[],
  twitters: string[],
): LeadCandidate {
  const { first, last } = splitName(name ?? '');
  return {
    ...base,
    email,
    fullName: name,
    firstName: first,
    lastName: last,
    jobTitle: title,
    linkedinUrl: linkedins[0] ? normalizeUrl(linkedins[0]) : null,
    twitterUrl: twitters[0] ? normalizeUrl(twitters[0]) : null,
  };
}

export function extractLeads(page: ScrapedPage): LeadCandidate[] {
  const { $ } = page;
  const companyDomain = deriveCompanyDomain(page.url);
  const techs = detectTech(page.html);
  const out: LeadCandidate[] = [];
  const seenEmails = new Set<string>();

  const baseFields = {
    companyName: companyDomain,
    companyDomain,
    companyWebsite: companyDomain ? new URL(page.url).origin : null,
    matchedKeywords: [] as string[],
    sourceType: 'CUSTOM_URL_LIST' as any,
    sourceUrl: page.url,
    sourcePageTitle: page.title,
    technologies: techs,
  };

  // PASS 1a: <dl> definition pairs
  $('dl').each((_i, dl) => {
    const dts = $(dl).find('dt').toArray();
    dts.forEach((dtEl) => {
      const $dt = $(dtEl);
      const $dd = $dt.next('dd');
      if ($dd.length === 0) return;
      const dtRaw = $dt.text().replace(/\s+/g, ' ').trim();
      // Split "Name — Title" into separate fields (common in <dt> labels)
      let name: string | null = dtRaw;
      let dtTitle: string | null = null;
      const dashMatch = dtRaw.match(/^(.+?)\s*[—–\-]\s*(.+)$/);
      if (dashMatch) {
        name = dashMatch[1]!.trim();
        dtTitle = dashMatch[2]!.trim();
      }
      // CRITICAL: extract dt and dd text SEPARATELY, then join with SEP so emails don't fuse
      const text = `${dtRaw}${SEP}${$dd.text()}${SEP}${collectHrefs($, dtEl).join(' ')}${SEP}${collectHrefs($, $dd[0]!).join(' ')}`;
      const emails = [...new Set(text.match(EMAIL_RE) ?? [])];
      if (emails.length === 0) return;
      const title = dtTitle ?? deriveTitle(text, name);
      const linkedins = [...new Set(text.match(LINKEDIN_RE) ?? [])];
      const twitters = [...new Set(text.match(TWITTER_RE) ?? [])];
      for (const email of emails) {
        const norm = email.toLowerCase();
        if (seenEmails.has(norm)) continue;
        seenEmails.add(norm);
        out.push(emit(baseFields, email, name, title, linkedins, twitters));
      }
    });
  });

  // PASS 1b: card-like containers
  for (const selector of CARD_SELECTORS) {
    $(selector).each((_i, el) => {
      // Skip nested matches: process only "leaf" cards (no further matching card inside)
      const $el = $(el);
      const text = blockText($, el) + ' ' + collectHrefs($, el).join(' ');
      if (text.length < 5 || text.length > 4000) return;

      const emails = [...new Set(text.match(EMAIL_RE) ?? [])];
      if (emails.length === 0) return;

      const linkedins = [...new Set(text.match(LINKEDIN_RE) ?? [])];
      const twitters = [...new Set(text.match(TWITTER_RE) ?? [])];
      const name = deriveName($, el);
      const title = deriveTitle(text, name);

      for (const email of emails) {
        const norm = email.toLowerCase();
        if (seenEmails.has(norm)) continue;
        seenEmails.add(norm);
        out.push(emit(baseFields, email, name, title, linkedins, twitters));
      }
    });
  }

  // PASS 2: sweep the whole page for any remaining mailboxes (general/footer addresses).
  const bodyEl = $('body').get(0);
  if (bodyEl) {
    const text = blockText($, bodyEl) + ' ' + collectHrefs($, bodyEl).join(' ');
    const pageEmails = [...new Set(text.match(EMAIL_RE) ?? [])];
    for (const email of pageEmails) {
      const norm = email.toLowerCase();
      if (seenEmails.has(norm)) continue;
      seenEmails.add(norm);
      out.push(emit(baseFields, email, null, null, [], []));
    }
  }

  return out;
}
