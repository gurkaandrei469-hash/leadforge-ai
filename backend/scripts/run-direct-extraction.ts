import { runExtraction } from './src/scraping/orchestrator.js';
import { prisma } from './src/db/prisma.js';

const jobId = process.env.JOB_ID!;
const job = await prisma.extractionJob.findUnique({ where: { id: jobId } });
if (!job) { console.log('Job not found'); process.exit(1); }

await prisma.extractionJob.update({ where: { id: jobId }, data: { status: 'RUNNING', startedAt: new Date() } });

let lastPages = -1;
await runExtraction({
  jobId,
  teamId: job.teamId,
  sources: job.sources as any,
  filters: job.filters as any,
  targetLeads: job.targetLeads,
  priority: job.priority as any,
  onProgress: async ({ progress, leadsFound, pagesScraped }) => {
    if (pagesScraped !== lastPages) {
      lastPages = pagesScraped;
      const bar = '█'.repeat(Math.floor(progress / 5)) + '░'.repeat(20 - Math.floor(progress / 5));
      const emoji = leadsFound > 0 ? '🔥' : '⚙️';
      console.log(`${emoji} [${bar}] ${progress.toFixed(0)}%  pages=${pagesScraped}  found=${leadsFound}`);
      await prisma.extractionJob.update({ where: { id: jobId }, data: { progress, leadsFound, pagesScraped } });
    }
  },
});

await prisma.extractionJob.update({
  where: { id: jobId },
  data: { status: 'COMPLETED', completedAt: new Date(), progress: 100 },
});
const final = await prisma.extractionJob.findUnique({ where: { id: jobId } });
console.log(`\n✅ DONE: ${final?.leadsFound} leads found, ${final?.pagesScraped} pages scraped`);
console.log(`View: https://leadforge-ai-tawny.vercel.app/jobs/${jobId}`);
