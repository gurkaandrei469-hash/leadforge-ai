import { Router } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { authenticate, requireRole, hashApiKey } from '../../middleware/auth.js';
import { prisma } from '../../db/prisma.js';
import { Errors } from '../../utils/errors.js';

const r = Router();

const generateKey = () => {
  const raw = crypto.randomBytes(32).toString('base64url');
  return `lf_${raw}`;
};

r.post('/', authenticate, requireRole('OWNER', 'ADMIN'), async (req, res, next) => {
  try {
    const body = z.object({
      name: z.string().min(2).max(80),
      scopes: z.array(z.string()).default(['leads:read', 'jobs:read', 'verification:read']),
      expiresAt: z.string().datetime().optional(),
    }).parse(req.body);

    const plainKey = generateKey();
    const record = await prisma.apiKey.create({
      data: {
        teamId: req.auth!.teamId,
        userId: req.auth!.userId,
        name: body.name,
        keyHash: hashApiKey(plainKey),
        keyPrefix: plainKey.slice(0, 12),
        scopes: body.scopes,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      },
    });

    res.status(201).json({ apiKey: { ...record, key: plainKey } });
  } catch (e) { next(e); }
});

r.get('/', authenticate, async (req, res, next) => {
  try {
    const keys = await prisma.apiKey.findMany({
      where: { teamId: req.auth!.teamId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, keyPrefix: true, scopes: true, lastUsedAt: true, expiresAt: true, createdAt: true },
    });
    res.json({ apiKeys: keys });
  } catch (e) { next(e); }
});

r.delete('/:id', authenticate, requireRole('OWNER', 'ADMIN'), async (req, res, next) => {
  try {
    const found = await prisma.apiKey.findFirst({
      where: { id: req.params.id, teamId: req.auth!.teamId },
    });
    if (!found) throw Errors.notFound('API key');
    await prisma.apiKey.update({
      where: { id: req.params.id },
      data: { revokedAt: new Date() },
    });
    res.status(204).end();
  } catch (e) { next(e); }
});

export default r;
