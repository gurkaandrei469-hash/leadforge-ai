import { Router } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { prisma } from '../../db/prisma.js';

const r = Router();

r.post('/', authenticate, requireRole('OWNER', 'ADMIN'), async (req, res, next) => {
  try {
    const body = z.object({
      url: z.string().url(),
      events: z.array(z.enum(['job.completed', 'job.failed', 'lead.created', 'verification.completed', 'export.ready'])),
    }).parse(req.body);

    const hook = await prisma.webhook.create({
      data: {
        teamId: req.auth!.teamId,
        url: body.url,
        events: body.events,
        secret: crypto.randomBytes(32).toString('hex'),
      },
    });
    res.status(201).json({ webhook: hook });
  } catch (e) { next(e); }
});

r.get('/', authenticate, async (req, res, next) => {
  try {
    const hooks = await prisma.webhook.findMany({ where: { teamId: req.auth!.teamId } });
    res.json({ webhooks: hooks });
  } catch (e) { next(e); }
});

r.delete('/:id', authenticate, requireRole('OWNER', 'ADMIN'), async (req, res, next) => {
  try {
    await prisma.webhook.deleteMany({
      where: { id: req.params.id, teamId: req.auth!.teamId },
    });
    res.status(204).end();
  } catch (e) { next(e); }
});

export default r;
