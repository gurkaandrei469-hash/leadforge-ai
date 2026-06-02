import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { prisma } from '../../db/prisma.js';
import { huntDomain } from '../../intelligence/domain-hunter/index.js';

const r = Router();

r.post('/', authenticate, requireRole('OWNER', 'ADMIN', 'MEMBER'), async (req, res, next) => {
  try {
    const { domain, companyName, targetLeads } = z.object({
      domain: z.string().min(3),
      companyName: z.string().min(1),
      targetLeads: z.number().int().min(1).max(5000).default(500),
    }).parse(req.body);

    const { teamId, userId } = req.auth!;

    // Create a job record
    const job = await prisma.extractionJob.create({
      data: {
        teamId,
        createdById: userId,
        name: `Domain Hunt — ${domain}`,
        sources: ['COMPANY_PAGE'],
        filters: { domain },
        targetLeads,
        priority: 'HIGH',
        status: 'RUNNING',
        startedAt: new Date(),
      },
    });

    res.json({ job: { id: job.id, status: job.status } });

    // Run async (don't await in the HTTP handler)
    huntDomain({
      domain,
      companyName,
      teamId,
      createdById: userId,
      jobId: job.id,
      targetLeads,
      onProgress: async (p) => {
        await prisma.extractionJob.update({
          where: { id: job.id },
          data: {
            leadsFound: p.saved ?? 0,
            leadsVerified: p.verified ?? 0,
            progress: p.saved ? Math.min(99, (p.saved / targetLeads) * 100) : 0,
          },
        }).catch(() => {});
      },
    }).catch(err => {
      prisma.extractionJob.update({
        where: { id: job.id },
        data: { status: 'FAILED', errorMessage: err.message },
      }).catch(() => {});
    });
  } catch (e) { next(e); }
});

export default r;
