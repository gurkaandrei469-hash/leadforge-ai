import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { prisma } from '../../db/prisma.js';
import { Errors } from '../../utils/errors.js';
import { v4 as uuid } from 'uuid';

const r = Router();

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);

r.post('/', authenticate, async (req, res, next) => {
  try {
    const body = z.object({ name: z.string().min(2).max(60) }).parse(req.body);
    const slug = `${slugify(body.name)}-${uuid().slice(0, 6)}`;
    const team = await prisma.team.create({
      data: {
        name: body.name,
        slug,
        ownerId: req.auth!.userId,
        memberships: { create: { userId: req.auth!.userId, role: 'OWNER' } },
      },
    });
    res.status(201).json({ team });
  } catch (e) { next(e); }
});

r.get('/', authenticate, async (req, res, next) => {
  try {
    const teams = await prisma.team.findMany({
      where: { memberships: { some: { userId: req.auth!.userId } } },
      include: { _count: { select: { memberships: true, leads: true, jobs: true } } },
    });
    res.json({ teams });
  } catch (e) { next(e); }
});

r.get('/:id', authenticate, async (req, res, next) => {
  try {
    const team = await prisma.team.findFirst({
      where: { id: req.params.id, memberships: { some: { userId: req.auth!.userId } } },
      include: {
        memberships: { include: { user: { select: { id: true, email: true, fullName: true, avatarUrl: true } } } },
      },
    });
    if (!team) throw Errors.notFound('Team');
    res.json({ team });
  } catch (e) { next(e); }
});

r.patch('/:id', authenticate, requireRole('OWNER', 'ADMIN'), async (req, res, next) => {
  try {
    const body = z.object({ name: z.string().min(2).optional(), logoUrl: z.string().url().nullable().optional() }).parse(req.body);
    const team = await prisma.team.update({ where: { id: req.params.id }, data: body });
    res.json({ team });
  } catch (e) { next(e); }
});

r.post('/:id/invitations', authenticate, requireRole('OWNER', 'ADMIN'), async (req, res, next) => {
  try {
    const body = z.object({
      email: z.string().email(),
      role: z.enum(['ADMIN', 'MEMBER', 'VIEWER']).default('MEMBER'),
    }).parse(req.body);

    const inv = await prisma.invitation.create({
      data: {
        ...body,
        teamId: req.params.id,
        invitedById: req.auth!.userId,
        token: uuid(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    res.status(201).json({ invitation: inv });
  } catch (e) { next(e); }
});

r.delete('/:id/members/:userId', authenticate, requireRole('OWNER', 'ADMIN'), async (req, res, next) => {
  try {
    await prisma.teamMembership.delete({
      where: { userId_teamId: { userId: req.params.userId, teamId: req.params.id } },
    });
    res.status(204).end();
  } catch (e) { next(e); }
});

export default r;
