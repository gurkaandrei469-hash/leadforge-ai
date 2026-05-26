import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { prisma } from '../../db/prisma.js';

const r = Router();

// Note: real admin requires platform-level role beyond team role; placeholder gate.
r.get('/teams', authenticate, requireRole('OWNER'), async (_req, res, next) => {
  try {
    const teams = await prisma.team.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { _count: { select: { memberships: true, leads: true } } },
    });
    res.json({ teams });
  } catch (e) { next(e); }
});

r.get('/jobs', authenticate, requireRole('OWNER'), async (_req, res, next) => {
  try {
    const jobs = await prisma.extractionJob.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json({ jobs });
  } catch (e) { next(e); }
});

r.get('/audit', authenticate, requireRole('OWNER', 'ADMIN'), async (req, res, next) => {
  try {
    const rows = await prisma.auditLog.findMany({
      where: { teamId: req.auth!.teamId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json({ logs: rows });
  } catch (e) { next(e); }
});

export default r;
