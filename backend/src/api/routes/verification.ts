import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { prisma } from '../../db/prisma.js';
import { verificationQueue } from '../../workers/queues.js';
import { verifyEmail } from '../../verification/verifier.js';

const r = Router();

r.post('/single', authenticate, async (req, res, next) => {
  try {
    const body = z.object({ email: z.string().email() }).parse(req.body);
    const result = await verifyEmail(body.email);
    res.json({ result });
  } catch (e) { next(e); }
});

r.post('/batch', authenticate, async (req, res, next) => {
  try {
    const body = z.object({
      leadIds: z.array(z.string()).min(1).max(5000),
    }).parse(req.body);

    const leads = await prisma.lead.findMany({
      where: { id: { in: body.leadIds }, teamId: req.auth!.teamId },
      select: { id: true, email: true },
    });

    const bullJobs = await verificationQueue.addBulk(
      leads
        .filter((l) => l.email)
        .map((l) => ({
          name: 'verify',
          data: { leadId: l.id, email: l.email!, teamId: req.auth!.teamId },
          opts: { removeOnComplete: { age: 3600 } },
        })),
    );

    res.json({ queued: bullJobs.length });
  } catch (e) { next(e); }
});

r.get('/status/:leadId', authenticate, async (req, res, next) => {
  try {
    const v = await prisma.emailVerification.findFirst({
      where: { lead: { id: req.params.leadId, teamId: req.auth!.teamId } },
    });
    res.json({ verification: v });
  } catch (e) { next(e); }
});

export default r;
