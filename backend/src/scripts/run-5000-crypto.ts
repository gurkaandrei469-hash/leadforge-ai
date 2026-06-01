/**
 * Continuous extraction runner — keeps going until the DB has >= TARGET leads.
 *
 * Fixes vs previous version:
 *  - countLeads() counts ALL non-archived leads (no matchedKeywords filter)
 *  - Per-batch targetLeads is 1000 (bigger URL pool → more leads per run)
 *  - If a batch yields 0 net new leads (all duplicates), we still advance
 *    keyword index so we don't get stuck in an infinite loop
 *  - 20 keyword batches × 4 source sets = 80 unique combinations
 */
import { runExtraction } from '../scraping/orchestrator.js';
import { PrismaClient } from '@prisma/client';

const TEAM_ID     = 'cmpn9ul0f0002ickxqindqgn3';   // gurkafrued@gmail.com
const CREATED_BY  = 'cmpn9uks10000ickxq1ilgsu8';
const TARGET      = 5000;
const BATCH_TARGET = 1000;   // leads per batch — larger = more URL passes

// Fresh client per batch — prevents Neon from killing long-lived idle connections
function newPrisma() {
  return new PrismaClient({ log: [] });
}

const KEYWORD_BATCHES: string[][] = [
  ['crypto startup','blockchain company','web3 founder','defi protocol','crypto exchange'],
  ['bitcoin startup','ethereum developer','nft project','crypto vc','blockchain developer'],
  ['defi founder','web3 company','crypto fund','blockchain ceo','crypto advisor'],
  ['crypto cto','web3 investor','blockchain startup','nft creator','crypto accelerator'],
  ['blockchain entrepreneur','web3 startup','crypto angel','defi investor','dao founder'],
  ['crypto incubator','blockchain founder','web3 ceo','nft founder','crypto consultancy'],
  ['blockchain engineer','crypto developer','web3 engineer','defi developer','bitcoin developer'],
  ['crypto hedge fund','blockchain venture','web3 venture','crypto asset management','digital asset'],
  ['blockchain association','crypto association','web3 community','blockchain council','crypto network'],
  ['crypto trading','blockchain fintech','defi trading','crypto payment','blockchain payment'],
  ['nft marketplace','crypto marketplace','web3 marketplace','blockchain marketplace','defi exchange'],
  ['crypto media','blockchain media','web3 media','crypto journalist','blockchain reporter'],
  ['crypto lawyer','blockchain attorney','web3 legal','crypto compliance','blockchain regulatory'],
  ['crypto mining','bitcoin mining','blockchain infrastructure','web3 infrastructure','crypto hosting'],
  ['crypto wallet','web3 wallet','defi wallet','blockchain wallet','crypto custody'],
  ['crypto analytics','blockchain analytics','defi analytics','web3 analytics','on-chain analyst'],
  ['crypto recruiter','web3 recruiter','blockchain recruiter','crypto talent','web3 talent'],
  ['crypto marketing','web3 marketing','blockchain marketing','nft marketing','crypto growth'],
  ['crypto conference','blockchain summit','web3 event','defi conference','crypto meetup'],
  ['crypto university','blockchain education','web3 education','crypto course','defi course'],
];

const SOURCE_SETS = [
  ['WEB_SEARCH','SOCIAL_LINKEDIN','DIRECTORY','BLOG','COMPANY_PAGE'],
  ['WEB_SEARCH','COMPANY_PAGE','CONTACT_PAGE','FORUM','LISTING'],
  ['WEB_SEARCH','DIRECTORY','LISTING','BLOG','CONTACT_PAGE'],
  ['WEB_SEARCH','SOCIAL_LINKEDIN','COMPANY_PAGE','CONTACT_PAGE','FORUM'],
];

function bar(pct: number, w = 40) {
  const f = Math.min(w, Math.floor((pct / 100) * w));
  return '█'.repeat(f) + '░'.repeat(w - f);
}

// Fresh Prisma client per operation — avoids Neon long-lived connection drops
async function countLeads(): Promise<number> {
  const p = newPrisma();
  try {
    return await p.lead.count({ where: { teamId: TEAM_ID, status: { not: 'ARCHIVED' } } });
  } finally { await p.$disconnect(); }
}

async function runBatch(batchIdx: number): Promise<number> {
  const kw  = KEYWORD_BATCHES[batchIdx % KEYWORD_BATCHES.length]!;
  const src = SOURCE_SETS[batchIdx % SOURCE_SETS.length]!;

  // Create job with its own short-lived client
  const jobId = await (async () => {
    const p = newPrisma();
    try {
      const job = await p.extractionJob.create({
        data: {
          teamId: TEAM_ID,
          createdById: CREATED_BY,
          name: `Crypto Leads — Batch ${batchIdx + 1}`,
          sources: src as any[],
          filters: {
            AND: [
              { field: 'keyword', operator: 'has_any', value: kw },
              { field: 'has_email', operator: 'exists', value: null },
            ],
          },
          targetLeads: BATCH_TARGET,
          priority: 'URGENT',
          status: 'RUNNING',
          startedAt: new Date(),
        },
      });
      return job.id;
    } finally { await p.$disconnect(); }
  })();

  process.stdout.write(`\n[Batch ${batchIdx + 1}] Job ${jobId}\n`);
  process.stdout.write(`  Keywords : ${kw.slice(0, 3).join(', ')} +${kw.length - 3}\n`);
  process.stdout.write(`  Sources  : ${src.join(', ')}\n`);

  let lastPages = -1;
  let batchLeads = 0;

  // runExtraction uses the shared prisma singleton internally — that's fine
  // (it does many short queries). We reconnect between batches, not mid-batch.
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
    targetLeads: BATCH_TARGET,
    onProgress: async ({ progress, leadsFound, pagesScraped }) => {
      if (pagesScraped !== lastPages) {
        lastPages = pagesScraped;
        batchLeads = leadsFound;
        process.stdout.write(
          `\r  [${bar(progress)}] ${progress.toFixed(0)}%  pages=${pagesScraped}  found=${leadsFound}   `
        );
        // Best-effort progress update — ignore connection errors
        const pu = newPrisma();
        await pu.extractionJob.update({
          where: { id: jobId },
          data: { progress, leadsFound, pagesScraped },
        }).catch(() => {}).finally(() => pu.$disconnect());
      }
    },
  });

  // Mark complete
  const pc = newPrisma();
  await pc.extractionJob.update({
    where: { id: jobId },
    data: { status: 'COMPLETED', completedAt: new Date(), progress: 100, leadsFound: batchLeads },
  }).catch(() => {}).finally(() => pc.$disconnect());

  process.stdout.write('\n');
  return batchLeads;
}

async function main() {
  const start = Date.now();
  console.log('\n━━━ LeadForge: 5000 Crypto Leads ━━━');
  console.log(`Target: ${TARGET}  |  Per-batch target: ${BATCH_TARGET}`);
  console.log(`Team  : ${TEAM_ID}`);

  let total = await countLeads();
  console.log(`Current leads in DB: ${total}\n`);

  let batchIdx = 0;

  while (total < TARGET) {
    const beforeBatch = total;
    const batchFound  = await runBatch(batchIdx);

    total = await countLeads();
    const net     = total - beforeBatch;
    const elapsed = ((Date.now() - start) / 60000).toFixed(1);
    const pct     = Math.min(100, (total / TARGET) * 100).toFixed(1);

    console.log(`\n  ✅ Batch ${batchIdx + 1}: scraped ${batchFound} | net new: +${net} | total: ${total}/${TARGET} (${pct}%)`);
    console.log(`  [${bar((total / TARGET) * 100)}]  ${elapsed}min elapsed`);

    if (total >= TARGET) break;

    batchIdx++;
    await new Promise(r => setTimeout(r, 2000));
  }

  const elapsed = ((Date.now() - start) / 60000).toFixed(1);
  console.log('\n━━━ DONE ━━━');
  console.log(`Total leads: ${total}  |  Time: ${elapsed}min`);
  console.log('Export at: https://leadforge-ai-tawny.vercel.app/leads');
}

main()
  .catch(e => { console.error('Fatal:', e.message ?? e); process.exit(1); });
