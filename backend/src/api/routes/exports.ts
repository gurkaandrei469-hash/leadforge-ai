import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { prisma } from '../../db/prisma.js';
import { FilterSchema } from '../../filters/types.js';
import { exportQueue } from '../../workers/queues.js';

const r = Router();

r.post('/', authenticate, async (req, res, next) => {
  try {
    const body = z.object({
      format: z.enum(['CSV', 'XLSX', 'JSON']),
      filter: FilterSchema.optional(),
      leadIds: z.array(z.string()).optional(),
      jobId: z.string().optional(),
    }).parse(req.body);

    const exp = await prisma.export.create({
      data: {
        teamId: req.auth!.teamId,
        format: body.format,
        jobId: body.jobId,
        filters: body.filter ?? null,
        status: 'PENDING',
      },
    });

    await exportQueue.add('export', {
      exportId: exp.id,
      teamId: req.auth!.teamId,
      format: body.format,
      filter: body.filter,
      leadIds: body.leadIds,
      jobId: body.jobId,
    });

    res.status(202).json({ export: exp });
  } catch (e) { next(e); }
});

r.get('/', authenticate, async (req, res, next) => {
  try {
    const exports = await prisma.export.findMany({
      where: { teamId: req.auth!.teamId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ exports });
  } catch (e) { next(e); }
});

r.get('/:id', authenticate, async (req, res, next) => {
  try {
    const exp = await prisma.export.findFirst({
      where: { id: req.params.id, teamId: req.auth!.teamId },
    });
    res.json({ export: exp });
  } catch (e) { next(e); }
});

export default r;
