import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { prisma } from '../../db/prisma.js';
import { Errors } from '../../utils/errors.js';

const r = Router();

// Aggregate leads by company domain — the de-facto "companies" view.
r.get('/', authenticate, async (req, res, next) => {
  try {
    const teamId = req.auth!.teamId;
    const search = (req.query.search as string | undefined)?.trim();

    const rows = await prisma.lead.groupBy({
      by: ['companyDomain', 'companyName'],
      where: {
        teamId,
        companyDomain: { not: null },
        ...(search && {
          OR: [
            { companyDomain: { contains: search, mode: 'insensitive' } },
            { companyName: { contains: search, mode: 'insensitive' } },
          ],
        }),
      },
      _count: { _all: true },
      _max: {
        companyWebsite: true,
        companyIndustry: true,
        companySize: true,
        companyRevenue: true,
        country: true,
      },
      orderBy: { _count: { companyDomain: 'desc' } },
      take: 100,
    });

    // Roll up tech stack per company by selecting one representative tech array
    const domains = rows.map((r) => r.companyDomain!);
    const techReps = await prisma.lead.findMany({
      where: { teamId, companyDomain: { in: domains }, technologies: { isEmpty: false } },
      select: { companyDomain: true, technologies: true },
      take: 500,
    });
    const techByDomain = techReps.reduce<Record<string, Set<string>>>((acc, l) => {
      if (!l.companyDomain) return acc;
      const s = acc[l.companyDomain] ?? new Set<string>();
      l.technologies.forEach((t) => s.add(t));
      acc[l.companyDomain] = s;
      return acc;
    }, {});

    res.json({
      companies: rows.map((r) => ({
        domain: r.companyDomain,
        name: r.companyName ?? r.companyDomain,
        website: r._max.companyWebsite,
        industry: r._max.companyIndustry,
        size: r._max.companySize,
        revenue: r._max.companyRevenue,
        country: r._max.country,
        leadCount: r._count._all,
        technologies: Array.from(techByDomain[r.companyDomain!] ?? []).slice(0, 6),
      })),
    });
  } catch (e) { next(e); }
});

r.get('/:domain', authenticate, async (req, res, next) => {
  try {
    const teamId = req.auth!.teamId;
    const { domain } = req.params;

    const leads = await prisma.lead.findMany({
      where: { teamId, companyDomain: domain },
      orderBy: { qualityScore: 'desc' },
      select: {
        id: true, email: true, fullName: true, jobTitle: true, jobSeniority: true,
        jobDepartment: true, country: true, city: true, linkedinUrl: true,
        qualityScore: true, verificationStatus: true, technologies: true,
        companyName: true, companyWebsite: true, companyIndustry: true,
        companySize: true, companyRevenue: true,
      },
    });

    if (leads.length === 0) throw Errors.notFound('Company');

    const rep = leads[0]!;
    const allTech = new Set<string>();
    leads.forEach((l) => l.technologies.forEach((t) => allTech.add(t)));

    res.json({
      company: {
        domain,
        name: rep.companyName ?? domain,
        website: rep.companyWebsite,
        industry: rep.companyIndustry,
        size: rep.companySize,
        revenue: rep.companyRevenue,
        country: rep.country,
        technologies: Array.from(allTech),
        leadCount: leads.length,
        leads,
      },
    });
  } catch (e) { next(e); }
});

export default r;
