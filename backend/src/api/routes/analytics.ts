import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { prisma } from '../../db/prisma.js';

const r = Router();

r.get('/overview', authenticate, async (req, res, next) => {
  try {
    const teamId = req.auth!.teamId;
    const since30d = new Date(Date.now() - 30 * 86400_000);

    const [team, leadTotals, jobsRunning, jobsDone, recentLeads] = await Promise.all([
      prisma.team.findUnique({
        where: { id: teamId },
        select: { creditsTotal: true, creditsUsed: true, planTier: true },
      }),
      prisma.lead.groupBy({
        by: ['verificationStatus'],
        where: { teamId },
        _count: { _all: true },
      }),
      prisma.extractionJob.count({ where: { teamId, status: 'RUNNING' } }),
      prisma.extractionJob.count({ where: { teamId, status: 'COMPLETED', createdAt: { gte: since30d } } }),
      prisma.lead.count({ where: { teamId, createdAt: { gte: since30d } } }),
    ]);

    res.json({
      team,
      leadCounts: leadTotals.reduce<Record<string, number>>((acc, r) => {
        acc[r.verificationStatus] = r._count._all;
        return acc;
      }, {}),
      jobsRunning,
      jobsCompleted30d: jobsDone,
      leadsAcquired30d: recentLeads,
    });
  } catch (e) { next(e); }
});

r.get('/leads-timeseries', authenticate, async (req, res, next) => {
  try {
    const teamId = req.auth!.teamId;
    const days = 30;
    const since = new Date(Date.now() - days * 86400_000);
    const rows = await prisma.$queryRawUnsafe<{ day: Date; count: bigint }[]>(
      `SELECT date_trunc('day', "createdAt") as day, COUNT(*)::bigint as count
       FROM "Lead" WHERE "teamId" = $1 AND "createdAt" >= $2
       GROUP BY 1 ORDER BY 1`,
      teamId, since,
    );
    res.json({
      series: rows.map((r) => ({ day: r.day, count: Number(r.count) })),
    });
  } catch (e) { next(e); }
});

r.get('/quality-distribution', authenticate, async (req, res, next) => {
  try {
    const teamId = req.auth!.teamId;
    // Buckets: 0-20, 21-40, 41-60, 61-80, 81-100
    const rows = await prisma.$queryRawUnsafe<{ bucket: number; count: bigint }[]>(
      `SELECT
         CASE
           WHEN "qualityScore" <= 20 THEN 20
           WHEN "qualityScore" <= 40 THEN 40
           WHEN "qualityScore" <= 60 THEN 60
           WHEN "qualityScore" <= 80 THEN 80
           ELSE 100
         END AS bucket,
         COUNT(*)::bigint AS count
       FROM "Lead"
       WHERE "teamId" = $1 AND "qualityScore" IS NOT NULL
       GROUP BY 1 ORDER BY 1`,
      teamId,
    );
    res.json({
      buckets: rows.map((r) => ({ bucket: r.bucket, count: Number(r.count) })),
    });
  } catch (e) { next(e); }
});

r.get('/sources', authenticate, async (req, res, next) => {
  try {
    const teamId = req.auth!.teamId;
    const rows = await prisma.lead.groupBy({
      by: ['sourceType'],
      where: { teamId },
      _count: { _all: true },
      orderBy: { _count: { sourceType: 'desc' } },
    });
    res.json({ sources: rows.map((r) => ({ source: r.sourceType, count: r._count._all })) });
  } catch (e) { next(e); }
});

r.get('/top-niches', authenticate, async (req, res, next) => {
  try {
    const teamId = req.auth!.teamId;
    const rows = await prisma.lead.groupBy({
      by: ['niche'],
      where: { teamId, niche: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { niche: 'desc' } },
      take: 10,
    });
    res.json({ niches: rows.map((r) => ({ niche: r.niche, count: r._count._all })) });
  } catch (e) { next(e); }
});

export default r;
