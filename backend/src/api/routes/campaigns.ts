import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { prisma } from '../../db/prisma.js';
import { Errors } from '../../utils/errors.js';
import { campaignQueue } from '../../workers/queues.js';

const r = Router();

const StepInput = z.object({
  order: z.number().int().min(0),
  delayDays: z.number().int().min(0).max(60).default(0),
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(20_000),
});

const CreateCampaign = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  sendingAccountId: z.string().optional(),
  dailyLimit: z.number().int().min(1).max(2000).default(50),
  sendStartHour: z.number().int().min(0).max(23).default(9),
  sendEndHour:   z.number().int().min(0).max(23).default(17),
  weekdaysOnly:  z.boolean().default(true),
  steps: z.array(StepInput).min(1).max(20),
});

r.post('/', authenticate, async (req, res, next) => {
  try {
    const body = CreateCampaign.parse(req.body);

    // Validate sending account belongs to team
    if (body.sendingAccountId) {
      const acc = await prisma.sendingAccount.findFirst({
        where: { id: body.sendingAccountId, teamId: req.auth!.teamId },
      });
      if (!acc) throw Errors.badRequest('Sending account not found');
    }

    const { steps, ...campaignData } = body;
    const campaign = await prisma.campaign.create({
      data: {
        teamId: req.auth!.teamId,
        createdById: req.auth!.userId,
        ...campaignData,
        steps: { create: steps },
      },
      include: { steps: { orderBy: { order: 'asc' } } },
    });
    res.status(201).json({ campaign });
  } catch (e) { next(e); }
});

r.get('/', authenticate, async (req, res, next) => {
  try {
    const campaigns = await prisma.campaign.findMany({
      where: { teamId: req.auth!.teamId },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { steps: true, recipients: true } },
        sendingAccount: { select: { name: true, fromEmail: true } },
      },
    });
    res.json({
      campaigns: campaigns.map((c) => ({
        id: c.id, name: c.name, description: c.description, status: c.status,
        recipientCount: c.recipientCount, sentCount: c.sentCount, openedCount: c.openedCount,
        clickedCount: c.clickedCount, repliedCount: c.repliedCount, bouncedCount: c.bouncedCount,
        stepCount: c._count.steps, totalRecipients: c._count.recipients,
        sendingAccount: c.sendingAccount,
        createdAt: c.createdAt, launchedAt: c.launchedAt, completedAt: c.completedAt,
      })),
    });
  } catch (e) { next(e); }
});

r.get('/:id', authenticate, async (req, res, next) => {
  try {
    const campaign = await prisma.campaign.findFirst({
      where: { id: req.params.id, teamId: req.auth!.teamId },
      include: {
        steps: { orderBy: { order: 'asc' } },
        sendingAccount: { select: { id: true, name: true, fromName: true, fromEmail: true, provider: true, dailyLimit: true, sentToday: true } },
        _count: { select: { recipients: true, sends: true } },
      },
    });
    if (!campaign) throw Errors.notFound('Campaign');
    res.json({ campaign });
  } catch (e) { next(e); }
});

r.patch('/:id', authenticate, async (req, res, next) => {
  try {
    const body = z.object({
      name: z.string().min(1).max(120).optional(),
      description: z.string().max(500).nullable().optional(),
      sendingAccountId: z.string().nullable().optional(),
      dailyLimit: z.number().int().min(1).max(2000).optional(),
    }).parse(req.body);

    const found = await prisma.campaign.findFirst({
      where: { id: req.params.id, teamId: req.auth!.teamId },
    });
    if (!found) throw Errors.notFound('Campaign');
    if (found.status === 'RUNNING') throw Errors.badRequest('Pause first to edit');

    // Verify any new sending account actually belongs to this team and is active
    if (body.sendingAccountId) {
      const acc = await prisma.sendingAccount.findFirst({
        where: { id: body.sendingAccountId, teamId: req.auth!.teamId },
      });
      if (!acc) throw Errors.notFound('Sending account');
      if (!acc.isActive) throw Errors.badRequest('That sending account is paused.');
    }

    const campaign = await prisma.campaign.update({ where: { id: req.params.id }, data: body });
    res.json({ campaign });
  } catch (e) { next(e); }
});

r.delete('/:id', authenticate, async (req, res, next) => {
  try {
    await prisma.campaign.deleteMany({ where: { id: req.params.id, teamId: req.auth!.teamId } });
    res.status(204).end();
  } catch (e) { next(e); }
});

// Add leads as recipients (idempotent — duplicates skipped)
r.post('/:id/recipients', authenticate, async (req, res, next) => {
  try {
    const body = z.object({
      leadIds: z.array(z.string()).optional(),
      listId: z.string().optional(),
    }).refine((d) => d.leadIds?.length || d.listId, 'Provide leadIds or listId').parse(req.body);

    const campaign = await prisma.campaign.findFirst({
      where: { id: req.params.id, teamId: req.auth!.teamId },
    });
    if (!campaign) throw Errors.notFound('Campaign');

    let leadIds = body.leadIds ?? [];
    if (body.listId) {
      const list = await prisma.leadList.findFirst({
        where: { id: body.listId, teamId: req.auth!.teamId },
        include: { memberships: { select: { leadId: true } } },
      });
      if (!list) throw Errors.notFound('List');
      leadIds = list.memberships.map((m) => m.leadId);
    }

    // Filter to leads with valid emails + this team
    const validLeads = await prisma.lead.findMany({
      where: { id: { in: leadIds }, teamId: req.auth!.teamId, email: { not: null } },
      select: { id: true },
    });

    const result = await prisma.campaignRecipient.createMany({
      data: validLeads.map((l) => ({ campaignId: campaign.id, leadId: l.id })),
      skipDuplicates: true,
    });

    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { recipientCount: { increment: result.count } },
    });

    res.json({ added: result.count, requested: leadIds.length });
  } catch (e) { next(e); }
});

r.post('/:id/launch', authenticate, async (req, res, next) => {
  try {
    const campaign = await prisma.campaign.findFirst({
      where: { id: req.params.id, teamId: req.auth!.teamId },
      include: { _count: { select: { recipients: true, steps: true } } },
    });
    if (!campaign) throw Errors.notFound('Campaign');
    if (!campaign.sendingAccountId) throw Errors.badRequest('Pick a sending account first');
    if (campaign._count.steps === 0) throw Errors.badRequest('Add at least one step');
    if (campaign._count.recipients === 0) throw Errors.badRequest('Add recipients first');
    if (campaign.status === 'RUNNING') throw Errors.badRequest('Already running');

    const updated = await prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: 'RUNNING', launchedAt: new Date() },
    });

    // Set initial nextSendAt for all QUEUED recipients
    await prisma.campaignRecipient.updateMany({
      where: { campaignId: campaign.id, status: 'QUEUED' },
      data: { nextSendAt: new Date() },
    });

    // Kick the worker
    await campaignQueue.add('tick', { campaignId: campaign.id }, { delay: 1000 });

    res.json({ campaign: updated });
  } catch (e) { next(e); }
});

r.post('/:id/pause', authenticate, async (req, res, next) => {
  try {
    const c = await prisma.campaign.findFirst({ where: { id: req.params.id, teamId: req.auth!.teamId } });
    if (!c) throw Errors.notFound('Campaign');
    const updated = await prisma.campaign.update({ where: { id: c.id }, data: { status: 'PAUSED' } });
    res.json({ campaign: updated });
  } catch (e) { next(e); }
});

r.get('/:id/recipients', authenticate, async (req, res, next) => {
  try {
    const c = await prisma.campaign.findFirst({ where: { id: req.params.id, teamId: req.auth!.teamId } });
    if (!c) throw Errors.notFound('Campaign');
    const recipients = await prisma.campaignRecipient.findMany({
      where: { campaignId: c.id },
      orderBy: { addedAt: 'desc' },
      take: 200,
      include: {
        lead: { select: { id: true, email: true, fullName: true, companyName: true, qualityScore: true } },
        _count: { select: { sends: true } },
      },
    });
    res.json({ recipients });
  } catch (e) { next(e); }
});

/**
 * Live activity feed for the campaign page. Returns the last N EmailSend records (newest first)
 * with their tracking events flattened in, plus a few derived stats so the UI can show progress
 * without doing math.
 */
r.get('/:id/activity', authenticate, async (req, res, next) => {
  try {
    const c = await prisma.campaign.findFirst({ where: { id: req.params.id, teamId: req.auth!.teamId } });
    if (!c) throw Errors.notFound('Campaign');

    const [sends, queued, inProgress, sentTotal, failedTotal] = await Promise.all([
      prisma.emailSend.findMany({
        where: { campaignId: c.id },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          recipient: { include: { lead: { select: { email: true, fullName: true } } } },
          events: { orderBy: { createdAt: 'desc' }, take: 5 },
        },
      }),
      prisma.campaignRecipient.count({ where: { campaignId: c.id, status: 'QUEUED' } }),
      prisma.campaignRecipient.count({ where: { campaignId: c.id, status: 'IN_PROGRESS' } }),
      prisma.emailSend.count({ where: { campaignId: c.id, status: 'SENT' } }),
      prisma.emailSend.count({ where: { campaignId: c.id, status: 'FAILED' } }),
    ]);

    const activity = sends.map((s) => ({
      id: s.id,
      status: s.status,
      toEmail: s.toEmail,
      leadName: s.recipient.lead.fullName ?? null,
      subject: s.subject,
      errorMessage: s.errorMessage ?? null,
      createdAt: s.createdAt,
      sentAt: s.sentAt,
      openedAt: s.openedAt,
      clickedAt: s.clickedAt,
      repliedAt: s.repliedAt,
      events: s.events.map((e) => ({ id: e.id, type: e.type, createdAt: e.createdAt })),
    }));

    res.json({
      activity,
      stats: { queued, inProgress, sent: sentTotal, failed: failedTotal },
      lastTickAt: new Date(),
    });
  } catch (e) { next(e); }
});

export default r;
