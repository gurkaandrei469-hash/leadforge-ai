# LeadForge AI

Intelligent B2B lead extraction and email discovery SaaS platform.

## Stack
- **Frontend**: Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS, shadcn/ui
- **Backend**: Node.js 20, Express, TypeScript, Prisma ORM
- **Database**: PostgreSQL 16, Redis 7
- **Queue**: BullMQ
- **Scraping**: Playwright, Cheerio
- **Auth**: Clerk (JWT)
- **Infra**: Docker Compose (dev), Vercel + AWS ECS (prod)

## Layout
```
LeadForge-AI/
├── backend/        Node.js API + workers + verification + filters
├── frontend/       Next.js dashboard
├── docs/           Architecture, API spec, schema, wireframes
└── infrastructure/ Docker + nginx configs
```

## Quick Start
```bash
docker compose -f infrastructure/docker/docker-compose.yml up -d
cd backend && npm install && npm run db:migrate && npm run dev
cd frontend && npm install && npm run dev
```

API: `http://localhost:4000` · Dashboard: `http://localhost:3000`

See [docs/](./docs) for architecture, schema, API spec, wireframes.
