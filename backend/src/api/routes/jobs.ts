import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { prisma } from '../../db/prisma.js';
import { Errors } from '../../utils/errors.js';
import { FilterSchema } from '../../filters/types.js';
import { extractionQueue } from '../../workers/queues.js';

const r = Router();

const SourceTypes = z.enum([
  'WEB_SEARCH', 'DIRECTORY', 'COMPANY_PAGE', 'BLOG', 'FORUM',
  'SOCIAL_LINKEDIN', 'SOCIAL_TWITTER', 'CONTACT_PAGE', 'LISTING', 'DATABASE', 'CUSTOM_URL_LIST',
]);

const CreateJobBody = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(500).optional(),
  sources: z.array(SourceTypes).min(1),
  filters: FilterSchema,
  targetLeads: z.number().int().min(1).max(50_000).default(100),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  schedule: z.string().regex(/^[\d\*\-\,\/\s]+$/, 'Invalid cron expression').optional(),
});

r.post('/', authenticate, async (req, res, next) => {
  try {
    const body = CreateJobBody.parse(req.body);

    const team = await prisma.team.findUnique({ where: { id: req.auth!.teamId } });
    if (!team) throw Errors.notFound('Team');
    if (team.creditsTotal - team.creditsUsed < body.targetLeads) {
      throw Errors.paymentRequired(`Need ${body.targetLeads} credits, have ${team.creditsTotal - team.creditsUsed}`);
    }

    const job = await prisma.extractionJob.create({
      data: {
        teamId: req.auth!.teamId,
        createdById: req.auth!.userId,
        name: body.name,
        description: body.description,
        sources: body.sources,
        filters: body.filters,
        targetLeads: body.targetLeads,
        priority: body.priority,
        schedule: body.schedule,
        status: 'QUEUED',
      },
    });

    const opts = {
      priority: { LOW: 4, NORMAL: 3, HIGH: 2, URGENT: 1 }[body.priority],
      removeOnComplete: { age: 86400 },
      removeOnFail: { age: 604800 },
      ...(body.schedule && { repeat: { pattern: body.schedule } }),
    };

    const bullJob = await extractionQueue.add(
      'extract',
      { jobId: job.id, teamId: job.teamId },
      opts,
    );

    await prisma.extractionJob.update({
      where: { id: job.id },
      data: { bullJobId: bullJob.id?.toString() },
    });

    res.status(201).json({ job });
  } catch (e) { next(e); }
});

r.get('/', authenticate, async (req, res, next) => {
  try {
    const q = z.object({
      status: z.string().optional(),
      page: z.coerce.number().default(1),
      pageSize: z.coerce.number().max(100).default(20),
    }).parse(req.query);

    const where = {
      teamId: req.auth!.teamId,
      ...(q.status && { status: q.status as any }),
    };
    const [jobs, total] = await Promise.all([
      prisma.extractionJob.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      prisma.extractionJob.count({ where }),
    ]);
    res.json({ jobs, total, page: q.page, pageSize: q.pageSize });
  } catch (e) { next(e); }
});

r.get('/:id', authenticate, async (req, res, next) => {
  try {
    const job = await prisma.extractionJob.findFirst({
      where: { id: req.params.id, teamId: req.auth!.teamId },
      include: { events: { orderBy: { createdAt: 'desc' }, take: 50 } },
    });
    if (!job) throw Errors.notFound('Job');
    res.json({ job });
  } catch (e) { next(e); }
});

r.post('/:id/pause', authenticate, async (req, res, next) => {
  try {
    const job = await prisma.extractionJob.findFirst({
      where: { id: req.params.id, teamId: req.auth!.teamId },
    });
    if (!job) throw Errors.notFound('Job');
    if (job.bullJobId) {
      const bull = await extractionQueue.getJob(job.bullJobId);
      await bull?.moveToDelayed(Date.now() + 365 * 24 * 60 * 60 * 1000);
    }
    const updated = await prisma.extractionJob.update({
      where: { id: job.id },
      data: { status: 'PAUSED', pausedAt: new Date() },
    });
    res.json({ job: updated });
  } catch (e) { next(e); }
});

r.post('/:id/resume', authenticate, async (req, res, next) => {
  try {
    const job = await prisma.extractionJob.findFirst({
      where: { id: req.params.id, teamId: req.auth!.teamId },
    });
    if (!job) throw Errors.notFound('Job');
    if (job.bullJobId) {
      const bull = await extractionQueue.getJob(job.bullJobId);
      await bull?.promote();
    }
    const updated = await prisma.extractionJob.update({
      where: { id: job.id },
      data: { status: 'QUEUED', pausedAt: null },
    });
    res.json({ job: updated });
  } catch (e) { next(e); }
});

r.post('/:id/cancel', authenticate, async (req, res, next) => {
  try {
    const job = await prisma.extractionJob.findFirst({
      where: { id: req.params.id, teamId: req.auth!.teamId },
    });
    if (!job) throw Errors.notFound('Job');
    if (job.bullJobId) {
      const bull = await extractionQueue.getJob(job.bullJobId);
      await bull?.remove();
    }
    const updated = await prisma.extractionJob.update({
      where: { id: job.id },
      data: { status: 'CANCELLED', completedAt: new Date() },
    });
    res.json({ job: updated });
  } catch (e) { next(e); }
});

/**
 * Patch a job — rename, update description, change priority, or modify the cron schedule.
 * The sources/filters/targetLeads of a running job are immutable (would require re-running).
 */
const UpdateJobBody = z.object({
  name: z.string().min(2).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(),
  schedule: z.string().nullable().optional(),
});

r.patch('/:id', authenticate, async (req, res, next) => {
  try {
    const body = UpdateJobBody.parse(req.body);
    const found = await prisma.extractionJob.findFirst({
      where: { id: req.params.id, teamId: req.auth!.teamId },
    });
    if (!found) throw Errors.notFound('Job');

    const updated = await prisma.extractionJob.update({
      where: { id: found.id },
      data: {
        name: body.name ?? found.name,
        description: body.description === undefined ? found.description : body.description,
        priority: body.priority ?? found.priority,
        schedule: body.schedule === undefined ? found.schedule : body.schedule,
      },
    });
    res.json({ job: updated });
  } catch (e) { next(e); }
});

/**
 * Delete a job entirely. Best-effort removes the BullMQ entry, then deletes the DB row.
 * Leads created BY this job are kept by default (they're still useful — owned by the team, not the job).
 * Pass ?deleteLeads=true to also wipe extracted leads.
 */
r.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const deleteLeads = String(req.query.deleteLeads ?? '') === 'true';
    const found = await prisma.extractionJob.findFirst({
      where: { id: req.params.id, teamId: req.auth!.teamId },
    });
    if (!found) throw Errors.notFound('Job');

    // 1. Try to yank from BullMQ
    if (found.bullJobId) {
      try {
        const bull = await extractionQueue.getJob(found.bullJobId);
        await bull?.remove();
      } catch { /* job may already be gone — ignore */ }
    }

    // 2. Decouple leads (or delete them) since Lead.jobId references this row.
    if (deleteLeads) {
      await prisma.lead.deleteMany({ where: { jobId: found.id, teamId: req.auth!.teamId } });
    } else {
      await prisma.lead.updateMany({
        where: { jobId: found.id, teamId: req.auth!.teamId },
        data: { jobId: null },
      });
    }

    // 3. Delete the job (cascades to events)
    await prisma.extractionJob.delete({ where: { id: found.id } });
    res.json({ success: true });
  } catch (e) { next(e); }
});

/**
 * Bulk delete jobs. Same semantics as single delete — best-effort BullMQ removal + DB delete.
 */
r.post('/bulk-delete', authenticate, async (req, res, next) => {
  try {
    const body = z.object({
      ids: z.array(z.string()).min(1).max(200),
      deleteLeads: z.boolean().default(false),
    }).parse(req.body);

    const jobs = await prisma.extractionJob.findMany({
      where: { id: { in: body.ids }, teamId: req.auth!.teamId },
    });
    if (jobs.length === 0) return res.json({ deleted: 0 });

    for (const j of jobs) {
      if (j.bullJobId) {
        try {
          const bull = await extractionQueue.getJob(j.bullJobId);
          await bull?.remove();
        } catch { /* ignore */ }
      }
    }

    const jobIds = jobs.map((j) => j.id);
    if (body.deleteLeads) {
      await prisma.lead.deleteMany({ where: { jobId: { in: jobIds }, teamId: req.auth!.teamId } });
    } else {
      await prisma.lead.updateMany({
        where: { jobId: { in: jobIds }, teamId: req.auth!.teamId },
        data: { jobId: null },
      });
    }
    await prisma.extractionJob.deleteMany({ where: { id: { in: jobIds } } });
    res.json({ deleted: jobIds.length });
  } catch (e) { next(e); }
});

export default r;
