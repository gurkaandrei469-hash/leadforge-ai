import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { extractionQueue, verificationQueue, exportQueue } from '../workers/queues.js';
import { verifyEmail } from '../verification/verifier.js';
import { compileFilterToWhere } from '../filters/engine.js';
import { Errors } from '../utils/errors.js';
import { pushManyToHubspot } from './hubspot.js';
import { ddgSearch } from '../scraping/searchEngines.js';

/** Context passed to every tool — derived from the authenticated request. */
export interface ToolContext {
  userId: string;
  teamId: string;
  role: string;
}

/** A tool the Claude agent can call. */
export interface Tool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  handler: (input: any, ctx: ToolContext) => Promise<unknown>;
}

// ─────────────────────────── TOOL HANDLERS ───────────────────────────

// Two modes the assistant supports:
//   1. keywords-based — assistant runs DDG/Brave/Serper over the keyword set and
//      crawls discovered URLs (no URL list needed from the user)
//   2. URL-list — explicit `urls` array supplied (existing behaviour)
// At least ONE of `keywords` or `urls` must be present. Refined below.
const VALID_SOURCES = [
  'WEB_SEARCH', 'DIRECTORY', 'COMPANY_PAGE', 'BLOG', 'FORUM',
  'SOCIAL_LINKEDIN', 'SOCIAL_TWITTER', 'CONTACT_PAGE', 'LISTING', 'DATABASE',
  'CUSTOM_URL_LIST',
] as const;

const createExtractionInput = z
  .object({
    name: z.string().min(2).max(120),
    // Mobile/chat-driven flow: free-text keywords ("B2B SaaS founders in Berlin").
    keywords: z.array(z.string().min(2)).min(1).max(20).optional(),
    // Power-user flow: explicit URLs to scrape.
    urls: z.array(z.string().url()).min(1).max(200).optional(),
    // Optional source-type list. Default depends on which mode is used.
    sources: z.array(z.enum(VALID_SOURCES)).min(1).max(11).optional(),
    target_leads: z.number().int().min(1).max(5000).default(50),
    priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  })
  .refine((d) => (d.keywords && d.keywords.length > 0) || (d.urls && d.urls.length > 0), {
    message: 'Provide either `keywords` (for keyword-based extraction) or `urls` (for URL-list extraction).',
    path: ['keywords'],
  });

const searchLeadsInput = z.object({
  query: z.string().optional(),
  job_id: z.string().optional(),
  verification_status: z.enum(['VALID', 'INVALID', 'RISKY', 'CATCH_ALL', 'UNKNOWN', 'PENDING']).optional(),
  min_quality_score: z.number().int().min(0).max(100).optional(),
  country: z.string().optional(),
  technology: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

const verifyEmailInput = z.object({ email: z.string().email() });
const exportInput = z.object({
  job_id: z.string().optional(),
  format: z.enum(['CSV', 'XLSX', 'JSON']).default('CSV'),
});

// ─────────────────────────── TOOLS ───────────────────────────

export const tools: Tool[] = [
  {
    name: 'create_extraction_job',
    description:
      'Start a lead extraction job. Two modes: ' +
      '(1) keyword search — pass `keywords` (e.g. ["SaaS marketing agency", "B2B sales consultant"]) and the system runs web search across configured sources to discover URLs automatically. ' +
      '(2) URL list — pass an explicit `urls` array if the user provided specific pages to scrape. ' +
      'At least one of `keywords` or `urls` is required. The job runs asynchronously.',
    input_schema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', description: 'Short descriptive name for the job (e.g. "SaaS founders Q2")' },
        keywords: {
          type: 'array',
          items: { type: 'string' },
          description: 'Free-text search keywords. Use this when the user says "find me X" without providing URLs.',
        },
        urls: {
          type: 'array',
          items: { type: 'string', format: 'uri' },
          description: 'Explicit URLs to scrape (1-200). Use ONLY if the user provided URLs.',
        },
        sources: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['WEB_SEARCH', 'DIRECTORY', 'COMPANY_PAGE', 'BLOG', 'FORUM',
                   'SOCIAL_LINKEDIN', 'SOCIAL_TWITTER', 'CONTACT_PAGE', 'LISTING', 'DATABASE', 'CUSTOM_URL_LIST'],
          },
          description: 'Source channels to extract from. Defaults: ["WEB_SEARCH","DIRECTORY","BLOG"] for keywords, ["CUSTOM_URL_LIST"] for urls.',
        },
        target_leads: { type: 'integer', default: 50, description: 'Target number of leads to extract' },
        priority: { type: 'string', enum: ['LOW', 'NORMAL', 'HIGH', 'URGENT'], default: 'NORMAL' },
      },
    },
    async handler(input, ctx) {
      const body = createExtractionInput.parse(input);
      const team = await prisma.team.findUnique({ where: { id: ctx.teamId } });
      if (!team) throw Errors.notFound('Team');
      // Lead extraction is unlimited for all users — no credit gate.

      // Decide sources + build filter tree.
      // Keyword mode picks broad-yield defaults; URL mode locks to CUSTOM_URL_LIST.
      const hasUrls = body.urls && body.urls.length > 0;
      const hasKeywords = body.keywords && body.keywords.length > 0;

      let sources: string[];
      if (body.sources?.length) {
        sources = body.sources;
      } else if (hasKeywords && !hasUrls) {
        sources = ['WEB_SEARCH', 'DIRECTORY', 'BLOG'];
      } else if (hasUrls && !hasKeywords) {
        sources = ['CUSTOM_URL_LIST'];
      } else {
        // Both supplied — broad search + the user's URLs.
        sources = ['WEB_SEARCH', 'DIRECTORY', 'BLOG', 'CUSTOM_URL_LIST'];
      }

      const filterTree: any = { AND: [] };
      if (hasKeywords) {
        filterTree.AND.push({ field: 'keyword', operator: 'in', value: body.keywords });
      }
      if (hasUrls) filterTree.__urls__ = body.urls;

      const job = await prisma.extractionJob.create({
        data: {
          teamId: ctx.teamId,
          createdById: ctx.userId,
          name: body.name,
          sources: sources as any,
          filters: filterTree,
          targetLeads: body.target_leads,
          priority: body.priority,
          status: 'QUEUED',
        },
      });

      const bull = await extractionQueue.add('extract', { jobId: job.id, teamId: job.teamId }, {
        priority: { LOW: 4, NORMAL: 3, HIGH: 2, URGENT: 1 }[body.priority],
      });
      await prisma.extractionJob.update({ where: { id: job.id }, data: { bullJobId: bull.id?.toString() } });

      // Tailor the summary so the assistant can echo back a useful confirmation.
      const inputDescription = hasKeywords
        ? `keywords: ${body.keywords!.slice(0, 3).join(', ')}${body.keywords!.length > 3 ? '…' : ''}`
        : `${body.urls!.length} URL${body.urls!.length === 1 ? '' : 's'}`;

      return {
        job_id: job.id,
        name: job.name,
        status: job.status,
        target_leads: job.targetLeads,
        sources,
        message: `Job queued. Mode: ${inputDescription}. Sources: ${sources.join(', ')}. Check status with get_job_status.`,
      };
    },
  },

  {
    name: 'get_job_status',
    description:
      'Get the current status of an extraction job. Pass EITHER `job_id` (CUID) OR `job_name` ' +
      '(partial, case-insensitive — matches the most recent job whose name contains the given text).',
    input_schema: {
      type: 'object',
      properties: {
        job_id:   { type: 'string', description: 'Exact CUID. Use this when you have the ID from create_extraction_job.' },
        job_name: { type: 'string', description: 'Partial job name. Resolves to the most recent matching job.' },
      },
    },
    async handler({ job_id, job_name }, ctx) {
      let job;
      if (job_id) {
        job = await prisma.extractionJob.findFirst({
          where: { id: job_id, teamId: ctx.teamId },
          include: { _count: { select: { leads: true } } },
        });
      } else if (job_name) {
        // Case-insensitive substring match, newest first. Way more forgiving
        // than exact equality which never worked in practice.
        job = await prisma.extractionJob.findFirst({
          where: { teamId: ctx.teamId, name: { contains: job_name, mode: 'insensitive' } },
          orderBy: { createdAt: 'desc' },
          include: { _count: { select: { leads: true } } },
        });
      } else {
        // Neither provided — fall back to "most recent job on this team".
        job = await prisma.extractionJob.findFirst({
          where: { teamId: ctx.teamId },
          orderBy: { createdAt: 'desc' },
          include: { _count: { select: { leads: true } } },
        });
      }
      if (!job) throw Errors.notFound('Job');
      return {
        job_id: job.id,
        name: job.name,
        status: job.status,
        progress: job.progress,
        leads_found: job.leadsFound,
        leads_verified: job.leadsVerified,
        pages_scraped: job.pagesScraped,
        target_leads: job.targetLeads,
        started_at: job.startedAt,
        completed_at: job.completedAt,
        error: job.errorMessage,
      };
    },
  },

  {
    name: 'list_recent_jobs',
    description: 'List the user\'s most recent extraction jobs (last 10 by default).',
    input_schema: {
      type: 'object',
      properties: { limit: { type: 'integer', default: 10, maximum: 50 } },
    },
    async handler({ limit = 10 }, ctx) {
      const jobs = await prisma.extractionJob.findMany({
        where: { teamId: ctx.teamId },
        orderBy: { createdAt: 'desc' },
        take: Math.min(limit, 50),
        select: { id: true, name: true, status: true, leadsFound: true, targetLeads: true, createdAt: true, progress: true },
      });
      return { jobs };
    },
  },

  {
    name: 'search_leads',
    description:
      'Search the user\'s ALREADY-EXTRACTED leads stored in their workspace. ' +
      'Use this when the user asks about leads they already have (e.g. "show me my CFO leads", ' +
      '"how many valid emails do I have", "find leads at stripe.com in my database"). ' +
      'DO NOT use this to find brand-new leads from the web — that is what create_extraction_job is for. ' +
      'Supports filtering by job, verification status, quality score, country, technology, or a free-text query (email/name/company).',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-text match on email/name/company' },
        job_id: { type: 'string' },
        verification_status: { type: 'string', enum: ['VALID', 'INVALID', 'RISKY', 'CATCH_ALL', 'UNKNOWN', 'PENDING'] },
        min_quality_score: { type: 'integer', minimum: 0, maximum: 100 },
        country: { type: 'string' },
        technology: { type: 'string', description: 'e.g. shopify, wordpress, react' },
        limit: { type: 'integer', default: 20, maximum: 100 },
      },
    },
    async handler(input, ctx) {
      const q = searchLeadsInput.parse(input);
      const where: any = { teamId: ctx.teamId };
      if (q.query) {
        where.OR = [
          { email: { contains: q.query, mode: 'insensitive' } },
          { fullName: { contains: q.query, mode: 'insensitive' } },
          { companyName: { contains: q.query, mode: 'insensitive' } },
        ];
      }
      if (q.job_id) where.jobId = q.job_id;
      if (q.verification_status) where.verificationStatus = q.verification_status;
      if (q.min_quality_score != null) where.qualityScore = { gte: q.min_quality_score };
      if (q.country) where.country = q.country;
      if (q.technology) where.technologies = { has: q.technology };

      const [leads, total] = await Promise.all([
        prisma.lead.findMany({
          where,
          take: q.limit,
          orderBy: { qualityScore: 'desc' },
          select: {
            id: true, email: true, fullName: true, jobTitle: true,
            companyName: true, country: true, linkedinUrl: true,
            qualityScore: true, verificationStatus: true, technologies: true,
          },
        }),
        prisma.lead.count({ where }),
      ]);
      return { leads, total };
    },
  },

  {
    name: 'verify_email',
    description: 'Run the full 6-layer verification on a single email address: syntax, disposable, MX, SMTP, catch-all, role-account.',
    input_schema: {
      type: 'object',
      required: ['email'],
      properties: { email: { type: 'string', format: 'email' } },
    },
    async handler(input) {
      const { email } = verifyEmailInput.parse(input);
      const result = await verifyEmail(email);
      return {
        email: result.email,
        status: result.status,
        score: result.score,
        confidence: result.confidence,
        syntax_valid: result.syntaxValid,
        is_disposable: result.isDisposable,
        mx_valid: result.mxValid,
        smtp_deliverable: result.smtpDeliverable,
        is_catch_all: result.isCatchAll,
        is_role_account: result.isRoleAccount,
        reason: result.reason,
      };
    },
  },

  {
    name: 'bulk_verify_unverified',
    description: 'Queue background verification for ALL leads in a job that haven\'t been verified yet. Returns the count enqueued.',
    input_schema: {
      type: 'object',
      required: ['job_id'],
      properties: { job_id: { type: 'string' } },
    },
    async handler({ job_id }, ctx) {
      const leads = await prisma.lead.findMany({
        where: { jobId: job_id, teamId: ctx.teamId, verificationStatus: { in: ['PENDING', 'UNKNOWN'] }, email: { not: null } },
        select: { id: true, email: true },
      });
      await verificationQueue.addBulk(
        leads.map((l) => ({
          name: 'verify',
          data: { leadId: l.id, email: l.email!, teamId: ctx.teamId },
        })),
      );
      return { queued: leads.length };
    },
  },

  {
    name: 'create_export',
    description: 'Generate a CSV/XLSX/JSON export of leads. If job_id is provided, exports only that job\'s leads; otherwise exports all team leads.',
    input_schema: {
      type: 'object',
      required: ['format'],
      properties: {
        job_id: { type: 'string', description: 'Optional: restrict to this job' },
        format: { type: 'string', enum: ['CSV', 'XLSX', 'JSON'], default: 'CSV' },
      },
    },
    async handler(input, ctx) {
      const body = exportInput.parse(input);
      const exp = await prisma.export.create({
        data: {
          teamId: ctx.teamId,
          format: body.format,
          jobId: body.job_id,
          status: 'PENDING',
        },
      });
      await exportQueue.add('export', {
        exportId: exp.id,
        teamId: ctx.teamId,
        format: body.format,
        jobId: body.job_id,
      });
      return {
        export_id: exp.id,
        format: exp.format,
        status: exp.status,
        message: 'Export queued. Will be available at /settings/billing → Exports when ready.',
      };
    },
  },

  {
    name: 'get_team_usage',
    description: 'Get the team\'s plan tier and lifetime usage stats. Lead extraction has no quota — every user gets unlimited extractions.',
    input_schema: { type: 'object', properties: {} },
    async handler(_input, ctx) {
      const team = await prisma.team.findUnique({
        where: { id: ctx.teamId },
        select: { name: true, planTier: true },
      });
      const [leadCount, jobCount, runningJobs] = await Promise.all([
        prisma.lead.count({ where: { teamId: ctx.teamId } }),
        prisma.extractionJob.count({ where: { teamId: ctx.teamId } }),
        prisma.extractionJob.count({ where: { teamId: ctx.teamId, status: 'RUNNING' } }),
      ]);
      return {
        workspace: team?.name,
        plan: team?.planTier,
        extractions_unlimited: true,
        total_leads_extracted: leadCount,
        total_jobs: jobCount,
        jobs_running_now: runningJobs,
      };
    },
  },

  {
    name: 'push_to_hubspot',
    description:
      'Push leads to the connected HubSpot account as Contacts. Either provide explicit lead_ids or a job_id to push all leads from that job. Requires the team to have connected HubSpot in Settings → Integrations.',
    input_schema: {
      type: 'object',
      properties: {
        lead_ids: { type: 'array', items: { type: 'string' }, description: 'Specific leads to push' },
        job_id: { type: 'string', description: 'Push all leads from this job' },
      },
    },
    async handler(input, ctx) {
      const body = z.object({
        lead_ids: z.array(z.string()).optional(),
        job_id: z.string().optional(),
      }).parse(input);

      const conn = await prisma.crmConnection.findUnique({
        where: { teamId_provider: { teamId: ctx.teamId, provider: 'HUBSPOT' } },
      });
      if (!conn || !conn.isActive) throw Errors.badRequest('HubSpot not connected. Go to Settings → Integrations.');

      let leadIds: string[];
      if (body.lead_ids?.length) {
        leadIds = body.lead_ids;
      } else if (body.job_id) {
        const ls = await prisma.lead.findMany({
          where: { teamId: ctx.teamId, jobId: body.job_id, email: { not: null } },
          select: { id: true },
          take: 200,
        });
        leadIds = ls.map((l) => l.id);
      } else {
        throw Errors.badRequest('Provide lead_ids or job_id');
      }
      if (leadIds.length === 0) return { pushed: 0, failed: 0, skipped: 0, message: 'No leads to push' };
      return pushManyToHubspot(conn.id, leadIds);
    },
  },

  {
    name: 'web_search',
    description:
      'Free DuckDuckGo search for any query. Returns the top result URLs. Use this when the user asks to find sites, companies, or directories, then feed the URLs to create_extraction_job to actually scrape them for emails.',
    input_schema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string' },
        limit: { type: 'integer', default: 10, maximum: 30 },
      },
    },
    async handler({ query, limit = 10 }) {
      const results = await ddgSearch(query, Math.min(limit, 30));
      return { query, results };
    },
  },

  {
    name: 'write_cold_email',
    description:
      'Draft a personalized cold outreach email for a specific lead. Returns subject + body with merge tags {{first_name}}, {{company}}, {{job_title}}. Body uses plain text with newlines. Pass goal (e.g. "book a 15 min demo") and optional tone (default professional + warm).',
    input_schema: {
      type: 'object',
      required: ['lead_id', 'goal'],
      properties: {
        lead_id: { type: 'string' },
        goal: { type: 'string', description: 'What you want from this email — meeting, demo, intro, etc.' },
        tone: { type: 'string', enum: ['professional', 'casual', 'warm', 'urgent'], default: 'professional' },
        product_pitch: { type: 'string', description: 'One-sentence pitch of your product to weave in.' },
      },
    },
    async handler(input, ctx) {
      const body = z.object({
        lead_id: z.string(),
        goal: z.string().min(5),
        tone: z.enum(['professional', 'casual', 'warm', 'urgent']).default('professional'),
        product_pitch: z.string().optional(),
      }).parse(input);

      const lead = await prisma.lead.findFirst({
        where: { id: body.lead_id, teamId: ctx.teamId },
      });
      if (!lead) throw Errors.notFound('Lead');

      const fname = lead.firstName ?? lead.fullName?.split(' ')[0] ?? 'there';
      const role = lead.jobTitle ?? 'your role';
      const company = lead.companyName ?? 'your company';
      const tech = lead.technologies?.slice(0, 2).join(' + ') ?? '';

      // Hand-crafted templates by tone (no LLM call here — keeps the tool cheap and deterministic)
      const TEMPLATES: Record<string, { subject: string; body: string }> = {
        professional: {
          subject: `Quick question about ${company}`,
          body:
`Hi ${fname},

I noticed ${company}${tech ? ` runs on ${tech}` : ''} — impressive work as ${role}.

${body.product_pitch ?? 'We help B2B teams ship verified, scored leads in under 5 minutes.'} The reason I'm reaching out: ${body.goal}.

Would you be open to a brief chat next week?

Best,
{{full_name}}`,
        },
        casual: {
          subject: `${fname} — saw what you're building at ${company}`,
          body:
`Hey ${fname},

Genuinely impressed with what you and the team at ${company} are doing.

Quick one — ${body.product_pitch ?? 'we built a tool that finds and verifies B2B leads in minutes'}. Wanted to see if it'd be useful for what you're working on. ${body.goal}.

Worth 10 min next week?

Cheers,
{{full_name}}`,
        },
        warm: {
          subject: `Loved your work at ${company}`,
          body:
`Hi ${fname},

I've been following ${company} for a while and your work as ${role} stood out — exactly the kind of growth motion we built our product to support.

${body.product_pitch ?? 'We help teams like yours skip the lead-research grind entirely.'} I'd love to ${body.goal}.

Open to a coffee chat?

Warm regards,
{{full_name}}`,
        },
        urgent: {
          subject: `Time-sensitive — quick win for ${company}`,
          body:
`${fname},

Saw the team at ${company} is scaling fast — wanted to reach out while it's still timely.

${body.product_pitch ?? 'Our tool helps growth teams cut lead-research time by 90%.'} The ask is small: ${body.goal}.

15 min this week?

— {{full_name}}`,
        },
      };

      const picked = TEMPLATES[body.tone] ?? TEMPLATES.professional!;
      return {
        lead_id: lead.id,
        lead_email: lead.email,
        subject: picked.subject.replace('{{first_name}}', fname),
        body: picked.body,
        tone: body.tone,
        merge_tags_used: ['first_name', 'full_name', 'company', 'job_title'],
      };
    },
  },

  {
    name: 'generate_icebreaker',
    description:
      'Generate a 1-2 sentence personalized opener for a cold email or LinkedIn message, based on what we know about the lead.',
    input_schema: {
      type: 'object',
      required: ['lead_id'],
      properties: {
        lead_id: { type: 'string' },
        signal: {
          type: 'string',
          description: 'Optional specific hook — e.g. "hiring 5 engineers", "raised Series B", "launched new product".',
        },
      },
    },
    async handler(input, ctx) {
      const body = z.object({
        lead_id: z.string(),
        signal: z.string().optional(),
      }).parse(input);

      const lead = await prisma.lead.findFirst({ where: { id: body.lead_id, teamId: ctx.teamId } });
      if (!lead) throw Errors.notFound('Lead');

      const fname = lead.firstName ?? lead.fullName?.split(' ')[0] ?? 'there';
      const role = lead.jobTitle ?? 'your role';
      const company = lead.companyName ?? 'your company';
      const tech = lead.technologies?.[0];

      const candidates: string[] = [];
      if (body.signal) {
        candidates.push(`Hi ${fname}, congrats on ${body.signal} at ${company} — exciting milestone.`);
      }
      if (tech) {
        candidates.push(`Hi ${fname}, noticed ${company} is on ${tech} — a stack we work closely with.`);
      }
      candidates.push(
        `Hi ${fname}, your work as ${role} at ${company} caught my eye.`,
        `Hi ${fname}, been following ${company} — your team is moving fast.`,
      );

      return {
        lead_id: lead.id,
        icebreakers: candidates.slice(0, 3),
      };
    },
  },

  {
    name: 'add_leads_to_list',
    description: 'Add a set of leads to a saved list. Creates the list if `list_name` is provided and no matching list exists.',
    input_schema: {
      type: 'object',
      required: ['lead_ids'],
      properties: {
        lead_ids: { type: 'array', items: { type: 'string' }, minItems: 1 },
        list_id: { type: 'string', description: 'Existing list to add to' },
        list_name: { type: 'string', description: 'Create a new list with this name' },
      },
    },
    async handler(input, ctx) {
      const body = z.object({
        lead_ids: z.array(z.string()).min(1),
        list_id: z.string().optional(),
        list_name: z.string().min(1).max(120).optional(),
      }).parse(input);

      if (!body.list_id && !body.list_name) throw Errors.badRequest('Provide list_id or list_name');

      let listId = body.list_id;
      if (!listId) {
        const created = await prisma.leadList.upsert({
          where: { teamId_name: { teamId: ctx.teamId, name: body.list_name! } },
          create: { teamId: ctx.teamId, name: body.list_name!, createdById: ctx.userId },
          update: {},
        });
        listId = created.id;
      }

      const validLeads = await prisma.lead.findMany({
        where: { id: { in: body.lead_ids }, teamId: ctx.teamId },
        select: { id: true },
      });
      const result = await prisma.leadListMembership.createMany({
        data: validLeads.map((l) => ({ listId: listId!, leadId: l.id })),
        skipDuplicates: true,
      });
      return { list_id: listId, added: result.count };
    },
  },

  {
    name: 'guess_emails',
    description:
      'Generate likely email patterns for a person at a given company domain (e.g. first.last@company.com, flast@company.com, etc.) and verify each one. Returns only the patterns that pass verification.',
    input_schema: {
      type: 'object',
      required: ['first_name', 'last_name', 'domain'],
      properties: {
        first_name: { type: 'string' },
        last_name: { type: 'string' },
        domain: { type: 'string', description: 'Company domain like "stripe.com"' },
      },
    },
    async handler({ first_name, last_name, domain }) {
      const fn = String(first_name).toLowerCase().replace(/[^a-z]/g, '');
      const ln = String(last_name).toLowerCase().replace(/[^a-z]/g, '');
      const d = String(domain).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      const candidates = [
        `${fn}.${ln}@${d}`,
        `${fn}${ln}@${d}`,
        `${fn[0]}${ln}@${d}`,
        `${fn}${ln[0]}@${d}`,
        `${fn}@${d}`,
        `${fn}_${ln}@${d}`,
        `${fn}-${ln}@${d}`,
      ];
      const results = await Promise.all(candidates.map(async (email) => {
        try {
          const r = await verifyEmail(email);
          return { email, status: r.status, score: r.score, reason: r.reason };
        } catch {
          return { email, status: 'ERROR', score: 0, reason: 'verify_threw' };
        }
      }));
      const viable = results.filter((r) => r.status === 'VALID' || r.status === 'RISKY' || r.status === 'CATCH_ALL');
      return { candidates_tested: results, viable };
    },
  },
];
