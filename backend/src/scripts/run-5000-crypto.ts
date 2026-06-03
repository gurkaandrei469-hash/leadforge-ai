/**
 * Continuous extraction — runs until DB has >= TARGET clean leads.
 *
 * Key improvements:
 *  - 60 keyword batches covering every crypto/blockchain sub-niche
 *  - START_BATCH lets you resume where you left off (skip exhausted batches)
 *  - Fresh PrismaClient per batch (prevents Neon long-idle disconnects)
 *  - isMarketableEmail gate already lives in orchestrator.ts — no role/generic emails
 *  - countLeads counts all non-archived leads
 */
import { runExtraction } from '../scraping/orchestrator.js';
import { PrismaClient } from '@prisma/client';

const TEAM_ID      = 'cmpn9ul0f0002ickxqindqgn3';  // gurkafrued — browser account
const CREATED_BY   = 'cmpn9uks10000ickxq1ilgsu8';
const TARGET       = 5000;
const BATCH_TARGET = 1000;

// Resume from here — increase if early batches are exhausted
const START_BATCH  = Number(process.env.START_BATCH ?? 0);

// 60 highly-varied keyword batches covering every crypto sub-niche
const KEYWORD_BATCHES: string[][] = [
  // ── Batch 0-4: General crypto/blockchain
  ['crypto startup','blockchain company','web3 founder','defi protocol','crypto exchange'],
  ['bitcoin startup','ethereum developer','nft project','crypto vc','blockchain developer'],
  ['defi founder','web3 company','crypto fund','blockchain ceo','crypto advisor'],
  ['crypto cto','web3 investor','blockchain startup','nft creator','crypto accelerator'],
  ['blockchain entrepreneur','web3 startup','crypto angel','defi investor','dao founder'],
  // ── Batch 5-9: Specific roles
  ['crypto founder email','blockchain ceo contact','web3 director','defi coo','nft cmo'],
  ['chief crypto officer','blockchain vp engineering','web3 product manager','defi head of growth','crypto head of partnerships'],
  ['bitcoin evangelist','ethereum advocate','solana developer','polkadot builder','avalanche founder'],
  ['crypto quant trader','blockchain architect','defi smart contract developer','web3 protocol engineer','layer2 developer'],
  ['blockchain product manager','crypto growth hacker','web3 community manager','defi operations manager','nft project manager'],
  // ── Batch 10-14: Company types
  ['crypto hedge fund manager','blockchain venture capital','web3 seed fund','crypto family office','digital asset fund'],
  ['crypto exchange founder','defi dex creator','nft marketplace founder','crypto launchpad','web3 incubator founder'],
  ['blockchain consulting firm','crypto advisory firm','web3 consulting','defi consulting','blockchain strategy'],
  ['crypto media company','blockchain news founder','web3 journalist','defi publication','crypto podcast host'],
  ['crypto law firm','blockchain attorney','web3 regulatory','digital asset lawyer','crypto compliance officer'],
  // ── Batch 15-19: Tech-specific
  ['solana startup','polkadot parachain','avalanche defi','cosmos blockchain','near protocol developer'],
  ['ethereum layer2','zk rollup developer','polygon developer','optimism founder','arbitrum builder'],
  ['bitcoin lightning network','bitcoin mining company','bitcoin atm operator','bitcoin otc desk','bitcoin custody'],
  ['nft artist founder','generative art creator','nft collection founder','digital art platform','nft gaming founder'],
  ['dao governance','decentralized autonomous organization','dao treasury','dao tooling','on-chain governance'],
  // ── Batch 20-24: Use cases
  ['crypto payment gateway','blockchain remittance','defi lending protocol','crypto borrowing platform','stablecoin issuer'],
  ['crypto insurance protocol','defi yield optimizer','blockchain identity','self-sovereign identity crypto','web3 kyc'],
  ['blockchain supply chain','crypto logistics','nft ticketing','blockchain real estate','tokenized asset'],
  ['play to earn founder','gamefi developer','blockchain gaming','web3 gaming studio','nft game developer'],
  ['crypto social platform','web3 social network','decentralized social media','lens protocol developer','farcaster developer'],
  // ── Batch 25-29: Geography
  ['crypto startup usa','blockchain company new york','web3 founder san francisco','defi startup texas','bitcoin company miami'],
  ['blockchain startup toronto','crypto company vancouver','web3 founder montreal','defi startup canada','bitcoin company calgary'],
  ['crypto startup los angeles','blockchain founder chicago','web3 company seattle','defi protocol boston','nft startup austin'],
  ['crypto company london','blockchain startup berlin','web3 founder paris','defi startup amsterdam','bitcoin company zurich'],
  ['blockchain company singapore','crypto startup dubai','web3 founder hong kong','defi startup tokyo','bitcoin company seoul'],
  // ── Batch 30-34: Fundraising signals
  ['crypto company series a','blockchain startup seed round','web3 company raised','defi raised funding','nft company investment'],
  ['blockchain vc backed','crypto y combinator','web3 techstars','defi a16z portfolio','crypto coinbase ventures'],
  ['bitcoin company ycombinator','ethereum foundation grant','web3 grant recipient','blockchain accelerator graduate','crypto fellowship'],
  ['defi protocol launch','web3 mainnet launch','blockchain token launch','crypto ico','token generation event'],
  ['crypto pre-seed','blockchain angel investment','web3 crowdfunding','defi community raise','crypto dao raise'],
  // ── Batch 35-39: Hiring signals
  ['crypto company hiring','blockchain startup jobs','web3 remote jobs','defi open positions','nft company careers'],
  ['blockchain engineer wanted','web3 developer job','crypto cto hire','defi protocol hiring','nft project hiring'],
  ['crypto company team','blockchain about us','web3 team page','defi our team','nft project founders'],
  ['bitcoin company leadership','blockchain executive team','web3 management team','defi founders','crypto co-founders'],
  ['blockchain developer conference','crypto summit speaker','web3 event keynote','defi conference panelist','bitcoin conference'],
  // ── Batch 40-44: Content signals
  ['crypto founder blog','blockchain ceo medium','web3 founder substack','defi protocol blog','bitcoin entrepreneur newsletter'],
  ['blockchain thought leader','crypto twitter','web3 influencer','defi researcher','bitcoin analyst podcast'],
  ['blockchain white paper author','crypto protocol docs','web3 technical founder','defi researcher email','bitcoin developer'],
  ['crypto youtube founder','blockchain linkedin founder','web3 twitter founder','defi discord founder','bitcoin telegram'],
  ['crypto interview','blockchain founder story','web3 startup story','defi founder profile','nft creator spotlight'],
  // ── Batch 45-49: Specific niches
  ['rwa tokenization','real world assets blockchain','tokenized securities founder','security token platform','crypto cap table'],
  ['depin network founder','decentralized physical infrastructure','iot blockchain','helium network','crypto connectivity'],
  ['crypto derivatives exchange','perpetual futures crypto','options protocol defi','structured products defi','crypto derivatives founder'],
  ['cross-chain bridge founder','blockchain interoperability','multi-chain protocol','omnichain founder','cross-chain defi'],
  ['crypto wallet developer','self-custody founder','hardware wallet','browser extension wallet','mobile crypto wallet'],
  // ── Batch 50-54: Professional services
  ['crypto cpa accountant','blockchain tax advisor','crypto portfolio manager','digital asset wealth manager','bitcoin financial advisor'],
  ['blockchain recruiting firm','crypto headhunter','web3 talent agency','defi executive search','crypto cxo recruiter'],
  ['crypto pr agency','blockchain communications','web3 marketing agency','defi growth agency','nft marketing firm'],
  ['blockchain audit firm','smart contract auditor','defi security researcher','crypto penetration tester','web3 security'],
  ['crypto events company','blockchain conference organizer','web3 summit organizer','defi hackathon organizer','crypto meetup'],
  // ── Batch 55-59: Emerging areas
  ['ai crypto founder','ai blockchain company','machine learning defi','crypto ai startup','web3 ai agent'],
  ['defi structured products','crypto yield farming','liquidity provision defi','market maker crypto','crypto quantitative'],
  ['staking service provider','liquid staking protocol','validator operator','crypto node operator','staking rewards'],
  ['crypto custody solution','institutional crypto','digital asset custody','cold storage provider','crypto prime broker'],
  ['web3 infrastructure','blockchain node service','rpc provider crypto','indexer protocol','blockchain data provider'],
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

function newPrisma() {
  return new PrismaClient({ log: [] });
}

async function countLeads(): Promise<number> {
  const p = newPrisma();
  try {
    return await p.lead.count({ where: { teamId: TEAM_ID, status: { not: 'ARCHIVED' } } });
  } finally { await p.$disconnect(); }
}

async function runBatch(batchIdx: number): Promise<number> {
  const kw  = KEYWORD_BATCHES[batchIdx % KEYWORD_BATCHES.length]!;
  const src = SOURCE_SETS[batchIdx % SOURCE_SETS.length]!;

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
        const pu = newPrisma();
        await pu.extractionJob.update({
          where: { id: jobId },
          data: { progress, leadsFound, pagesScraped },
        }).catch(() => {}).finally(() => pu.$disconnect());
      }
    },
  });

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
  console.log(`Target: ${TARGET}  |  Per-batch: ${BATCH_TARGET}  |  Starting at batch ${START_BATCH + 1}`);
  console.log(`Team  : ${TEAM_ID}`);

  let total = await countLeads();
  console.log(`Current clean leads: ${total}\n`);

  let batchIdx = START_BATCH;

  while (total < TARGET) {
    const before    = total;
    const scraped   = await runBatch(batchIdx);
    total           = await countLeads();
    const net       = total - before;
    const elapsed   = ((Date.now() - start) / 60000).toFixed(1);
    const pct       = Math.min(100, (total / TARGET) * 100).toFixed(1);

    console.log(`\n  ✅ Batch ${batchIdx + 1}: scraped ${scraped} | net new: +${net} | total: ${total}/${TARGET} (${pct}%)`);
    console.log(`  [${bar((total / TARGET) * 100)}]  ${elapsed}min`);

    if (total >= TARGET) break;
    batchIdx++;
    await new Promise(r => setTimeout(r, 2000));
  }

  const elapsed = ((Date.now() - start) / 60000).toFixed(1);
  console.log('\n━━━ DONE ━━━');
  console.log(`Total leads: ${total}  |  Time: ${elapsed}min`);
  console.log('Export: https://leadforge-ai-tawny.vercel.app/leads');
}

main().catch(e => { console.error('Fatal:', e.message ?? e); process.exit(1); });
