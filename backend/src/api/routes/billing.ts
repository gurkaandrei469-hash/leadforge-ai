import { Router } from 'express';
import express from 'express';
import { z } from 'zod';
import Stripe from 'stripe';
import { authenticate, requireRole } from '../../middleware/auth.js';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { Errors } from '../../utils/errors.js';

const r = Router();
const stripe = env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY) : null;

const PLAN_PRICES: Record<string, string> = {
  STARTER: 'price_starter',
  PRO: 'price_pro',
  BUSINESS: 'price_business',
};

r.get('/plans', async (_req, res) => {
  res.json({
    plans: [
      { tier: 'FREE', credits: 100, priceMonthly: 0 },
      { tier: 'STARTER', credits: 2_500, priceMonthly: 29 },
      { tier: 'PRO', credits: 12_000, priceMonthly: 99 },
      { tier: 'BUSINESS', credits: 50_000, priceMonthly: 299 },
      { tier: 'ENTERPRISE', credits: null, priceMonthly: null },
    ],
  });
});

r.post('/checkout', authenticate, requireRole('OWNER'), async (req, res, next) => {
  try {
    if (!stripe) throw Errors.internal('Stripe not configured');
    const body = z.object({
      planTier: z.enum(['STARTER', 'PRO', 'BUSINESS']),
      successUrl: z.string().url(),
      cancelUrl: z.string().url(),
    }).parse(req.body);

    const team = await prisma.team.findUnique({ where: { id: req.auth!.teamId } });
    if (!team) throw Errors.notFound('Team');

    let customerId = team.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: team.billingEmail ?? undefined,
        metadata: { teamId: team.id },
      });
      customerId = customer.id;
      await prisma.team.update({ where: { id: team.id }, data: { stripeCustomerId: customerId } });
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: PLAN_PRICES[body.planTier], quantity: 1 }],
      success_url: body.successUrl,
      cancel_url: body.cancelUrl,
      metadata: { teamId: team.id, planTier: body.planTier },
    });

    res.json({ url: session.url });
  } catch (e) { next(e); }
});

r.post('/portal', authenticate, requireRole('OWNER', 'ADMIN'), async (req, res, next) => {
  try {
    if (!stripe) throw Errors.internal('Stripe not configured');
    const team = await prisma.team.findUnique({ where: { id: req.auth!.teamId } });
    if (!team?.stripeCustomerId) throw Errors.badRequest('No billing customer');
    const session = await stripe.billingPortal.sessions.create({
      customer: team.stripeCustomerId,
      return_url: req.body.returnUrl ?? `${env.CORS_ORIGIN}/settings/billing`,
    });
    res.json({ url: session.url });
  } catch (e) { next(e); }
});

r.get('/usage', authenticate, async (req, res, next) => {
  try {
    const team = await prisma.team.findUnique({
      where: { id: req.auth!.teamId },
      select: { planTier: true, creditsTotal: true, creditsUsed: true, creditsResetAt: true },
    });
    res.json({ usage: team });
  } catch (e) { next(e); }
});

r.get('/transactions', authenticate, async (req, res, next) => {
  try {
    const txs = await prisma.creditTransaction.findMany({
      where: { teamId: req.auth!.teamId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ transactions: txs });
  } catch (e) { next(e); }
});

r.get('/invoices', authenticate, requireRole('OWNER', 'ADMIN'), async (req, res, next) => {
  try {
    const invoices = await prisma.invoice.findMany({
      where: { teamId: req.auth!.teamId },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ invoices });
  } catch (e) { next(e); }
});

// Stripe webhook (raw body)
export const stripeWebhook = express.raw({ type: 'application/json' });

r.post('/stripe/webhook', stripeWebhook, async (req, res) => {
  if (!stripe) return res.status(500).end();
  const sig = req.headers['stripe-signature'] as string;
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    return res.status(400).send(`Webhook error: ${(err as Error).message}`);
  }

  // Handle event types: customer.subscription.created, .updated, .deleted, invoice.paid
  // Defer to billing service in production.
  res.json({ received: true });
});

export default r;
