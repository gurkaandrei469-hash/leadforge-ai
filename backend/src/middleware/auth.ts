import type { Request, Response, NextFunction } from 'express';
import { createClerkClient, verifyToken } from '@clerk/express';
import { prisma } from '../db/prisma.js';
import { Errors } from '../utils/errors.js';
import { env } from '../config/env.js';
import crypto from 'node:crypto';

export interface AuthContext {
  userId: string;
  teamId: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
  via: 'jwt' | 'api_key';
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
  }
}

const clerk = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
const hashApiKey = (key: string) => crypto.createHash('sha256').update(key).digest('hex');

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header) return next(Errors.unauthorized('Missing Authorization header'));

  try {
    const [scheme, token] = header.split(' ');

    // API key path
    if (scheme === 'Bearer' && token?.startsWith('lf_')) {
      const apiKey = await prisma.apiKey.findUnique({
        where: { keyHash: hashApiKey(token) },
      });
      if (!apiKey || apiKey.revokedAt) return next(Errors.unauthorized('Invalid API key'));
      if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
        return next(Errors.unauthorized('API key expired'));
      }

      const membership = await prisma.teamMembership.findUnique({
        where: { userId_teamId: { userId: apiKey.userId, teamId: apiKey.teamId } },
      });
      if (!membership) return next(Errors.forbidden('No team access'));

      await prisma.apiKey.update({
        where: { id: apiKey.id },
        data: { lastUsedAt: new Date() },
      });

      req.auth = { userId: apiKey.userId, teamId: apiKey.teamId, role: membership.role, via: 'api_key' };
      return next();
    }

    // Clerk JWT path
    if (scheme !== 'Bearer' || !token) return next(Errors.unauthorized('Invalid Authorization'));

    let payload;
    try {
      payload = await verifyToken(token, { secretKey: env.CLERK_SECRET_KEY });
    } catch (e) {
      console.error('[auth] verifyToken threw:', (e as Error).message);
      return next(Errors.unauthorized('Token verification failed'));
    }
    console.log('[auth] verifyToken result:', { sub: payload?.sub, sid: payload?.sid, iss: payload?.iss, hasExp: !!payload?.exp });
    if (!payload?.sub) return next(Errors.unauthorized('Invalid token (no sub)'));

    let user = await prisma.user.findUnique({ where: { clerkId: payload.sub } });
    if (!user) {
      const cu = await clerk.users.getUser(payload.sub);
      user = await prisma.user.create({
        data: {
          clerkId: cu.id,
          email: cu.emailAddresses[0]?.emailAddress ?? '',
          fullName: [cu.firstName, cu.lastName].filter(Boolean).join(' ') || null,
          avatarUrl: cu.imageUrl,
          emailVerified: cu.emailAddresses[0]?.verification?.status === 'verified',
        },
      });
    }

    const teamId = (req.headers['x-team-id'] as string) ?? '';
    let membership = teamId
      ? await prisma.teamMembership.findUnique({ where: { userId_teamId: { userId: user.id, teamId } } })
      : await prisma.teamMembership.findFirst({ where: { userId: user.id } });

    // First-time login: auto-provision a personal team
    if (!membership) {
      const displayName = user.fullName?.split(' ')[0] ?? user.email.split('@')[0];
      const slug = `${displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${user.id.slice(-6)}`;
      const team = await prisma.team.create({
        data: {
          name: `${displayName}'s Workspace`,
          slug,
          ownerId: user.id,
          planTier: 'FREE',
          creditsTotal: 100,
          memberships: { create: { userId: user.id, role: 'OWNER' } },
        },
      });
      membership = await prisma.teamMembership.findUnique({
        where: { userId_teamId: { userId: user.id, teamId: team.id } },
      });
      if (!membership) return next(Errors.internal('Team provisioning failed'));
    }

    req.auth = { userId: user.id, teamId: membership.teamId, role: membership.role, via: 'jwt' };
    return next();
  } catch (err) {
    return next(Errors.unauthorized('Authentication failed'));
  }
}

export const requireRole =
  (...allowed: AuthContext['role'][]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(Errors.unauthorized());
    if (!allowed.includes(req.auth.role)) return next(Errors.forbidden('Insufficient role'));
    return next();
  };

export { hashApiKey };
