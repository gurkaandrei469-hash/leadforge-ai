/**
 * Domain-targeted extraction — only saves leads whose email matches
 * one of the specified domains. Runs until TARGET clean leads are found
 * or all keyword batches are exhausted.
 */
import { runExtraction } from '../scraping/orchestrator.js';
import { PrismaClient } from '@prisma/client';

const TEAM_ID    = 'cmpn9ul0f0002ickxqindqgn3';
const CREATED_BY = 'cmpn9uks10000ickxq1ilgsu8';
const TARGET     = 3000;

// Only keep emails from these domains
const TARGET_DOMAINS = ['breezeline.net', 'metrocast.net', 'md.metrocast.net'];

// Keyword batches — cover all angles to find these company's staff emails
const KEYWORD_BATCHES: string[][] = [
  // Direct brand search
  ['breezeline', 'breezeline.net', 'breezeline internet', 'breezeline cable', 'breezeline broadband'],
  ['metrocast', 'metrocast.net', 'metrocast internet', 'metrocast cable', 'metrocast broadband'],
  // LinkedIn / team pages
  ['breezeline employee', 'breezeline staff', 'breezeline team', 'breezeline director', 'breezeline manager'],
  ['metrocast employee', 'metrocast staff', 'metrocast team', 'metrocast director', 'metrocast manager'],
  // Contact / about pages
  ['breezeline contact', 'breezeline.net contact', 'breezeline support team', 'breezeline press contact'],
  ['metrocast contact', 'metrocast.net contact', 'metrocast support team', 'metrocast press contact'],
  // Job postings (often list manager emails)
  ['breezeline jobs hiring', 'breezeline careers', 'breezeline recruiter', 'breezeline hr'],
  ['metrocast jobs hiring', 'metrocast careers', 'metrocast recruiter', 'metrocast hr'],
  // Leadership / executives
  ['breezeline CEO', 'breezeline CTO', 'breezeline VP', 'breezeline executive', 'breezeline leadership'],
  ['metrocast CEO', 'metrocast CTO', 'metrocast VP', 'metrocast executive', 'metrocast leadership'],
  // Press / news
  ['breezeline press release', 'breezeline news contact', 'breezeline spokesperson', 'breezeline PR'],
  ['metrocast press release', 'metrocast news contact', 'metrocast spokesperson', 'metrocast PR'],
  // Email patterns — direct searches
  ['"@breezeline.net"', 'breezeline.net email address', 'breezeline.net mail'],
  ['"@metrocast.net"', 'metrocast.net email address', 'metrocast.net mail'],
  // Industry directories
  ['breezeline ISP directory', 'breezeline cable company contact', 'breezeline Ohio Pennsylvania'],
  ['metrocast ISP directory', 'metrocast cable company contact', 'metrocast New Hampshire Maine'],
  // Glassdoor / LinkedIn profiles
  ['breezeline glassdoor', 'breezeline linkedin', 'breezeline crunchbase', 'breezeline zoominfo'],
  ['metrocast glassdoor', 'metrocast linkedin', 'metrocast crunchbase', 'metrocast zoominfo'],
  // Regional offices
  ['breezeline ohio', 'breezeline west virginia', 'breezeline pennsylvania', 'breezeline maryland'],
  ['metrocast new hampshire', 'metrocast maine', 'metrocast connecticut', 'metrocast virginia'],
];

const SOURCE_SETS = [
  ['WEB_SEARCH','COMPANY_PAGE','CONTACT_PAGE','SOCIAL_LINKEDIN','DIRECTORY'],
  ['WEB_SEARCH','BLOG','FORUM','LISTING','CONTACT_PAGE'],
  ['WEB_SEARCH','COMPANY_PAGE','CONTACT_PAGE','DIRECTORY','BLOG'],
  ['WEB_SEARCH','SOCIAL_LINKEDIN','LISTING','CONTACT_PAGE','FORUM'],
];

function bar(pct: number, w = 40) {
  return '█'.repeat(Math.min(w, Math.floor((pct / 100) * w))) + '░'.repeat(w - Math.min(w, Math.floor((pct / 100) * w)));
}

function isDomainMatch(email: string | null): boolean {
  if (!email) return false;
  const domain = email.split('@')[1]?.toLowerCase();
  return TARGET_DOMAINS.some(d => domain === d || domain?.endsWith('.' + d));
}

function newPrisma() { return new PrismaClient({ log: [] }); }

async function countLeads(): Promise<number> {
  const p = newPrisma();
  try {
    return await p.lead.count({
      where: {
        teamId: TEAM_ID,
        status: { not: 'ARCHIVED' },
        emailNormalized: { contains: 'breezeline.net', mode: 'insensitive' },
      },
    });
  } catch { return 0; }
  finally { await p.$disconnect(); }
}

async function countAllTargetLeads(): Promise<number> {
  const p = newPrisma();
  try {
    // Count leads matching any of the target domains
    const counts = await Promise.all(TARGET_DOMAINS.map(domain =>
      p.lead.count({
        where: { teamId: TEAM_ID, status: { not: 'ARCHIVED' }, emailNormalized: { endsWith: '@' + domain } },
      })
    ));
    return counts.reduce((a, b) => a + b, 0);
  } catch { return 0; }
  finally { await p.$disconnect(); }
}

async function runBatch(batchIdx: number): Promise<{ scraped: number; saved: number }> {
  const kw  = KEYWORD_BATCHES[batchIdx % KEYWORD_BATCHES.length]!;
  const src = SOURCE_SETS[batchIdx % SOURCE_SETS.length]!;

  const jobId = await (async () => {
    const p = newPrisma();
    try {
      const job = await p.extractionJob.create({
        data: {
          teamId: TEAM_ID,
          createdById: CREATED_BY,
          name: `Domain Leads — breezeline/metrocast Batch ${batchIdx + 1}`,
          sources: src as any[],
          filters: {
            AND: [
              { field: 'keyword', operator: 'has_any', value: kw },
              { field: 'has_email', operator: 'exists', value: null },
            ],
          },
          targetLeads: 500,
          priority: 'URGENT',
          status: 'RUNNING',
          startedAt: new Date(),
        },
      });
      return job.id;
    } finally { await p.$disconnect(); }
  })();

  process.stdout.write(`\n[Batch ${batchIdx + 1}] ${kw.slice(0, 3).join(', ')} +${kw.length - 3}\n`);

  let lastPages = -1;
  let scraped = 0;

  await runExtraction({
    jobId,
    teamId: TEAM_ID,
    sources: src as any[],
    filters: {
      AND: [
        { field: 'keyword', operator: 'has_any', value: kw },
        { field: 'has_email', operator: 'exists', value: null },
      ],
    },
    targetLeads: 500,
    onProgress: async ({ progress, leadsFound, pagesScraped }) => {
      if (pagesScraped !== lastPages) {
        lastPages = pagesScraped;
        scraped = pagesScraped;
        process.stdout.write(`\r  [${bar(progress)}] ${progress.toFixed(0)}%  pages=${pagesScraped}  found=${leadsFound}   `);
        const pu = newPrisma();
        await pu.extractionJob.update({ where: { id: jobId }, data: { progress, leadsFound, pagesScraped } })
          .catch(() => {}).finally(() => pu.$disconnect());
      }
    },
  });

  // Archive leads that don't match the target domains
  const cleanup = newPrisma();
  try {
    const allLeads = await cleanup.lead.findMany({
      where: { jobId, status: { not: 'ARCHIVED' } },
      select: { id: true, email: true, emailNormalized: true },
    });
    const garbage = allLeads.filter(l => !isDomainMatch(l.email));
    if (garbage.length > 0) {
      await cleanup.lead.updateMany({
        where: { id: { in: garbage.map(l => l.id) } },
        data: { status: 'ARCHIVED' },
      });
    }
    const kept = allLeads.length - garbage.length;
    process.stdout.write(`\n  Filtered: ${allLeads.length} found → ${kept} matched domain\n`);

    await cleanup.extractionJob.update({
      where: { id: jobId },
      data: { status: 'COMPLETED', completedAt: new Date(), progress: 100, leadsFound: kept },
    }).catch(() => {});

    return { scraped, saved: kept };
  } finally { await cleanup.$disconnect(); }
}

async function main() {
  const start = Date.now();
  console.log('\n━━━ Domain Extraction: breezeline.net + metrocast.net ━━━');
  console.log(`Target domains: ${TARGET_DOMAINS.join(' | ')}`);
  console.log(`Target leads  : ${TARGET}`);
  console.log(`Team          : ${TEAM_ID}`);

  let total = await countAllTargetLeads();
  console.log(`Already in DB : ${total} matching leads\n`);

  let batchIdx = 0;
  let totalSaved = 0;

  while (total < TARGET && batchIdx < KEYWORD_BATCHES.length * 2) {
    const before = total;
    const { scraped, saved } = await runBatch(batchIdx);
    total = await countAllTargetLeads();
    const net = total - before;
    const elapsed = ((Date.now() - start) / 60000).toFixed(1);
    const pct = Math.min(100, (total / TARGET) * 100).toFixed(1);

    totalSaved += net;
    console.log(`  ✅ Batch ${batchIdx + 1}: pages=${scraped} domain-matched=+${net} total=${total}/${TARGET} (${pct}%) ${elapsed}min`);
    console.log(`  [${bar((total / TARGET) * 100)}]`);

    if (total >= TARGET) break;
    batchIdx++;
    await new Promise(r => setTimeout(r, 2000));
  }

  const elapsed = ((Date.now() - start) / 60000).toFixed(1);
  console.log('\n━━━ DONE ━━━');
  console.log(`Domain leads: ${total} | Time: ${elapsed}min`);
  console.log('Export: https://leadforge-ai-tawny.vercel.app/leads');
}

main().catch(e => { console.error('Fatal:', e.message ?? e); process.exit(1); });
