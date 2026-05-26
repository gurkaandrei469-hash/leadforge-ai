# LeadForge AI — Production Deployment Guide

Total time: **~1 hour**. Zero credit card required for the free tiers I'm recommending.

## Stack at a glance

| Tier | What runs there | Why |
|---|---|---|
| **Neon** | Postgres database | Free 500MB, serverless, no card |
| **Upstash** | Redis (BullMQ queue) | Free 10k commands/day, TLS, no card |
| **Railway** | Backend API + Workers | Free $5/mo credit on signup, Docker-first |
| **Vercel** | Frontend (Next.js) | Free hobby plan, made for Next.js |

After deployment you get a real URL like `leadforge.vercel.app` that works 24/7 on every device, no tunnel needed.

---

## 1. Database — Neon

1. Sign up at https://neon.tech (GitHub login, no card)
2. Click **Create project** → name it `leadforge` → region closest to you
3. From the dashboard, copy the **Pooled connection string** (the longer one with `-pooler` in the hostname)

   It looks like:
   ```
   postgresql://user:pass@ep-abc-123-pooler.us-east-2.aws.neon.tech/leadforge?sslmode=require
   ```

4. **Save this** — you'll paste it into Railway as `DATABASE_URL`.

> ⚠️ Use the **pooled** connection string for the API, not the direct one. The Prisma client opens many short-lived connections; the pooler prevents Neon from running out.

---

## 2. Redis — Upstash

1. Sign up at https://upstash.com (GitHub login, no card)
2. **Create database** → name it `leadforge-redis` → region closest to your Railway region → primary type: **Regional**
3. From the database page, copy the **Redis URL (TLS)** under "Connect to your database"

   It looks like:
   ```
   rediss://default:abc123@us1-leading-tarpon-12345.upstash.io:6379
   ```

   Note the `rediss://` (extra `s` = TLS). ioredis auto-handles this.

4. **Save this** — you'll paste it into Railway as `REDIS_URL`.

---

## 3. Backend — Railway

Railway is the only host that runs persistent Node services AND lets you SSH/run scripts on them for free.

### 3a. Push the repo to GitHub

If you haven't already:
```bash
cd /Users/emreteknoloji/LeadForge-AI
git add .
git commit -m "Ready for production deploy"
git remote add origin git@github.com:YOUR_USER/leadforge-ai.git
git push -u origin main
```

### 3b. Create the Railway project

1. Sign up at https://railway.com (GitHub login, no card needed for free $5 credit)
2. **New project** → **Deploy from GitHub repo** → pick your `leadforge-ai` repo
3. Railway will auto-detect the `backend/Dockerfile` and start building

### 3c. Configure the API service

Once the first deploy starts:

1. Click into the auto-created service → **Settings** tab
2. **Root Directory** → set to `backend`
3. **Custom Start Command** → leave blank (the Dockerfile's CMD handles it)
4. **Generate Domain** under Networking → gives you `something.up.railway.app`. Copy this — it's your `PUBLIC_URL`.

### 3d. Set environment variables

Variables tab → bulk-paste this template (replace placeholders):

```bash
NODE_ENV=production
PORT=4000

# Neon (from step 1)
DATABASE_URL=postgresql://user:pass@ep-...-pooler.us-east-2.aws.neon.tech/leadforge?sslmode=require

# Upstash (from step 2)
REDIS_URL=rediss://default:...@us1-...upstash.io:6379

# Clerk — copy the LIVE keys from clerk.com once you set up a production instance.
# For testing first, use the same test keys you've been using locally.
CLERK_SECRET_KEY=sk_test_...
CLERK_PUBLISHABLE_KEY=pk_test_...

# LLM providers
GROQ_API_KEY=gsk_...
GROQ_MODEL=llama-3.3-70b-versatile
OPENROUTER_API_KEY=sk-or-v1-...
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-proj-...

# Mail
SMTP_VERIFY_FROM=verify@leadforge.ai
SMTP_VERIFY_TIMEOUT_MS=10000

# Public URLs — fill in AFTER you have the Railway + Vercel domains
PUBLIC_URL=https://YOUR-RAILWAY-DOMAIN.up.railway.app
PUBLIC_APP_URL=https://YOUR-VERCEL-DOMAIN.vercel.app
CORS_ORIGIN=https://YOUR-VERCEL-DOMAIN.vercel.app,https://*.vercel.app

# Google OAuth (Gmail Connect) — update redirect URI in Google Cloud Console too
GOOGLE_OAUTH_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-...
GOOGLE_OAUTH_REDIRECT_URI=https://YOUR-VERCEL-DOMAIN.vercel.app/api/backend/sending-accounts/gmail/callback

LOG_LEVEL=info
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=100
```

### 3e. Add the Workers service

The same code runs both API + workers, but they need separate processes.

1. From the project page → **+ New** → **Empty Service** → name it `workers`
2. **Settings** → **Source** → connect to the same GitHub repo
3. **Root Directory** → `backend`
4. **Custom Start Command** → `/app/start-worker.sh`
5. **Environment Variables** → click "Add Variable Reference" and link ALL the same vars from the API service (Railway lets you share via reference so you don't paste twice)
6. **No public domain needed** — workers don't accept HTTP traffic

> Workers and API share the Postgres + Redis but live as independent containers. If one crashes, the other keeps running.

### 3f. Wait for both services to go green

Both should show ✅ "Active" within 2-3 minutes. Hit `https://YOUR-RAILWAY-DOMAIN/health` in your browser — should return `{"ok":true,"version":"0.1.0"}`.

---

## 4. Frontend — Vercel

1. Sign up at https://vercel.com (GitHub login, no card)
2. **Add New** → **Project** → import your `leadforge-ai` repo
3. **Root Directory** → `frontend`
4. **Framework Preset** → Next.js (auto-detected)
5. **Environment Variables** → add these:

   ```bash
   NEXT_PUBLIC_API_URL=https://YOUR-RAILWAY-DOMAIN.up.railway.app
   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
   CLERK_SECRET_KEY=sk_test_...
   NEXT_PUBLIC_CLERK_SIGN_IN_URL=/login
   NEXT_PUBLIC_CLERK_SIGN_UP_URL=/signup
   NEXT_PUBLIC_CLERK_SIGN_IN_FORCE_REDIRECT_URL=/dashboard
   NEXT_PUBLIC_CLERK_SIGN_UP_FORCE_REDIRECT_URL=/dashboard
   ```

6. Click **Deploy**

In ~90 seconds you'll have `https://leadforge-ai.vercel.app` (or similar). Open it — should show the login page.

---

## 5. Wire the loose ends

### 5a. Update Railway's `PUBLIC_APP_URL` and `CORS_ORIGIN`

Go back to Railway → API service → Variables → set:

```
PUBLIC_APP_URL=https://leadforge-ai.vercel.app
CORS_ORIGIN=https://leadforge-ai.vercel.app
GOOGLE_OAUTH_REDIRECT_URI=https://leadforge-ai.vercel.app/api/backend/sending-accounts/gmail/callback
```

Railway auto-redeploys on env change.

### 5b. Update Google Cloud Console

The Gmail Connect button needs Google to know your new domain:

1. https://console.cloud.google.com/auth/clients → edit your OAuth client
2. **Authorised JavaScript origins**: add `https://leadforge-ai.vercel.app`
3. **Authorised redirect URIs**: add `https://leadforge-ai.vercel.app/api/backend/sending-accounts/gmail/callback`
4. Save

### 5c. Switch Clerk to Production (optional but recommended)

If you want a stable user database (test keys are easy to wipe):

1. https://clerk.com → **+ Create application** → **Production instance**
2. Add your Vercel domain in **Domains**
3. Copy the new `pk_live_…` and `sk_live_…` keys
4. Update them in Railway + Vercel env vars

Otherwise, keep the test keys — they work fine for hundreds of users.

---

## 6. Smoke test

1. Open `https://leadforge-ai.vercel.app` on your phone
2. Sign up with a new email
3. You should land on `/dashboard` with a fresh empty workspace
4. Try Connect Gmail → consent → confirm `?gmail=connected` toast
5. Go to **Sending Accounts** → click **Test send** → green toast
6. Create a campaign → add a recipient → launch → check the **Live monitor** for SENT status

If everything works, you're done. Your app is now live 24/7, accessible from any device, anywhere, even when your Mac is asleep.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Backend `/health` returns 502 | Build crashed | Railway → API service → **Deployments** → click latest → check **Build logs** |
| Prisma "Can't reach database" | `DATABASE_URL` typo or wrong pool | Use the **pooled** Neon string, not the direct one |
| `MaxRetriesPerRequestError` from BullMQ | Redis URL is `redis://` instead of `rediss://` | Use the TLS URL from Upstash |
| `CORS: origin … not allowed` | Frontend hostname not in `CORS_ORIGIN` | Add the Vercel URL (incl. preview deployments via `https://*.vercel.app`) |
| Gmail Connect → "redirect_uri_mismatch" | Google Cloud not updated | Add the new Vercel URL to the OAuth client's redirect URIs |
| Workers running but campaigns not sending | Different REDIS_URL between API + workers | Verify both services reference the SAME Upstash URL |

## Cost breakdown

| Service | Free tier | What you'd pay at scale |
|---|---|---|
| Neon | 500MB storage, 100 compute hours/mo | $19/mo for 10GB |
| Upstash | 10k commands/day | $0.20/100k commands |
| Railway | $5 credit/mo (~1 service running 24/7) | $5-20/mo for both services |
| Vercel | 100GB bandwidth | $20/mo Pro for team / commercial use |

Realistic cost for a small SaaS with ~100 users: **$0/month** until you hit Railway's $5 credit, then ~$15-25/month total.
