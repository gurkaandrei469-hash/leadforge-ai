import { Worker, Job } from 'bullmq';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { redis } from '../db/redis.js';
import { prisma } from '../db/prisma.js';
import { compileFilterToWhere } from '../filters/engine.js';
import { logger } from '../utils/logger.js';
import fs from 'node:fs/promises';
import path from 'node:path';

const EXPORT_DIR = process.env.EXPORT_DIR ?? '/tmp/leadforge-exports';

export const exportWorker = new Worker(
  'export',
  async (job: Job<{ exportId: string; teamId: string; format: 'CSV'|'XLSX'|'JSON'; filter?: any; leadIds?: string[]; jobId?: string }>) => {
    const { exportId, teamId, format, filter, leadIds, jobId } = job.data;
    await prisma.export.update({ where: { id: exportId }, data: { status: 'PROCESSING' } });

    let where: any = { teamId };
    if (leadIds?.length) where.id = { in: leadIds };
    else if (jobId) where.jobId = jobId;
    else if (filter) where = compileFilterToWhere(filter, teamId);

    const leads = await prisma.lead.findMany({
      where,
      include: { verification: true },
      take: 100_000,
    });

    const rows = leads.map((l) => ({
      email: l.email,
      firstName: l.firstName,
      lastName: l.lastName,
      jobTitle: l.jobTitle,
      companyName: l.companyName,
      companyDomain: l.companyDomain,
      country: l.country,
      city: l.city,
      linkedinUrl: l.linkedinUrl,
      qualityScore: l.qualityScore,
      verificationStatus: l.verificationStatus,
      sourceUrl: l.sourceUrl,
      createdAt: l.createdAt.toISOString(),
    }));

    await fs.mkdir(EXPORT_DIR, { recursive: true });
    const ext = format.toLowerCase();
    const filename = `export-${exportId}.${ext}`;
    const fullPath = path.join(EXPORT_DIR, filename);

    if (format === 'CSV') {
      await fs.writeFile(fullPath, Papa.unparse(rows));
    } else if (format === 'JSON') {
      await fs.writeFile(fullPath, JSON.stringify(rows, null, 2));
    } else {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Leads');
      XLSX.writeFile(wb, fullPath);
    }

    const stat = await fs.stat(fullPath);
    // TODO: upload to S3 and return signed URL
    await prisma.export.update({
      where: { id: exportId },
      data: {
        status: 'READY',
        leadCount: rows.length,
        fileUrl: `/exports/${filename}`,
        fileSizeBytes: stat.size,
        completedAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 86400_000),
      },
    });

    logger.info({ exportId, leadCount: rows.length, size: stat.size }, 'Export ready');
  },
  { connection: redis, concurrency: 3 },
);
