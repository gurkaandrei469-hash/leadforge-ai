import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.upsert({
    where: { email: 'demo@leadforge.ai' },
    create: { clerkId: 'demo_user_clerk_id', email: 'demo@leadforge.ai', fullName: 'Demo User', emailVerified: true },
    update: {},
  });

  const team = await prisma.team.upsert({
    where: { slug: 'demo' },
    create: {
      name: 'Demo Team',
      slug: 'demo',
      ownerId: user.id,
      planTier: 'PRO',
      creditsTotal: 12_000,
      memberships: { create: { userId: user.id, role: 'OWNER' } },
    },
    update: {},
  });

  await prisma.lead.createMany({
    skipDuplicates: true,
    data: Array.from({ length: 30 }).map((_, i) => ({
      teamId: team.id,
      email: `demo${i}@example.com`,
      emailNormalized: `demo${i}@example.com`,
      fullName: `Demo Lead ${i}`,
      jobTitle: ['CEO', 'CTO', 'Head of Growth', 'Marketing Manager'][i % 4],
      companyName: `Company ${i}`,
      companyDomain: `company${i}.com`,
      country: ['US', 'DE', 'UK', 'CA'][i % 4],
      sourceType: 'WEB_SEARCH',
      sourceUrl: `https://example.com/page-${i}`,
      qualityScore: 50 + (i % 50),
      verificationStatus: 'VALID',
    })),
  });

  console.log('Seeded:', { userId: user.id, teamId: team.id });
}

main().finally(() => prisma.$disconnect());
