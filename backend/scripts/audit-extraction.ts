// Audit script — exercises every extraction source type end-to-end.
// For each source: runs discovery, fetches a few pages, runs the extractor.
// Reports per-source counts so we can see which methods produce real leads
// vs which fall back to keyword search or fail entirely.

import { discoverSources } from '../src/scraping/discovery.js';
import { scrapePage } from '../src/scraping/scraper.js';
import { extractLeads } from '../src/scraping/extractor.js';
import type { Filter } from '../src/filters/types.js';

const ALL_SOURCES = [
  'WEB_SEARCH',
  'DIRECTORY',
  'COMPANY_PAGE',
  'BLOG',
  'FORUM',
  'SOCIAL_LINKEDIN',
  'SOCIAL_TWITTER',
  'CONTACT_PAGE',
  'LISTING',
  'DATABASE',
  'CUSTOM_URL_LIST',
] as const;

const KEYWORDS = ['SaaS marketing agency', 'B2B sales consultant'];

// Build a minimal filter that the discovery code can extract keywords from.
const buildFilter = (urlList: string[] = []): Filter => ({
  AND: [
    { field: 'keyword', op: 'eq', value: KEYWORDS },
    ...(urlList.length > 0
      ? ([{ field: 'keyword', op: 'eq', value: 'placeholder', __urls__: urlList } as any])
      : []),
  ],
} as any);

interface SourceReport {
  source: string;
  urlsFound: number;
  pagesAttempted: number;
  pagesSucceeded: number;
  leadsExtracted: number;
  sampleUrls: string[];
  sampleLeads: { email: string | null; name: string | null; title: string | null; from: string }[];
  durationMs: number;
  notes: string;
}

const SEED_URLS = [
  'https://www.ycombinator.com/companies',
  'https://blog.hubspot.com/marketing',
  'https://stripe.com/about',
];

async function auditSource(source: string): Promise<SourceReport> {
  const start = Date.now();
  const filter = source === 'CUSTOM_URL_LIST' ? buildFilter(SEED_URLS) : buildFilter();

  let urls: string[] = [];
  let notes = '';
  try {
    urls = await discoverSources([source], filter);
  } catch (e) {
    notes = `discovery threw: ${(e as Error).message}`;
  }

  // Cap to 3 URLs per source for the audit (full extraction per URL is slow).
  const sampledUrls = urls.slice(0, 3);
  const leads: any[] = [];
  let pagesAttempted = 0;
  let pagesSucceeded = 0;

  for (const url of sampledUrls) {
    pagesAttempted++;
    try {
      const page = await scrapePage(url);
      pagesSucceeded++;
      const found = extractLeads(page);
      leads.push(...found.map((l) => ({ ...l, from: url })));
    } catch (e) {
      // swallow — we just want counts
    }
  }

  return {
    source,
    urlsFound: urls.length,
    pagesAttempted,
    pagesSucceeded,
    leadsExtracted: leads.length,
    sampleUrls: urls.slice(0, 3),
    sampleLeads: leads.slice(0, 2).map((l) => ({
      email: l.email,
      name: l.fullName,
      title: l.jobTitle,
      from: l.from,
    })),
    durationMs: Date.now() - start,
    notes,
  };
}

async function main() {
  console.log('▶ LeadForge extraction audit — testing all 11 source types');
  console.log('   keywords:', JSON.stringify(KEYWORDS));
  console.log('   seed URLs (for CUSTOM_URL_LIST):', SEED_URLS.length);
  console.log();

  const reports: SourceReport[] = [];
  for (const src of ALL_SOURCES) {
    process.stdout.write(`  testing ${src.padEnd(20)} `);
    const report = await auditSource(src);
    reports.push(report);
    console.log(
      `urls=${String(report.urlsFound).padStart(3)} ` +
        `pages=${report.pagesSucceeded}/${report.pagesAttempted} ` +
        `leads=${String(report.leadsExtracted).padStart(3)} ` +
        `(${report.durationMs}ms)` +
        (report.notes ? ` ⚠ ${report.notes}` : ''),
    );
  }

  console.log();
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Per-source detail');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  for (const r of reports) {
    console.log();
    console.log(`### ${r.source}`);
    console.log(`  URLs discovered:  ${r.urlsFound}`);
    console.log(`  Pages fetched OK: ${r.pagesSucceeded}/${r.pagesAttempted}`);
    console.log(`  Leads extracted:  ${r.leadsExtracted}`);
    if (r.sampleUrls.length) {
      console.log('  Sample URLs:');
      r.sampleUrls.forEach((u) => console.log('    • ' + u.slice(0, 120)));
    }
    if (r.sampleLeads.length) {
      console.log('  Sample leads:');
      r.sampleLeads.forEach((l) => console.log(`    • ${l.email ?? '(no email)'} — ${l.name ?? '?'} — ${l.title ?? '?'}`));
    }
  }

  // JSON sidecar for the writeup
  const fs = await import('fs');
  fs.writeFileSync('/tmp/extraction-audit.json', JSON.stringify(reports, null, 2));
  console.log();
  console.log('JSON report written to /tmp/extraction-audit.json');
}

main().catch((e) => {
  console.error('AUDIT FAILED:', e);
  process.exit(1);
});
