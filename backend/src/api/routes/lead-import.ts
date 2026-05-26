import { Router } from 'express';
import { z } from 'zod';
import Papa from 'papaparse';
import { authenticate } from '../../middleware/auth.js';
import { prisma } from '../../db/prisma.js';
import { Errors } from '../../utils/errors.js';
import { verificationQueue } from '../../workers/queues.js';

const r = Router();

// Maps common CSV column names → our Lead fields (case-insensitive, whitespace-tolerant)
const FIELD_ALIASES: Record<string, string> = {
  email: 'email', emailaddress: 'email', email_address: 'email', work_email: 'email', mail: 'email',
  firstname: 'firstName', first_name: 'firstName', given_name: 'firstName', fname: 'firstName',
  lastname: 'lastName', last_name: 'lastName', surname: 'lastName', family_name: 'lastName', lname: 'lastName',
  fullname: 'fullName', full_name: 'fullName', name: 'fullName',
  jobtitle: 'jobTitle', job_title: 'jobTitle', title: 'jobTitle', position: 'jobTitle', role: 'jobTitle',
  jobrole: 'jobRole', job_role: 'jobRole',
  seniority: 'jobSeniority', level: 'jobSeniority',
  department: 'jobDepartment', dept: 'jobDepartment',
  company: 'companyName', companyname: 'companyName', company_name: 'companyName', organization: 'companyName', employer: 'companyName',
  domain: 'companyDomain', companydomain: 'companyDomain', company_domain: 'companyDomain',
  website: 'companyWebsite', companywebsite: 'companyWebsite', company_website: 'companyWebsite', url: 'companyWebsite',
  industry: 'companyIndustry', companyindustry: 'companyIndustry', company_industry: 'companyIndustry', sector: 'companyIndustry',
  companysize: 'companySize', company_size: 'companySize', employeecount: 'companySize', employees: 'companySize',
  revenue: 'companyRevenue', companyrevenue: 'companyRevenue',
  country: 'country',
  region: 'region', state: 'region',
  city: 'city',
  linkedin: 'linkedinUrl', linkedinurl: 'linkedinUrl', linkedin_url: 'linkedinUrl', li: 'linkedinUrl',
  twitter: 'twitterUrl', twitterurl: 'twitterUrl', x: 'twitterUrl',
  github: 'githubUrl',
  facebook: 'facebookUrl',
};

function normaliseHeader(raw: string): string {
  return raw.toLowerCase().replace(/[\s\-]+/g, '_').replace(/[^a-z0-9_]/g, '');
}

interface ImportSummary {
  parsed: number;
  imported: number;
  skipped_no_email: number;
  skipped_duplicate: number;
  errors: number;
  preview: Array<{ email: string; fullName?: string | null; companyName?: string | null }>;
}

const BodySchema = z.object({
  csv: z.string().min(1).max(20_000_000), // 20MB hard cap
  listId: z.string().optional(),
  verify: z.boolean().default(false),
  dryRun: z.boolean().default(false),
});

r.post('/', authenticate, async (req, res, next) => {
  try {
    const body = BodySchema.parse(req.body);

    const parsed = Papa.parse<Record<string, string>>(body.csv, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
    });

    if (parsed.errors.length > 0 && !parsed.data.length) {
      throw Errors.badRequest(`CSV parse failed: ${parsed.errors[0]!.message}`);
    }

    const rows = parsed.data;
    if (rows.length === 0) throw Errors.badRequest('No data rows found in CSV');

    // Build column→field map
    const headers = Object.keys(rows[0] ?? {});
    const columnMap: Record<string, string> = {};
    for (const h of headers) {
      const norm = normaliseHeader(h);
      if (FIELD_ALIASES[norm]) columnMap[h] = FIELD_ALIASES[norm]!;
    }

    if (!Object.values(columnMap).includes('email')) {
      throw Errors.badRequest('CSV must include an "email" column (or alias: email_address, work_email, mail, etc.)');
    }

    const summary: ImportSummary = { parsed: rows.length, imported: 0, skipped_no_email: 0, skipped_duplicate: 0, errors: 0, preview: [] };

    // Validate list (if provided)
    let listId = body.listId;
    if (listId) {
      const list = await prisma.leadList.findFirst({ where: { id: listId, teamId: req.auth!.teamId } });
      if (!list) throw Errors.notFound('List');
    }

    const importedLeadIds: string[] = [];

    for (const row of rows) {
      try {
        const lead: any = {};
        for (const [csvCol, ourField] of Object.entries(columnMap)) {
          const value = row[csvCol]?.trim();
          if (value) lead[ourField] = value;
        }

        const email = lead.email?.toLowerCase();
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          summary.skipped_no_email++;
          continue;
        }

        // Split fullName if firstName/lastName missing
        if (lead.fullName && !lead.firstName && !lead.lastName) {
          const parts = lead.fullName.split(/\s+/);
          lead.firstName = parts[0];
          if (parts.length > 1) lead.lastName = parts.slice(1).join(' ');
        }

        // Derive domain from companyWebsite or email
        if (!lead.companyDomain) {
          try {
            if (lead.companyWebsite) {
              lead.companyDomain = new URL(/^https?:/i.test(lead.companyWebsite) ? lead.companyWebsite : `https://${lead.companyWebsite}`).hostname.replace(/^www\./, '');
            } else if (email.split('@')[1]) {
              const d = email.split('@')[1]!;
              // Skip common free email providers as company domain
              if (!['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'aol.com'].includes(d)) {
                lead.companyDomain = d;
              }
            }
          } catch { /* ignore */ }
        }

        if (body.dryRun) {
          summary.imported++;
          if (summary.preview.length < 10) {
            summary.preview.push({ email, fullName: lead.fullName, companyName: lead.companyName });
          }
          continue;
        }

        // Upsert (dedupe by teamId + emailNormalized)
        const upserted = await prisma.lead.upsert({
          where: { teamId_emailNormalized: { teamId: req.auth!.teamId, emailNormalized: email } },
          create: {
            teamId: req.auth!.teamId,
            email,
            emailNormalized: email,
            firstName: lead.firstName ?? null,
            lastName: lead.lastName ?? null,
            fullName: lead.fullName ?? (lead.firstName ? [lead.firstName, lead.lastName].filter(Boolean).join(' ') : null),
            jobTitle: lead.jobTitle ?? null,
            jobRole: lead.jobRole ?? null,
            jobSeniority: lead.jobSeniority ?? null,
            jobDepartment: lead.jobDepartment ?? null,
            companyName: lead.companyName ?? null,
            companyDomain: lead.companyDomain ?? null,
            companyWebsite: lead.companyWebsite ?? null,
            companyIndustry: lead.companyIndustry ?? null,
            companySize: lead.companySize ?? null,
            companyRevenue: lead.companyRevenue ?? null,
            country: lead.country ?? null,
            region: lead.region ?? null,
            city: lead.city ?? null,
            linkedinUrl: lead.linkedinUrl ?? null,
            twitterUrl: lead.twitterUrl ?? null,
            githubUrl: lead.githubUrl ?? null,
            facebookUrl: lead.facebookUrl ?? null,
            sourceType: 'CUSTOM_URL_LIST',
            sourceUrl: 'csv-import',
            matchedKeywords: [],
            niches: [],
            aiTags: [],
            technologies: [],
            status: 'NEW',
          },
          update: {
            // On dedupe, refresh the data — but don't overwrite scoring
            firstName: lead.firstName ?? undefined,
            lastName: lead.lastName ?? undefined,
            fullName: lead.fullName ?? undefined,
            jobTitle: lead.jobTitle ?? undefined,
            companyName: lead.companyName ?? undefined,
            companyDomain: lead.companyDomain ?? undefined,
            companyWebsite: lead.companyWebsite ?? undefined,
            linkedinUrl: lead.linkedinUrl ?? undefined,
          },
        });

        // Was this an insert or an update? Crude check: createdAt vs updatedAt
        const isNew = Math.abs(upserted.createdAt.getTime() - upserted.updatedAt.getTime()) < 100;
        if (isNew) {
          summary.imported++;
          importedLeadIds.push(upserted.id);
          if (summary.preview.length < 10) {
            summary.preview.push({ email, fullName: upserted.fullName, companyName: upserted.companyName });
          }
        } else {
          summary.skipped_duplicate++;
        }

        if (body.verify && isNew && email) {
          await verificationQueue.add('verify', { leadId: upserted.id, email, teamId: req.auth!.teamId });
        }
      } catch (err) {
        summary.errors++;
      }
    }

    // Add to list if requested
    if (listId && importedLeadIds.length > 0 && !body.dryRun) {
      await prisma.leadListMembership.createMany({
        data: importedLeadIds.map((leadId) => ({ listId: listId!, leadId })),
        skipDuplicates: true,
      });
    }

    res.json({ summary, columnMap });
  } catch (e) { next(e); }
});

export default r;
