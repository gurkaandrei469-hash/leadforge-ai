import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  CLERK_SECRET_KEY: z.string().min(1),
  CLERK_PUBLISHABLE_KEY: z.string().min(1),
  CLERK_JWT_VERIFICATION_KEY: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().default('google/gemma-4-26b-a4b-it:free'),
  // Groq — fastest free inference for chat + tool use. Primary provider for the assistant.
  // DeepSeek R1 Distill 70B = best reasoning. Llama 3.3 70B = best general agent. Llama 3.1 8B Instant = fastest.
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().default('llama-3.3-70b-versatile'),
  ASSISTANT_MODEL: z.string().default('claude-sonnet-4-5'),
  MOCK_AGENT: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1')
    .pipe(z.boolean())
    .default('false' as any),
  BRAVE_SEARCH_API_KEY: z.string().optional(),
  SERPER_API_KEY: z.string().optional(),
  // Domain Hunter enrichment APIs (all free tiers)
  HUNTER_API_KEY:   z.string().optional(),
  HUNTER_API_KEY_2: z.string().optional(),
  HUNTER_API_KEY_3: z.string().optional(),
  APOLLO_API_KEY:   z.string().optional(),
  PDL_API_KEY:      z.string().optional(),
  // Multi-key Serper rotation — increases monthly quota N×
  SERPER_API_KEY_2: z.string().optional(),
  SERPER_API_KEY_3: z.string().optional(),
  SERPER_API_KEY_4: z.string().optional(),
  SERPER_API_KEY_5: z.string().optional(),
  // GitHub token — raises rate limit 60 → 5000 req/hr for OSINT scans
  GITHUB_TOKEN:     z.string().optional(),
  // EmailRep.io — optional key improves rate limits for fast-verify
  EMAILREP_API_KEY: z.string().optional(),
  SMTP_VERIFY_FROM: z.string().email().default('verify@leadforge.ai'),
  SMTP_VERIFY_TIMEOUT_MS: z.coerce.number().default(10000),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  // Google OAuth (Gmail sending + IMAP read access via XOAUTH2)
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().optional(), // e.g. http://localhost:4000/api/v1/sending-accounts/gmail/callback

  // Microsoft 365 / Outlook OAuth (Azure AD app registration)
  MICROSOFT_OAUTH_CLIENT_ID: z.string().optional(),
  MICROSOFT_OAUTH_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_OAUTH_REDIRECT_URI: z.string().optional(),
  // 'common' = personal + work accounts, 'consumers' = personal only, '<tenant-id>' = single tenant
  MICROSOFT_OAUTH_TENANT: z.string().default('common'),
  PUBLIC_URL: z.string().optional(), // e.g. http://localhost:4000 — used in tracking + redirects
  PUBLIC_APP_URL: z.string().optional(), // e.g. http://localhost:3000 — front-end origin for post-OAuth redirects
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60_000),
  // 600/min — dashboards with multiple tiles + polled workspace switcher +
  // SSE keep-alive can easily fire 50+ requests per page load without being
  // abusive. High-frequency endpoints get 4× this internally.
  RATE_LIMIT_MAX: z.coerce.number().default(600),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export const env = schema.parse(process.env);
export type Env = z.infer<typeof schema>;
