/**
 * Domain Hunter CLI — Hunter.io-style engine.
 * Usage: DOMAINS="breezeline.net:Breezeline,metrocast.net:Metrocast" npx tsx src/scripts/run-domain-hunt.ts
 */
import { huntDomain } from '../intelligence/domain-hunter/index.js';
import { PrismaClient } from '@prisma/client';

const TEAM_ID    = 'cmpn9ul0f0002ickxqindqgn3';
const CREATED_BY = 'cmpn9uks10000ickxq1ilgsu8';
const TARGET     = Number(process.env.TARGET ?? '3000');

const DOMAIN_LIST: Array<{ domain: string; company: string }> = (process.env.DOMAINS ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)
  .map(s => {
    const [domain, ...nameParts] = s.split(':');
    return { domain: domain!.trim(), company: nameParts.join(':').trim() || domain!.trim() };
  });

function bar(pct: number, w = 40) {
  const f = Math.min(w, Math.floor((pct / 100) * w));
  return '█'.repeat(f) + '░'.repeat(w - f);
}

function newPrisma() { return new PrismaClient({ log: [] }); }

async function countSaved(domains: string[]): Promise<number> {
  const p = newPrisma();
  try {
    const counts = await Promise.all(domains.map(d =>
      p.lead.count({ where: { teamId: TEAM_ID, status: { not: 'ARCHIVED' }, emailNormalized: { endsWith: '@' + d } } })
    ));
    return counts.reduce((a, b) => a + b, 0);
  } finally { await p.$disconnect(); }
}

async function createJob(domain: string, company: string): Promise<string> {
  const p = newPrisma();
  try {
    const job = await p.extractionJob.create({
      data: {
        teamId: TEAM_ID,
        createdById: CREATED_BY,
        name: `Domain Hunt — ${domain}`,
        sources: ['COMPANY_PAGE'],
        filters: { domain, company },
        targetLeads: TARGET,
        priority: 'URGENT',
        status: 'RUNNING',
        startedAt: new Date(),
      },
    });
    return job.id;
  } finally { await p.$disconnect(); }
}

async function main() {
  console.log('\n━━━ LeadForge Domain Hunter ━━━');
  console.log(`Engine: crawl → pattern detect → employee find → SMTP verify`);
  console.log(`Target: ${TARGET} verified leads`);
  console.log(`Domains: ${DOMAIN_LIST.map(d => d.domain).join(' | ')}\n`);

  let totalSaved = 0;

  for (const { domain, company } of DOMAIN_LIST) {
    if (totalSaved >= TARGET) break;

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`🔍 Hunting: ${domain} (${company})`);
    console.log(`${'─'.repeat(60)}`);

    const jobId = await createJob(domain, company);
    const perDomainTarget = Math.ceil((TARGET - totalSaved) / (DOMAIN_LIST.length));

    let lastStage = '';
    const result = await huntDomain({
      domain,
      companyName: company,
      teamId: TEAM_ID,
      createdById: CREATED_BY,
      jobId,
      targetLeads: perDomainTarget,
      onProgress: (p) => {
        if (p.stage !== lastStage) {
          lastStage = p.stage;
          const stageLabel: Record<string, string> = {
            enriching:         '🔌  Querying enrichment APIs (Hunter + Apollo + PDL)...',
            enriched:          `✓  Enrichment: ${p.emailsFound} emails, ${p.employeesFound} employees`,
            crawling:          '🕷  Deep-crawling domain pages...',
            crawled:           `✓  Crawled ${p.pagesVisited} pages, found ${p.emailsFound} real emails`,
            pattern:           `✓  Email pattern detected`,
            finding_employees: '👥  Web search: LinkedIn + team pages...',
            employees_found:   `✓  Total employees merged: ${p.employeesFound}`,
            verifying:         `⚡  SMTP-verifying candidates (8 concurrent)...`,
          };
          if (stageLabel[p.stage]) console.log(`  ${stageLabel[p.stage]}`);
        }
        if (p.stage === 'verifying' && p.candidatesGenerated) {
          const pct = ((p.verified ?? 0) / p.candidatesGenerated) * 100;
          process.stdout.write(
            `\r  [${bar(pct, 30)}] ${p.verified}/${p.candidatesGenerated} verified  ✅ saved: ${p.saved}   `
          );
        }
      },
    });

    process.stdout.write('\n');
    console.log(`\n  📊 Results for ${domain}:`);
    console.log(`     Real emails found    : ${result.emailsDiscovered}`);
    console.log(`     Email pattern        : ${result.pattern} (${(result.patternConfidence * 100).toFixed(0)}% confidence)`);
    console.log(`     Employees discovered : ${result.employeesFound}`);
    console.log(`     Candidates generated : ${result.candidatesGenerated}`);
    console.log(`     SMTP verified        : ${result.verified}`);
    console.log(`     Leads saved          : ${result.saved}`);

    totalSaved += result.saved;
    const current = await countSaved(DOMAIN_LIST.map(d => d.domain));
    const pct = Math.min(100, (current / TARGET) * 100).toFixed(1);
    console.log(`\n  Total so far: ${current}/${TARGET} (${pct}%)`);
    console.log(`  [${bar((current / TARGET) * 100)}]`);
  }

  const final = await countSaved(DOMAIN_LIST.map(d => d.domain));
  console.log(`\n━━━ HUNT COMPLETE ━━━`);
  console.log(`Total verified leads: ${final}`);
  console.log(`View: https://leadforge-ai-tawny.vercel.app/leads`);
}

main().catch(e => { console.error('Fatal:', e.message ?? e); process.exit(1); });
