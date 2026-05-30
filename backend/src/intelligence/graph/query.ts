// Knowledge-graph queries.
//
// High-level graph operations that go beyond what the raw Prisma client makes
// ergonomic. These are the bread-and-butter "find me leads at companies that…"
// queries that turn the graph into a sales tool.

import { prisma } from '../../db/prisma.js';
import type { Prisma } from '@prisma/client';

// ─── Filter shape ───────────────────────────────────────────────────────────

export interface GraphLeadFilter {
  teamId: string;
  /** Lead-side filters */
  jobSeniority?: string[];        // "C-Level", "VP", "Director", "Manager", "IC"
  jobDepartment?: string[];       // "Engineering", "Marketing", …
  verificationStatus?: ('VALID' | 'INVALID' | 'RISKY' | 'CATCH_ALL' | 'UNKNOWN')[];
  minQualityScore?: number;

  /** Company-side filters (require Lead.companyId to be populated) */
  industrySlug?: string[];
  /** Slugs of technologies any of which the company must use. */
  usesTech?: string[];
  /** ALL of these tech slugs must be present on the company. */
  usesAllTech?: string[];
  /** ALL of these tech slugs must be ABSENT on the company. */
  excludeTech?: string[];
  employeeMin?: number;
  employeeMax?: number;
  hqCountry?: string[];
  /** Companies that had a funding round of any type within the last N days. */
  fundedWithinDays?: number;
  /** Companies that had an exec change within the last N days. */
  execChangeWithinDays?: number;
  /** Companies founded after this year. */
  foundedAfter?: number;

  /** Pagination + sorting */
  page?: number;
  pageSize?: number;
  sortBy?: 'qualityScore' | 'createdAt' | 'companyEmployees' | 'lastFunding';
  sortOrder?: 'asc' | 'desc';
}

export interface GraphLeadRow {
  leadId: string;
  email: string | null;
  fullName: string | null;
  jobTitle: string | null;
  jobSeniority: string | null;
  qualityScore: number | null;
  verificationStatus: string;
  company: {
    id: string;
    name: string | null;
    domain: string;
    industry: { slug: string; name: string } | null;
    employees: number | null;
    foundedYear: number | null;
    hqCountry: string | null;
    technologies: Array<{ slug: string; name: string }>;
    lastFundingRound: string | null;
    lastFundingAt: Date | null;
  } | null;
}

// ─── Query function ─────────────────────────────────────────────────────────

export async function queryLeads(filter: GraphLeadFilter): Promise<{ rows: GraphLeadRow[]; total: number }> {
  const page = filter.page ?? 1;
  const pageSize = Math.min(filter.pageSize ?? 50, 200);

  // Build the company-side AND clause that has to be true for every matched
  // company. We compose this lazily so leads without a companyId still work
  // for lead-only filters.
  const companyAnd: Prisma.CompanyWhereInput[] = [];

  if (filter.industrySlug?.length) {
    companyAnd.push({ industry: { slug: { in: filter.industrySlug } } });
  }
  if (filter.employeeMin !== undefined) {
    companyAnd.push({ employeeCount: { gte: filter.employeeMin } });
  }
  if (filter.employeeMax !== undefined) {
    companyAnd.push({ employeeCount: { lte: filter.employeeMax } });
  }
  if (filter.hqCountry?.length) {
    companyAnd.push({ hqCountry: { in: filter.hqCountry } });
  }
  if (filter.foundedAfter !== undefined) {
    companyAnd.push({ foundedYear: { gte: filter.foundedAfter } });
  }
  if (filter.usesTech?.length) {
    // ANY-of semantics — at least one of the listed technologies
    companyAnd.push({
      technologies: { some: { technology: { slug: { in: filter.usesTech } } } },
    });
  }
  if (filter.usesAllTech?.length) {
    // ALL-of semantics — separate clause per required technology
    for (const slug of filter.usesAllTech) {
      companyAnd.push({
        technologies: { some: { technology: { slug } } },
      });
    }
  }
  if (filter.excludeTech?.length) {
    companyAnd.push({
      technologies: { none: { technology: { slug: { in: filter.excludeTech } } } },
    });
  }
  if (filter.fundedWithinDays !== undefined) {
    const since = new Date(Date.now() - filter.fundedWithinDays * 86400_000);
    companyAnd.push({ fundingEvents: { some: { announcedOn: { gte: since } } } });
  }
  if (filter.execChangeWithinDays !== undefined) {
    const since = new Date(Date.now() - filter.execChangeWithinDays * 86400_000);
    companyAnd.push({ executiveMoves: { some: { announcedOn: { gte: since } } } });
  }

  const where: Prisma.LeadWhereInput = {
    teamId: filter.teamId,
    ...(filter.jobSeniority?.length ? { jobSeniority: { in: filter.jobSeniority } } : {}),
    ...(filter.jobDepartment?.length ? { jobDepartment: { in: filter.jobDepartment } } : {}),
    ...(filter.verificationStatus?.length ? { verificationStatus: { in: filter.verificationStatus as any } } : {}),
    ...(filter.minQualityScore !== undefined ? { qualityScore: { gte: filter.minQualityScore } } : {}),
    ...(companyAnd.length > 0 ? { graphCompany: { is: { AND: companyAnd } } } : {}),
  };

  const orderBy: Prisma.LeadOrderByWithRelationInput = (() => {
    switch (filter.sortBy) {
      case 'qualityScore':       return { qualityScore: filter.sortOrder ?? 'desc' };
      case 'companyEmployees':   return { graphCompany: { employeeCount: filter.sortOrder ?? 'desc' } };
      case 'lastFunding':        return { graphCompany: { updatedAt: filter.sortOrder ?? 'desc' } };
      case 'createdAt':
      default:                   return { createdAt: filter.sortOrder ?? 'desc' };
    }
  })();

  const [rows, total] = await Promise.all([
    prisma.lead.findMany({
      where, orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true, email: true, fullName: true, jobTitle: true, jobSeniority: true,
        qualityScore: true, verificationStatus: true,
        graphCompany: {
          select: {
            id: true, name: true, domain: true, employeeCount: true, foundedYear: true, hqCountry: true,
            industry: { select: { slug: true, name: true } },
            technologies: { select: { technology: { select: { slug: true, name: true } } } },
            fundingEvents: {
              orderBy: { announcedOn: 'desc' },
              take: 1,
              select: { round: true, announcedOn: true },
            },
          },
        },
      },
    }),
    prisma.lead.count({ where }),
  ]);

  return {
    total,
    rows: rows.map((l) => ({
      leadId: l.id,
      email: l.email,
      fullName: l.fullName,
      jobTitle: l.jobTitle,
      jobSeniority: l.jobSeniority,
      qualityScore: l.qualityScore,
      verificationStatus: l.verificationStatus,
      company: l.graphCompany ? {
        id: l.graphCompany.id,
        name: l.graphCompany.name,
        domain: l.graphCompany.domain,
        industry: l.graphCompany.industry,
        employees: l.graphCompany.employeeCount,
        foundedYear: l.graphCompany.foundedYear,
        hqCountry: l.graphCompany.hqCountry,
        technologies: l.graphCompany.technologies.map((ct) => ct.technology),
        lastFundingRound: l.graphCompany.fundingEvents[0]?.round ?? null,
        lastFundingAt: l.graphCompany.fundingEvents[0]?.announcedOn ?? null,
      } : null,
    })),
  };
}

// ─── Aggregate stats ───────────────────────────────────────────────────────

export async function graphStats(teamId: string): Promise<{
  companyCount: number;
  industryCount: number;
  techCount: number;
  fundingEventCount: number;
  topIndustries: Array<{ name: string; companyCount: number }>;
  topTechnologies: Array<{ name: string; companyCount: number }>;
}> {
  const [companyCount, industryCount, techCount, fundingEventCount, topIndustries, topTechnologies] = await Promise.all([
    prisma.company.count({ where: { leads: { some: { teamId } } } }),
    prisma.industry.count(),
    prisma.technology.count(),
    prisma.fundingEvent.count({ where: { company: { leads: { some: { teamId } } } } }),
    prisma.$queryRawUnsafe<Array<{ name: string; company_count: bigint }>>(`
      SELECT i.name, COUNT(DISTINCT c.id) AS company_count
      FROM "Industry" i
      INNER JOIN "Company" c ON c."industryId" = i.id
      INNER JOIN "Lead" l ON l."companyId" = c.id
      WHERE l."teamId" = $1
      GROUP BY i.id, i.name
      ORDER BY company_count DESC
      LIMIT 10
    `, teamId),
    prisma.$queryRawUnsafe<Array<{ name: string; company_count: bigint }>>(`
      SELECT t.name, COUNT(DISTINCT c.id) AS company_count
      FROM "Technology" t
      INNER JOIN "CompanyTechnology" ct ON ct."technologyId" = t.id
      INNER JOIN "Company" c ON c.id = ct."companyId"
      INNER JOIN "Lead" l ON l."companyId" = c.id
      WHERE l."teamId" = $1
      GROUP BY t.id, t.name
      ORDER BY company_count DESC
      LIMIT 15
    `, teamId),
  ]);
  return {
    companyCount,
    industryCount,
    techCount,
    fundingEventCount,
    topIndustries: topIndustries.map((r) => ({ name: r.name, companyCount: Number(r.company_count) })),
    topTechnologies: topTechnologies.map((r) => ({ name: r.name, companyCount: Number(r.company_count) })),
  };
}
