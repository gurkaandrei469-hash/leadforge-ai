import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { prisma } from '../../db/prisma.js';
import { Errors } from '../../utils/errors.js';
import { FilterSchema } from '../../filters/types.js';
import { compileFilterToWhere } from '../../filters/engine.js';
import { verificationQueue } from '../../workers/queues.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FREE_PROVIDERS = new Set(['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'aol.com', 'proton.me', 'protonmail.com']);

const r = Router();

const LeadQuery = z.object({
  page: z.coerce.number().default(1),
  pageSize: z.coerce.number().max(200).default(50),
  search: z.string().optional(),
  status: z.string().optional(),
  jobId: z.string().optional(),
  verificationStatus: z.string().optional(),
  isFavorite: z.coerce.boolean().optional(),
  sortBy: z.enum(['createdAt', 'qualityScore', 'companyName', 'fullName']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

/**
 * Streaming CSV export — synchronous, fast, no worker hop needed.
 * Matches the same filters as GET / so the user always gets exactly what
 * they see in the UI. For very large workspaces (>50k leads) Chrome may
 * stream this for a few seconds — that's fine.
 *
 * Query params:
 *   • search, status, jobId, verificationStatus — same as list endpoint
 *   • leadIds — comma-separated list to export ONLY those rows (used by
 *               the bulk-select toolbar)
 */
r.get('/export.csv', authenticate, async (req, res, next) => {
  try {
    const teamId = req.auth!.teamId;
    const q = z.object({
      search: z.string().optional(),
      status: z.string().optional(),
      jobId: z.string().optional(),
      verificationStatus: z.string().optional(),
      leadIds: z.string().optional(), // comma-separated
    }).parse(req.query);

    const where: any = { teamId };
    if (q.leadIds) where.id = { in: q.leadIds.split(',').map((s) => s.trim()).filter(Boolean) };
    if (q.jobId) where.jobId = q.jobId;
    if (q.status) where.status = q.status as any;
    if (q.verificationStatus) where.verificationStatus = q.verificationStatus as any;
    if (q.search) {
      where.OR = [
        { email: { contains: q.search, mode: 'insensitive' } },
        { fullName: { contains: q.search, mode: 'insensitive' } },
        { companyName: { contains: q.search, mode: 'insensitive' } },
      ];
    }

    const total = await prisma.lead.count({ where });
    const ts = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="leadforge-export-${ts}.csv"`);
    res.setHeader('X-Total-Rows', String(total));

    // Header row. Order chosen for usefulness in cold-outreach tooling
    // (HubSpot, Apollo, Outreach, etc. all accept this layout).
    const headers = [
      'email', 'full_name', 'first_name', 'last_name', 'job_title',
      'company_name', 'company_domain', 'company_website',
      'country', 'city', 'linkedin_url', 'twitter_url',
      'quality_score', 'verification_status', 'is_role_account', 'is_disposable',
      'technologies', 'source_url', 'source_type', 'created_at',
    ];
    res.write(headers.join(',') + '\n');

    // Stream in 500-row chunks to keep memory bounded even for very large exports.
    const BATCH = 500;
    for (let skip = 0; skip < total; skip += BATCH) {
      const rows = await prisma.lead.findMany({
        where, skip, take: BATCH,
        orderBy: { createdAt: 'desc' },
        include: { verification: true },
      });
      for (const l of rows) {
        const cells = [
          l.email, l.fullName, l.firstName, l.lastName, l.jobTitle,
          l.companyName, l.companyDomain, l.companyWebsite,
          l.country, l.city, l.linkedinUrl, l.twitterUrl,
          l.qualityScore, l.verificationStatus, l.verification?.isRoleAccount, l.verification?.isDisposable,
          (l.technologies ?? []).join('; '),
          l.sourceUrl, l.sourceType, l.createdAt.toISOString(),
        ].map(csvCell);
        res.write(cells.join(',') + '\n');
      }
    }
    res.end();
  } catch (e) { next(e); }
});

/** RFC-4180 cell escape — wraps in quotes when the value contains comma, quote, or newline. */
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

r.get('/', authenticate, async (req, res, next) => {
  try {
    const q = LeadQuery.parse(req.query);
    const where: any = { teamId: req.auth!.teamId };
    if (q.search) {
      where.OR = [
        { email: { contains: q.search, mode: 'insensitive' } },
        { fullName: { contains: q.search, mode: 'insensitive' } },
        { companyName: { contains: q.search, mode: 'insensitive' } },
        { companyDomain: { contains: q.search, mode: 'insensitive' } },
      ];
    }
    if (q.status) where.status = q.status;
    if (q.jobId) where.jobId = q.jobId;
    if (q.verificationStatus) where.verificationStatus = q.verificationStatus;
    if (q.isFavorite !== undefined) where.isFavorite = q.isFavorite;

    const [leads, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        orderBy: { [q.sortBy]: q.sortOrder },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { verification: true },
      }),
      prisma.lead.count({ where }),
    ]);

    res.json({ leads, total, page: q.page, pageSize: q.pageSize });
  } catch (e) { next(e); }
});

r.post('/search', authenticate, async (req, res, next) => {
  try {
    const body = z.object({
      filter: FilterSchema,
      page: z.number().default(1),
      pageSize: z.number().max(200).default(50),
    }).parse(req.body);

    const where = compileFilterToWhere(body.filter, req.auth!.teamId);
    const [leads, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (body.page - 1) * body.pageSize,
        take: body.pageSize,
        include: { verification: true },
      }),
      prisma.lead.count({ where }),
    ]);
    res.json({ leads, total, page: body.page, pageSize: body.pageSize });
  } catch (e) { next(e); }
});

r.get('/:id', authenticate, async (req, res, next) => {
  try {
    const lead = await prisma.lead.findFirst({
      where: { id: req.params.id, teamId: req.auth!.teamId },
      include: { verification: true, enrichment: true, job: true },
    });
    if (!lead) throw Errors.notFound('Lead');
    res.json({ lead });
  } catch (e) { next(e); }
});

r.patch('/:id', authenticate, async (req, res, next) => {
  try {
    const body = z.object({
      status: z.enum(['NEW', 'VERIFIED', 'ENRICHED', 'EXPORTED', 'ARCHIVED']).optional(),
      isFavorite: z.boolean().optional(),
      isHidden: z.boolean().optional(),
      notes: z.string().max(2000).nullable().optional(),
      customFields: z.record(z.any()).optional(),
    }).parse(req.body);

    const found = await prisma.lead.findFirst({
      where: { id: req.params.id, teamId: req.auth!.teamId },
    });
    if (!found) throw Errors.notFound('Lead');

    const lead = await prisma.lead.update({ where: { id: req.params.id }, data: body });
    res.json({ lead });
  } catch (e) { next(e); }
});

r.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const found = await prisma.lead.findFirst({
      where: { id: req.params.id, teamId: req.auth!.teamId },
    });
    if (!found) throw Errors.notFound('Lead');
    await prisma.lead.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (e) { next(e); }
});

r.post('/bulk', authenticate, async (req, res, next) => {
  try {
    const body = z.object({
      ids: z.array(z.string()).min(1).max(1000),
      action: z.enum(['archive', 'favorite', 'unfavorite', 'delete', 'verify']),
    }).parse(req.body);

    const where = { id: { in: body.ids }, teamId: req.auth!.teamId };

    switch (body.action) {
      case 'archive':
        await prisma.lead.updateMany({ where, data: { status: 'ARCHIVED' } });
        break;
      case 'favorite':
        await prisma.lead.updateMany({ where, data: { isFavorite: true } });
        break;
      case 'unfavorite':
        await prisma.lead.updateMany({ where, data: { isFavorite: false } });
        break;
      case 'delete':
        await prisma.lead.deleteMany({ where });
        break;
      case 'verify':
        // enqueued by verification route — see verification.ts
        break;
    }
    res.json({ success: true, count: body.ids.length });
  } catch (e) { next(e); }
});

/**
 * Manually add one or more leads. Used by the "Add Lead" textbox on the leads page.
 * Each input row supports email + a handful of common fields. Dedupes against existing leads
 * via the (teamId, emailNormalized) unique key.
 */
const ManualLeadSchema = z.object({
  email: z.string().min(3).max(320),
  firstName: z.string().max(120).optional(),
  lastName: z.string().max(120).optional(),
  fullName: z.string().max(240).optional(),
  jobTitle: z.string().max(240).optional(),
  companyName: z.string().max(240).optional(),
  companyDomain: z.string().max(240).optional(),
  companyWebsite: z.string().max(2000).optional(),
  linkedinUrl: z.string().max(2000).optional(),
  country: z.string().max(120).optional(),
  city: z.string().max(120).optional(),
  notes: z.string().max(2000).optional(),
});

r.post('/manual', authenticate, async (req, res, next) => {
  try {
    const body = z.object({
      leads: z.array(ManualLeadSchema).min(1).max(500),
      verify: z.boolean().default(false),
    }).parse(req.body);

    const summary = { added: 0, updated: 0, invalid: 0, errors: 0 };
    const addedIds: string[] = [];

    for (const input of body.leads) {
      try {
        const email = input.email.trim().toLowerCase();
        if (!EMAIL_RE.test(email)) { summary.invalid++; continue; }

        // Auto-derive name parts from fullName when first/last missing
        let firstName = input.firstName?.trim() || null;
        let lastName = input.lastName?.trim() || null;
        let fullName = input.fullName?.trim() || null;

        if (fullName && !firstName && !lastName) {
          const parts = fullName.split(/\s+/);
          firstName = parts[0] ?? null;
          if (parts.length > 1) lastName = parts.slice(1).join(' ');
        } else if (!fullName && (firstName || lastName)) {
          fullName = [firstName, lastName].filter(Boolean).join(' ') || null;
        }

        // Auto-derive companyDomain
        let companyDomain = input.companyDomain?.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '') || null;
        if (!companyDomain && input.companyWebsite) {
          try {
            const url = /^https?:/i.test(input.companyWebsite) ? input.companyWebsite : `https://${input.companyWebsite}`;
            companyDomain = new URL(url).hostname.replace(/^www\./, '');
          } catch { /* ignore */ }
        }
        if (!companyDomain) {
          const domainPart = email.split('@')[1];
          if (domainPart && !FREE_PROVIDERS.has(domainPart)) companyDomain = domainPart;
        }

        const upserted = await prisma.lead.upsert({
          where: { teamId_emailNormalized: { teamId: req.auth!.teamId, emailNormalized: email } },
          create: {
            teamId: req.auth!.teamId,
            email,
            emailNormalized: email,
            firstName,
            lastName,
            fullName,
            jobTitle: input.jobTitle?.trim() || null,
            companyName: input.companyName?.trim() || null,
            companyDomain,
            companyWebsite: input.companyWebsite?.trim() || null,
            country: input.country?.trim() || null,
            city: input.city?.trim() || null,
            linkedinUrl: input.linkedinUrl?.trim() || null,
            sourceType: 'CUSTOM_URL_LIST',
            sourceUrl: 'manual-entry',
            matchedKeywords: [],
            niches: [],
            aiTags: [],
            technologies: [],
            status: 'NEW',
          },
          update: {
            // Refresh data on dedupe — don't overwrite scoring/verification
            firstName: firstName ?? undefined,
            lastName: lastName ?? undefined,
            fullName: fullName ?? undefined,
            jobTitle: input.jobTitle?.trim() || undefined,
            companyName: input.companyName?.trim() || undefined,
            companyDomain: companyDomain ?? undefined,
            companyWebsite: input.companyWebsite?.trim() || undefined,
            linkedinUrl: input.linkedinUrl?.trim() || undefined,
            country: input.country?.trim() || undefined,
            city: input.city?.trim() || undefined,
          },
        });

        // Insert vs update detection
        const isNew = Math.abs(upserted.createdAt.getTime() - upserted.updatedAt.getTime()) < 100;
        if (isNew) {
          summary.added++;
          addedIds.push(upserted.id);
        } else {
          summary.updated++;
        }

        if (body.verify && isNew) {
          await verificationQueue.add('verify', { leadId: upserted.id, email, teamId: req.auth!.teamId });
        }
      } catch (err) {
        summary.errors++;
      }
    }

    res.json({ summary, addedIds });
  } catch (e) { next(e); }
});

export default r;
