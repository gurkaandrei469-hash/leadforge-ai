import pLimit from 'p-limit';
import { prisma } from '../db/prisma.js';
import { logger } from '../utils/logger.js';
import { matchInMemory } from '../filters/engine.js';
import { verificationQueue, enrichmentQueue } from '../workers/queues.js';
import type { Filter } from '../filters/types.js';
import { discoverSources } from './discovery.js';
import { scrapePage } from './scraper.js';
import { extractLeads } from './extractor.js';
import { findLinkedInProfile } from './searchEngines.js';

interface RunArgs {
  jobId: string;
  teamId: string;
  sources: any[];
  filters: Filter;
  targetLeads: number;
  onProgress: (p: { progress: number; leadsFound: number; pagesScraped: number; eta?: Date }) => Promise<void>;
}

const CONCURRENCY = 4;

export async function runExtraction(args: RunArgs) {
  const limit = pLimit(CONCURRENCY);
  const urls = await discoverSources(args.sources, args.filters);

  let leadsFound = 0;
  let pagesScraped = 0;
  const start = Date.now();

  const visited = new Set<string>();

  await Promise.all(
    urls.map((url) =>
      limit(async () => {
        if (leadsFound >= args.targetLeads) return;
        if (visited.has(url)) return;
        visited.add(url);

        try {
          const page = await scrapePage(url);
          pagesScraped++;
          const candidates = extractLeads(page);

          for (const c of candidates) {
            if (leadsFound >= args.targetLeads) break;
            if (!matchInMemory(args.filters, c)) continue;

            const lead = await prisma.lead.upsert({
              where: { teamId_emailNormalized: { teamId: args.teamId, emailNormalized: c.email?.toLowerCase() ?? `__none_${Date.now()}_${Math.random()}` } },
              create: {
                teamId: args.teamId,
                jobId: args.jobId,
                ...c,
                emailNormalized: c.email?.toLowerCase() ?? null,
                status: 'NEW',
              },
              update: { jobId: args.jobId },
            });

            leadsFound++;

            if (lead.email) {
              await verificationQueue.add('verify', { leadId: lead.id, email: lead.email, teamId: args.teamId });
            }
            await enrichmentQueue.add('classify', { leadId: lead.id, teamId: args.teamId });

            // Best-effort LinkedIn URL discovery via free DuckDuckGo search.
            // Skip if we already have one, or the lead is anonymous (no name).
            if (!lead.linkedinUrl && lead.fullName && lead.fullName.length > 3) {
              findLinkedInProfile(lead.fullName, lead.companyName ?? undefined)
                .then(async (linkedinUrl) => {
                  if (linkedinUrl) {
                    await prisma.lead.update({ where: { id: lead.id }, data: { linkedinUrl } });
                  }
                })
                .catch(() => {});
            }
          }

          const progress = Math.min(99, (leadsFound / args.targetLeads) * 100);
          const elapsed = Date.now() - start;
          const eta = leadsFound > 0 ? new Date(Date.now() + (elapsed / leadsFound) * (args.targetLeads - leadsFound)) : undefined;
          await args.onProgress({ progress, leadsFound, pagesScraped, eta });
        } catch (err) {
          logger.warn({ err, url }, 'scrape error');
        }
      }),
    ),
  );
}
