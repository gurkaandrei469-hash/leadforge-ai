import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { prisma } from '../../db/prisma.js';

const r = Router();

r.get('/me', authenticate, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.auth!.userId },
      include: {
        memberships: { include: { team: true } },
      },
    });
    res.json({ user, currentTeamId: req.auth!.teamId, role: req.auth!.role });
  } catch (e) {
    next(e);
  }
});

r.post('/logout', authenticate, async (_req, res) => {
  res.json({ success: true });
});

export default r;
