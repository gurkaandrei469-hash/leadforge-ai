import type { Prisma } from '@prisma/client';
import type { Filter, Condition } from './types.js';

// Maps virtual filter fields → concrete Lead columns
const FIELD_MAP: Record<string, string> = {
  niche: 'niche',
  industry: 'companyIndustry',
  country: 'country',
  region: 'region',
  city: 'city',
  language: 'language',
  companyName: 'companyName',
  companyDomain: 'companyDomain',
  companySize: 'companySize',
  companyRevenue: 'companyRevenue',
  companyAuthority: 'authorityScore',
  jobTitle: 'jobTitle',
  jobRole: 'jobRole',
  jobSeniority: 'jobSeniority',
  jobDepartment: 'jobDepartment',
  qualityScore: 'qualityScore',
  relevanceScore: 'relevanceScore',
  intentScore: 'intentScore',
  authorityScore: 'authorityScore',
  verificationStatus: 'verificationStatus',
  createdAt: 'createdAt',
  sourceType: 'sourceType',
};

const ARRAY_FIELDS: Record<string, string> = {
  technology: 'technologies',
  keyword: 'matchedKeywords',
};

// Virtual fields that need remapping in the in-memory evaluator
// (condToWhere handles them with specialised Prisma logic; evalCondition
//  just needs the underlying Lead column so exists/not_exists work correctly)
const VIRTUAL_FIELD_MAP: Record<string, string> = {
  has_email: 'email',
  has_phone: 'email',   // no phone column; treat as email presence for in-memory pass
  social_presence: 'linkedinUrl',
};

function condToWhere(c: Condition): Prisma.LeadWhereInput {
  // Specialized fields
  switch (c.field) {
    case 'domain_extension': {
      const exts = (Array.isArray(c.value) ? c.value : [c.value]).map(String);
      const ors = exts.map((ext) => ({ companyDomain: { endsWith: ext.startsWith('.') ? ext : `.${ext}` } }));
      return { OR: ors as any };
    }
    case 'social_presence': {
      const platform = String(c.value);
      const map: Record<string, keyof Prisma.LeadWhereInput> = {
        linkedin: 'linkedinUrl',
        twitter: 'twitterUrl',
        facebook: 'facebookUrl',
        instagram: 'instagramUrl',
        github: 'githubUrl',
      };
      const key = map[platform];
      if (!key) return {};
      return c.operator === 'not_exists' ? { [key]: null } as any : { [key]: { not: null } } as any;
    }
    case 'has_email':
      return c.value ? { email: { not: null } } : { email: null };
    case 'has_phone':
      return c.value ? { customFields: { path: ['phone'], not: null } as any } : {};
    case 'has_contact_page':
      return c.value ? { customFields: { path: ['contactPage'], not: null } as any } : {};
  }

  // Array-typed fields
  if (ARRAY_FIELDS[c.field]) {
    const col = ARRAY_FIELDS[c.field];
    const arr = Array.isArray(c.value) ? c.value.map(String) : [String(c.value)];
    switch (c.operator) {
      case 'has_any':
      case 'in':
        return { [col]: { hasSome: arr } } as any;
      case 'has_all':
        return { [col]: { hasEvery: arr } } as any;
      case 'nin':
        return { NOT: { [col]: { hasSome: arr } } } as any;
      case 'exists':
        return { [col]: { isEmpty: false } } as any;
      case 'not_exists':
        return { [col]: { isEmpty: true } } as any;
    }
  }

  // Standard scalar fields
  const col = FIELD_MAP[c.field];
  if (!col) return {};

  switch (c.operator) {
    case 'eq': return { [col]: c.value } as any;
    case 'neq': return { [col]: { not: c.value as any } } as any;
    case 'in': return { [col]: { in: c.value as any[] } } as any;
    case 'nin': return { [col]: { notIn: c.value as any[] } } as any;
    case 'contains': return { [col]: { contains: String(c.value), mode: 'insensitive' } } as any;
    case 'starts_with': return { [col]: { startsWith: String(c.value), mode: 'insensitive' } } as any;
    case 'ends_with': return { [col]: { endsWith: String(c.value), mode: 'insensitive' } } as any;
    case 'gt': return { [col]: { gt: c.value as any } } as any;
    case 'gte': return { [col]: { gte: c.value as any } } as any;
    case 'lt': return { [col]: { lt: c.value as any } } as any;
    case 'lte': return { [col]: { lte: c.value as any } } as any;
    case 'between': {
      const [a, b] = c.value as [any, any];
      return { [col]: { gte: a, lte: b } } as any;
    }
    case 'exists': return { [col]: { not: null } } as any;
    case 'not_exists': return { [col]: null } as any;
    default: return {};
  }
}

export function compileFilterToWhere(filter: Filter, teamId: string): Prisma.LeadWhereInput {
  const inner = walk(filter);
  return { AND: [{ teamId }, inner] };
}

function walk(f: Filter): Prisma.LeadWhereInput {
  if ('AND' in f) return { AND: f.AND.map(walk) };
  if ('OR' in f) return { OR: f.OR.map(walk) };
  if ('NOT' in f) return { NOT: walk(f.NOT) };
  return condToWhere(f);
}

// Optional: in-memory matcher for stream filtering during scrape
export function matchInMemory(filter: Filter, lead: Record<string, any>): boolean {
  if ('AND' in filter) return filter.AND.every((f) => matchInMemory(f, lead));
  if ('OR' in filter) return filter.OR.some((f) => matchInMemory(f, lead));
  if ('NOT' in filter) return !matchInMemory(filter.NOT, lead);
  return evalCondition(filter, lead);
}

function evalCondition(c: Condition, lead: Record<string, any>): boolean {
  const col = FIELD_MAP[c.field] ?? ARRAY_FIELDS[c.field] ?? VIRTUAL_FIELD_MAP[c.field] ?? c.field;
  const v = lead[col];
  switch (c.operator) {
    // Array-valued lead fields (matchedKeywords, technologies) need element-wise
    // semantics — comparing an array to a scalar with === always returns false,
    // which silently filtered out every keyword-tagged lead before this fix.
    case 'eq':
      if (Array.isArray(v)) return v.includes(c.value as any);
      return v === c.value;
    case 'neq':
      if (Array.isArray(v)) return !v.includes(c.value as any);
      return v !== c.value;
    case 'in':
      if (!Array.isArray(c.value)) return false;
      // Array field: ANY overlap counts. Scalar field: standard "field in set".
      if (Array.isArray(v)) return (c.value as any[]).some((x) => v.includes(x));
      return (c.value as any[]).includes(v);
    case 'nin':
      if (!Array.isArray(c.value)) return true;
      if (Array.isArray(v)) return !(c.value as any[]).some((x) => v.includes(x));
      return !(c.value as any[]).includes(v);
    case 'contains':
      // Array field: contains means "array has an element equal to value"
      if (Array.isArray(v)) return v.some((x) => typeof x === 'string' && x.toLowerCase().includes(String(c.value).toLowerCase()));
      return typeof v === 'string' && v.toLowerCase().includes(String(c.value).toLowerCase());
    case 'starts_with': return typeof v === 'string' && v.toLowerCase().startsWith(String(c.value).toLowerCase());
    case 'ends_with': return typeof v === 'string' && v.toLowerCase().endsWith(String(c.value).toLowerCase());
    case 'gt': return typeof v === 'number' && v > (c.value as number);
    case 'gte': return typeof v === 'number' && v >= (c.value as number);
    case 'lt': return typeof v === 'number' && v < (c.value as number);
    case 'lte': return typeof v === 'number' && v <= (c.value as number);
    case 'between': {
      const [a, b] = c.value as [number, number];
      return typeof v === 'number' && v >= a && v <= b;
    }
    case 'exists': return v !== null && v !== undefined;
    case 'not_exists': return v === null || v === undefined;
    case 'has_any': return Array.isArray(v) && Array.isArray(c.value) && c.value.some((x) => v.includes(x));
    case 'has_all': return Array.isArray(v) && Array.isArray(c.value) && c.value.every((x) => v.includes(x));
    default: return false;
  }
}
