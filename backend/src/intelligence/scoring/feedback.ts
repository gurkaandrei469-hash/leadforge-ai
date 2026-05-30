// Feedback collection — captures user labels on AI scores for future model
// retraining. Every label is paired with the feature vector the scorer saw at
// the time, so we can replay it during training.

import { prisma } from '../../db/prisma.js';
import type { FeedbackKind } from '@prisma/client';
import { extractFeatures, type FeatureInputs } from './features.js';

export async function recordFeedback(args: {
  teamId: string;
  leadId: string;
  userId?: string;
  kind: FeedbackKind;
  notes?: string;
}): Promise<{ id: string }> {
  const lead = await prisma.lead.findUnique({
    where: { id: args.leadId },
    include: {
      verification: true,
      graphCompany: {
        include: {
          technologies: true,
          fundingEvents: { orderBy: { announcedOn: 'desc' }, take: 5 },
          executiveMoves: { orderBy: { announcedOn: 'desc' }, take: 5 },
        },
      },
    },
  });
  if (!lead) throw new Error('Lead not found');

  const features = extractFeatures({
    lead,
    company: lead.graphCompany as any,
    verification: lead.verification,
  } as FeatureInputs);

  const created = await prisma.leadScoreFeedback.create({
    data: {
      teamId: args.teamId,
      leadId: args.leadId,
      userId: args.userId,
      scoreAtFeedback: lead.qualityScore,
      tierAtFeedback: tierFromScore(lead.qualityScore),
      kind: args.kind,
      notes: args.notes?.slice(0, 4000),
      features: features as any,
    },
  });
  return { id: created.id };
}

function tierFromScore(s: number | null | undefined): string | null {
  if (s == null) return null;
  if (s >= 85) return 'A';
  if (s >= 70) return 'B';
  if (s >= 55) return 'C';
  return 'D';
}

/** Aggregate stats for the team's feedback — useful for the future ML
 *  retraining pipeline and for surfacing in-app. */
export async function feedbackStats(teamId: string): Promise<{
  total: number;
  helpful: number;
  notHelpful: number;
  byKind: Array<{ kind: string; count: number }>;
  /** % of HELPFUL reactions among labeled tier-A leads — proxy for precision. */
  tierAPrecision: number | null;
}> {
  const [total, helpful, notHelpful, byKind, tierA] = await Promise.all([
    prisma.leadScoreFeedback.count({ where: { teamId } }),
    prisma.leadScoreFeedback.count({ where: { teamId, kind: 'HELPFUL' } }),
    prisma.leadScoreFeedback.count({ where: { teamId, kind: 'NOT_HELPFUL' } }),
    prisma.leadScoreFeedback.groupBy({
      by: ['kind'],
      where: { teamId },
      _count: { _all: true },
    }),
    prisma.leadScoreFeedback.findMany({
      where: { teamId, tierAtFeedback: 'A' },
      select: { kind: true },
    }),
  ]);

  const tierAPrecision = tierA.length > 0
    ? tierA.filter((f) => f.kind === 'HELPFUL' || f.kind === 'REPLIED_POSITIVELY').length / tierA.length
    : null;

  return {
    total, helpful, notHelpful,
    byKind: byKind.map((r) => ({ kind: r.kind, count: r._count._all })),
    tierAPrecision,
  };
}
