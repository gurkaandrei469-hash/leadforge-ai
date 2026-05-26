import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { prisma } from '../../db/prisma.js';
import { Errors } from '../../utils/errors.js';

const r = Router();

r.post('/', authenticate, async (req, res, next) => {
  try {
    const body = z.object({
      name: z.string().min(1).max(120),
      description: z.string().max(500).optional(),
      color: z.string().max(40).default('violet'),
    }).parse(req.body);

    const list = await prisma.leadList.create({
      data: {
        teamId: req.auth!.teamId,
        createdById: req.auth!.userId,
        ...body,
      },
    });
    res.status(201).json({ list });
  } catch (e) { next(e); }
});

r.get('/', authenticate, async (req, res, next) => {
  try {
    const lists = await prisma.leadList.findMany({
      where: { teamId: req.auth!.teamId },
      include: { _count: { select: { memberships: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({
      lists: lists.map((l) => ({
        id: l.id, name: l.name, description: l.description, color: l.color,
        leadCount: l._count.memberships, createdAt: l.createdAt, updatedAt: l.updatedAt,
      })),
    });
  } catch (e) { next(e); }
});

r.get('/:id', authenticate, async (req, res, next) => {
  try {
    const list = await prisma.leadList.findFirst({
      where: { id: req.params.id, teamId: req.auth!.teamId },
      include: {
        _count: { select: { memberships: true } },
        memberships: {
          orderBy: { addedAt: 'desc' },
          take: 200,
          include: {
            lead: {
              select: {
                id: true, email: true, fullName: true, jobTitle: true,
                companyName: true, country: true, qualityScore: true,
                verificationStatus: true, linkedinUrl: true, technologies: true,
              },
            },
          },
        },
      },
    });
    if (!list) throw Errors.notFound('List');
    res.json({
      list: {
        id: list.id, name: list.name, description: list.description, color: list.color,
        leadCount: list._count.memberships, createdAt: list.createdAt,
        leads: list.memberships.map((m) => ({ ...m.lead, addedAt: m.addedAt })),
      },
    });
  } catch (e) { next(e); }
});

r.patch('/:id', authenticate, async (req, res, next) => {
  try {
    const body = z.object({
      name: z.string().min(1).max(120).optional(),
      description: z.string().max(500).nullable().optional(),
      color: z.string().max(40).optional(),
    }).parse(req.body);

    const existing = await prisma.leadList.findFirst({
      where: { id: req.params.id, teamId: req.auth!.teamId },
    });
    if (!existing) throw Errors.notFound('List');

    const list = await prisma.leadList.update({ where: { id: req.params.id }, data: body });
    res.json({ list });
  } catch (e) { next(e); }
});

r.delete('/:id', authenticate, async (req, res, next) => {
  try {
    await prisma.leadList.deleteMany({
      where: { id: req.params.id, teamId: req.auth!.teamId },
    });
    res.status(204).end();
  } catch (e) { next(e); }
});

r.post('/:id/add', authenticate, async (req, res, next) => {
  try {
    const body = z.object({ leadIds: z.array(z.string()).min(1).max(1000) }).parse(req.body);
    const list = await prisma.leadList.findFirst({
      where: { id: req.params.id, teamId: req.auth!.teamId },
    });
    if (!list) throw Errors.notFound('List');

    // Filter to leads in this team
    const validLeads = await prisma.lead.findMany({
      where: { id: { in: body.leadIds }, teamId: req.auth!.teamId },
      select: { id: true },
    });

    const result = await prisma.leadListMembership.createMany({
      data: validLeads.map((l) => ({ listId: list.id, leadId: l.id })),
      skipDuplicates: true,
    });
    res.json({ added: result.count, requested: body.leadIds.length });
  } catch (e) { next(e); }
});

r.post('/:id/remove', authenticate, async (req, res, next) => {
  try {
    const body = z.object({ leadIds: z.array(z.string()).min(1) }).parse(req.body);
    const list = await prisma.leadList.findFirst({
      where: { id: req.params.id, teamId: req.auth!.teamId },
    });
    if (!list) throw Errors.notFound('List');

    const result = await prisma.leadListMembership.deleteMany({
      where: { listId: list.id, leadId: { in: body.leadIds } },
    });
    res.json({ removed: result.count });
  } catch (e) { next(e); }
});

export default r;
