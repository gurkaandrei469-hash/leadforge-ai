import axios, { AxiosError } from 'axios';
import { prisma } from '../db/prisma.js';
import { logger } from '../utils/logger.js';
import type { Lead } from '@prisma/client';

const HUBSPOT_BASE = 'https://api.hubapi.com';

/**
 * Test a HubSpot Private App access token by hitting the account info endpoint.
 * Returns { ok, hubId, accountLabel } on success.
 */
export async function testHubspotToken(token: string) {
  try {
    const res = await axios.get(`${HUBSPOT_BASE}/account-info/v3/details`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10_000,
    });
    return {
      ok: true as const,
      hubId: res.data?.portalId,
      accountLabel: res.data?.companyName ?? `Hub ${res.data?.portalId}`,
    };
  } catch (err) {
    const e = err as AxiosError;
    return { ok: false as const, error: (e.response?.data as any)?.message ?? e.message };
  }
}

function buildContactProperties(lead: Lead) {
  const props: Record<string, string | undefined> = {
    email: lead.email ?? undefined,
    firstname: lead.firstName ?? undefined,
    lastname: lead.lastName ?? undefined,
    company: lead.companyName ?? undefined,
    website: lead.companyWebsite ?? undefined,
    jobtitle: lead.jobTitle ?? undefined,
    phone: undefined,
    city: lead.city ?? undefined,
    country: lead.country ?? undefined,
    linkedin: lead.linkedinUrl ?? undefined,
    twitterhandle: lead.twitterUrl ?? undefined,
    lifecyclestage: 'lead',
    hs_lead_status: 'NEW',
    // LeadForge-specific custom fields (HubSpot will silently ignore unknown ones)
    leadforge_quality_score: lead.qualityScore?.toString(),
    leadforge_verification_status: lead.verificationStatus,
    leadforge_source_url: lead.sourceUrl,
  };
  return Object.fromEntries(Object.entries(props).filter(([_, v]) => v != null && v !== ''));
}

/**
 * Push a single lead to HubSpot as a Contact.
 * Uses upsert semantics: if a contact with the email exists, update it; else create.
 */
export async function pushLeadToHubspot(token: string, lead: Lead): Promise<{ externalId: string; isNew: boolean }> {
  if (!lead.email) throw new Error('Lead has no email — cannot sync to HubSpot');

  const properties = buildContactProperties(lead);

  // Try create first; on 409 conflict (already exists), do an update by email
  try {
    const res = await axios.post(
      `${HUBSPOT_BASE}/crm/v3/objects/contacts`,
      { properties },
      { headers: { Authorization: `Bearer ${token}` }, timeout: 15_000 },
    );
    return { externalId: res.data.id, isNew: true };
  } catch (err) {
    const e = err as AxiosError;
    if (e.response?.status === 409) {
      // Conflict — contact exists, update by email
      const idMatch = (e.response.data as any)?.message?.match(/Existing ID: (\d+)/);
      const contactId = idMatch?.[1];
      if (contactId) {
        await axios.patch(
          `${HUBSPOT_BASE}/crm/v3/objects/contacts/${contactId}`,
          { properties },
          { headers: { Authorization: `Bearer ${token}` }, timeout: 15_000 },
        );
        return { externalId: contactId, isNew: false };
      }
    }
    throw new Error((e.response?.data as any)?.message ?? e.message);
  }
}

/**
 * Push many leads in bulk. Records each push in CrmPush table.
 * Stops on auth failures (401/403). Keeps going on per-contact errors.
 */
export async function pushManyToHubspot(connectionId: string, leadIds: string[]): Promise<{
  pushed: number;
  failed: number;
  skipped: number;
  errors: Array<{ leadId: string; error: string }>;
}> {
  const connection = await prisma.crmConnection.findUnique({ where: { id: connectionId } });
  if (!connection || !connection.isActive) throw new Error('CRM connection inactive');

  const leads = await prisma.lead.findMany({
    where: { id: { in: leadIds }, teamId: connection.teamId },
  });

  let pushed = 0, failed = 0, skipped = 0;
  const errors: Array<{ leadId: string; error: string }> = [];

  for (const lead of leads) {
    if (!lead.email) {
      skipped++;
      await prisma.crmPush.upsert({
        where: { connectionId_leadId: { connectionId, leadId: lead.id } },
        create: { connectionId, leadId: lead.id, status: 'SKIPPED', errorMessage: 'no email' },
        update: { status: 'SKIPPED', errorMessage: 'no email' },
      });
      continue;
    }
    try {
      const r = await pushLeadToHubspot(connection.accessToken, lead);
      pushed++;
      await prisma.crmPush.upsert({
        where: { connectionId_leadId: { connectionId, leadId: lead.id } },
        create: { connectionId, leadId: lead.id, externalId: r.externalId, status: 'SUCCESS' },
        update: { externalId: r.externalId, status: 'SUCCESS', errorMessage: null },
      });
    } catch (err) {
      failed++;
      const msg = (err as Error).message;
      errors.push({ leadId: lead.id, error: msg });
      await prisma.crmPush.upsert({
        where: { connectionId_leadId: { connectionId, leadId: lead.id } },
        create: { connectionId, leadId: lead.id, status: 'FAILED', errorMessage: msg },
        update: { status: 'FAILED', errorMessage: msg },
      });
      if (/401|403|unauthorized|invalid token/i.test(msg)) {
        logger.warn({ connectionId }, 'HubSpot auth failed — disabling connection');
        await prisma.crmConnection.update({ where: { id: connectionId }, data: { isActive: false } });
        break;
      }
    }
  }

  await prisma.crmConnection.update({
    where: { id: connectionId },
    data: {
      lastSyncAt: new Date(),
      totalPushed: { increment: pushed },
    },
  });

  return { pushed, failed, skipped, errors: errors.slice(0, 10) };
}
