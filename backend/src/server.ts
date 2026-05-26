import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import { env } from './config/env.js';
import { apiRouter } from './api/index.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { rateLimit } from './middleware/rateLimit.js';
import { authenticate } from './middleware/auth.js';
import { jobProgressSSE } from './api/sse.js';
import { logger } from './utils/logger.js';

const app = express();

// Trust X-Forwarded-* headers from the Next.js rewrite proxy / ngrok / Cloudflare.
// Without this, req.ip is always the proxy and rate-limiting breaks.
app.set('trust proxy', 1);

app.use(helmet());

// CORS — supports multiple comma-separated origins AND wildcard patterns like "*.ngrok-free.app".
// Examples: CORS_ORIGIN="http://localhost:3000,https://*.ngrok-free.app,https://*.trycloudflare.com"
const allowedOrigins = env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);
const wildcardPatterns = allowedOrigins
  .filter((o) => o.includes('*'))
  .map((o) => new RegExp('^' + o.replace(/\./g, '\\.').replace(/\*/g, '[^.]+') + '$'));
const exactOrigins = allowedOrigins.filter((o) => !o.includes('*'));

app.use(cors({
  origin: (origin, cb) => {
    // Allow no-origin (server-to-server, curl, mobile apps)
    if (!origin) return cb(null, true);
    if (exactOrigins.includes(origin)) return cb(null, true);
    if (wildcardPatterns.some((re) => re.test(origin))) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));
app.use(compression());
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Stripe webhook needs raw body — mount before json parser
import billingRoutes from './api/routes/billing.js';
app.use('/api/v1/billing', billingRoutes);

app.use(express.json({ limit: '5mb' }));

app.get('/health', (_req, res) => res.json({ ok: true, version: '0.1.0' }));
app.get('/ready', async (_req, res) => {
  try {
    const { prisma } = await import('./db/prisma.js');
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ready: true });
  } catch { res.status(503).json({ ready: false }); }
});

app.get('/api/v1/jobs/:jobId/stream', authenticate, jobProgressSSE);

app.use('/api/v1', rateLimit, apiRouter);

app.use(notFoundHandler);
app.use(errorHandler);

// Bind to 0.0.0.0 so Next.js rewrites + tunnel forwarders can reach us
// even when the request originates outside the loopback interface.
const HOST = process.env.HOST ?? '0.0.0.0';
app.listen(env.PORT, HOST, () => {
  logger.info({ host: HOST, port: env.PORT, env: env.NODE_ENV, publicUrl: env.PUBLIC_URL }, 'API listening');
});
