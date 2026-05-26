// One-shot script: creates an ExtractionJob targeted at the local demo pages
// and enqueues it. Uses the seeded "Demo Team" so no auth needed.
import { prisma } from '../src/db/prisma.js';
import { extractionQueue } from '../src/workers/queues.js';

const URLS = [
  'http://localhost:8765/acme-saas.html',
  'http://localhost:8765/orbital-labs.html',
  'http://localhost:8765/retailpro-shop.html',
];

async function main() {
  const team = await prisma.team.findFirst({ where: { slug: 'demo' } });
  if (!team) throw new Error('Demo team not found — run db:seed first');

  const job = await prisma.extractionJob.create({
    data: {
      teamId: team.id,
      createdById: team.ownerId,
      name: 'Live demo · local SaaS / e-commerce / AI team pages',
      sources: ['CUSTOM_URL_LIST'],
      // Filter encodes the URL list at top-level + an empty AND that matches anything
      filters: { __urls__: URLS, AND: [] } as any,
      targetLeads: 20,
      priority: 'HIGH',
      status: 'QUEUED',
    },
  });

  const bull = await extractionQueue.add(
    'extract',
    { jobId: job.id, teamId: job.teamId },
    { priority: 2, removeOnComplete: { age: 3600 } },
  );

  await prisma.extractionJob.update({
    where: { id: job.id },
    data: { bullJobId: bull.id?.toString() },
  });

  console.log(`✓ Job created: ${job.id}`);
  console.log(`✓ Enqueued as BullMQ job ${bull.id}`);
  console.log(`  Target: ${job.targetLeads} leads from ${URLS.length} URLs`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
