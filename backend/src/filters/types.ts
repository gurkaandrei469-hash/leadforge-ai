import { z } from 'zod';

// 13+ filter types from spec
export const FilterField = z.enum([
  'niche',              // industry/vertical
  'industry',
  'domain_extension',   // .com, .ai, .io
  'country',
  'region',
  'city',
  'language',
  'keyword',            // body match
  'companyName',
  'companyDomain',
  'companySize',        // SMB / Mid / Enterprise
  'companyRevenue',
  'companyAuthority',   // domain rating proxy
  'jobTitle',
  'jobRole',
  'jobSeniority',
  'jobDepartment',
  'technology',         // tech stack: react, shopify, ...
  'social_presence',    // has linkedin / twitter / github
  'has_email',
  'has_phone',
  'has_contact_page',
  'qualityScore',
  'relevanceScore',
  'intentScore',
  'authorityScore',
  'verificationStatus',
  'createdAt',
  'sourceType',
]);
export type FilterField = z.infer<typeof FilterField>;

export const FilterOperator = z.enum([
  'eq', 'neq',
  'in', 'nin',
  'contains', 'starts_with', 'ends_with',
  'gt', 'gte', 'lt', 'lte',
  'between',
  'exists', 'not_exists',
  'has_any', 'has_all',
]);
export type FilterOperator = z.infer<typeof FilterOperator>;

const ScalarValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const ArrayValue = z.array(ScalarValue);
const FilterValue = z.union([ScalarValue, ArrayValue]);

export const Condition = z.object({
  field: FilterField,
  operator: FilterOperator,
  value: FilterValue,
});
export type Condition = z.infer<typeof Condition>;

// Filter accepts any of: a Condition, an AND/OR/NOT group, or empty-group ("match all").
// Special top-level `__urls__` field is allowed and passes through for CUSTOM_URL_LIST jobs.
const UrlsField = z.object({ __urls__: z.array(z.string().url()).optional() }).partial();

export const FilterSchema: z.ZodType<any> = z.lazy(() =>
  z.union([
    Condition,
    z.object({ AND: z.array(FilterSchema) }).merge(UrlsField).passthrough(),
    z.object({ OR: z.array(FilterSchema) }).merge(UrlsField).passthrough(),
    z.object({ NOT: FilterSchema }).merge(UrlsField).passthrough(),
    UrlsField.passthrough(),
  ]),
);
export type Filter =
  | Condition
  | { AND: Filter[] }
  | { OR: Filter[] }
  | { NOT: Filter };
