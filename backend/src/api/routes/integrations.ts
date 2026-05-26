import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { prisma } from '../../db/prisma.js';
import { Errors } from '../../utils/errors.js';
import { testHubspotToken, pushManyToHubspot } from '../../services/hubspot.js';

const r = Router();

// ─────────────────────────── HubSpot ───────────────────────────

const ConnectHubspotBody = z.object({
  access_token: z.string().min(20),
});

r.post('/hubspot/connect', authenticate, requireRole('OWNER', 'ADMIN'), async (req, res, next) => {
  try {
    const { access_token } = ConnectHubspotBody.parse(req.body);
    const test = await testHubspotToken(access_token);
    if (!test.ok) throw Errors.badRequest(`HubSpot rejected the token: ${test.error}`);

    const connection = await prisma.crmConnection.upsert({
      where: { teamId_provider: { teamId: req.auth!.teamId, provider: 'HUBSPOT' } },
      create: {
        teamId: req.auth!.teamId,
        provider: 'HUBSPOT',
        accessToken: access_token,
        accountLabel: test.accountLabel,
        isActive: true,
      },
      update: {
        accessToken: access_token,
        accountLabel: test.accountLabel,
        isActive: true,
      },
    });
    res.json({
      connection: {
        id: connection.id,
        provider: connection.provider,
        accountLabel: connection.accountLabel,
        isActive: connection.isActive,
        totalPushed: connection.totalPushed,
        lastSyncAt: connection.lastSyncAt,
      },
    });
  } catch (e) { next(e); }
});

r.delete('/hubspot', authenticate, requireRole('OWNER', 'ADMIN'), async (req, res, next) => {
  try {
    await prisma.crmConnection.deleteMany({
      where: { teamId: req.auth!.teamId, provider: 'HUBSPOT' },
    });
    res.status(204).end();
  } catch (e) { next(e); }
});

// Push specific leads to HubSpot
const PushBody = z.object({
  lead_ids: z.array(z.string()).min(1).max(500).optional(),
  job_id: z.string().optional(),
});

r.post('/hubspot/push', authenticate, async (req, res, next) => {
  try {
    const body = PushBody.parse(req.body);
    const connection = await prisma.crmConnection.findUnique({
      where: { teamId_provider: { teamId: req.auth!.teamId, provider: 'HUBSPOT' } },
    });
    if (!connection || !connection.isActive) throw Errors.badRequest('HubSpot is not connected. Connect it from Settings → Integrations.');

    let leadIds: string[];
    if (body.lead_ids?.length) {
      leadIds = body.lead_ids;
    } else if (body.job_id) {
      const leads = await prisma.lead.findMany({
        where: { jobId: body.job_id, teamId: req.auth!.teamId, email: { not: null } },
        select: { id: true },
        take: 500,
      });
      leadIds = leads.map((l) => l.id);
    } else {
      throw Errors.badRequest('Provide either lead_ids or job_id');
    }

    if (leadIds.length === 0) {
      return res.json({ pushed: 0, failed: 0, skipped: 0, errors: [] });
    }

    const result = await pushManyToHubspot(connection.id, leadIds);
    res.json(result);
  } catch (e) { next(e); }
});

// ─────────────────────────── List all connections ───────────────────────────

r.get('/', authenticate, async (req, res, next) => {
  try {
    const conns = await prisma.crmConnection.findMany({
      where: { teamId: req.auth!.teamId },
      select: {
        id: true, provider: true, accountLabel: true, isActive: true,
        totalPushed: true, lastSyncAt: true, createdAt: true,
      },
    });
    res.json({ connections: conns });
  } catch (e) { next(e); }
});

export default r;
