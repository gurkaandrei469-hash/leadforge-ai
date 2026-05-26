import Link from 'next/link';
import {
  ArrowRight, Search, Mail, Brain, Zap, ShieldCheck, Globe2, Plug, BarChart3,
  CheckCircle2, Star, Sparkles, TrendingUp, Database, Filter,
} from 'lucide-react';

const LOGOS = ['Stripe', 'Shopify', 'Notion', 'Linear', 'Vercel', 'HubSpot', 'Pipedrive', 'Mailchimp'];

const FEATURES = [
  { icon: Search,    title: 'Smart Discovery',          desc: 'Scrape 10+ source types with 13+ advanced filters — niche, country, role, tech stack.' },
  { icon: Mail,      title: '6-Layer Verification',     desc: 'Syntax + MX + SMTP + catch-all + disposable + role detection. Sub-bounce-rate guaranteed.' },
  { icon: Brain,     title: 'AI Lead Scoring',          desc: 'GPT-class models score every lead 0–100 on quality, intent, and authority.' },
  { icon: Sparkles,  title: 'AI Task Manager',          desc: 'Conversational agent on every page — extract, verify, export, push to CRM by chat.' },
  { icon: Plug,      title: 'Native HubSpot Sync',      desc: 'One-click push to your CRM. Salesforce + Pipedrive next.' },
  { icon: Zap,       title: 'Real-time Pipeline',       desc: '1000+ leads/min via BullMQ. Live SSE progress, pause/resume, cron schedules.' },
];

const STATS = [
  { k: '12M+',  v: 'Leads extracted',     icon: Database },
  { k: '95%+',  v: 'Email deliverability', icon: ShieldCheck },
  { k: '180+',  v: 'Countries supported',  icon: Globe2 },
  { k: '<3s',   v: 'Avg query response',   icon: TrendingUp },
];

const PRICING = [
  { tier: 'Free',    price: 0,   credits: 100,     features: ['100 leads/mo', 'All core filters', 'CSV export'],                                 cta: 'Start free' },
  { tier: 'Starter', price: 29,  credits: 2_500,   features: ['2,500 leads/mo', 'Email verification', 'XLSX/JSON exports', 'Priority email'],   cta: 'Pick Starter' },
  { tier: 'Pro',     price: 99,  credits: 12_000,  features: ['12,000 leads/mo', 'AI scoring', 'HubSpot sync', 'Team accounts (5)', 'Webhooks'], cta: 'Pick Pro', featured: true },
  { tier: 'Business', price: 299,credits: 50_000,  features: ['50,000 leads/mo', 'Unlimited team', 'CRM integrations', 'Priority queue + SLA'],  cta: 'Pick Business' },
];

const TESTIMONIALS = [
  {
    quote: 'Replaced two Apollo seats and a Hunter.io subscription with LeadForge. We pulled 8,400 verified SaaS founder emails in the first weekend.',
    author: 'Maya Chen',
    role: 'Head of Growth, Orbital Labs',
  },
  {
    quote: 'The 6-layer verification is the real deal — our bounce rate dropped from 14% to under 2% on the first campaign. The AI agent alone justifies the price.',
    author: 'Tom Schmidt',
    role: 'CRO, RetailPro',
  },
  {
    quote: 'We schedule recurring extractions on Mondays at 9am, the leads land in HubSpot, and our SDRs start dialing by 9:15. It just works.',
    author: 'Lina Park',
    role: 'Demand Gen Lead, Acme SaaS',
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* ─────────────────── NAV ─────────────────── */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur-md">
        <div className="container flex h-16 items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-grad-brand text-white shadow-sm">
              <Sparkles className="h-4 w-4" />
            </div>
            LeadForge<span className="text-grad-brand">.AI</span>
          </Link>
          <nav className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
            <Link href="#features"     className="hover:text-foreground">Features</Link>
            <Link href="#pricing"      className="hover:text-foreground">Pricing</Link>
            <Link href="#testimonials" className="hover:text-foreground">Customers</Link>
            <Link href="/docs"         className="hover:text-foreground">API</Link>
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground">Sign in</Link>
            <Link
              href="/signup"
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-grad-brand px-4 text-sm font-medium text-white shadow-sm transition-transform hover:scale-[1.02] hover:shadow-md"
            >
              Start free <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* ─────────────────── HERO ─────────────────── */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-grid-fade" />
        <div className="absolute -top-40 left-1/2 -z-10 h-[500px] w-[800px] -translate-x-1/2 rounded-full bg-grad-brand opacity-20 blur-3xl" />

        <div className="container py-24 md:py-32">
          <div className="mx-auto max-w-4xl text-center">
            <Link
              href="/assistant"
              className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary"
            >
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
              </span>
              New · AI Task Manager — run jobs by chat
              <ArrowRight className="h-3 w-3" />
            </Link>

            <h1 className="mt-6 text-5xl font-bold tracking-tight md:text-7xl">
              Find your ideal customers
              <br />
              <span className="text-grad-brand">in minutes, not weeks.</span>
            </h1>

            <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground md:text-xl">
              LeadForge AI scrapes, verifies, and AI-classifies leads from across the web —
              <span className="text-foreground"> 13+ filters</span>, <span className="text-foreground">6-layer email verification</span>,
              and a conversational agent that runs the whole pipeline for you.
            </p>

            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/signup"
                className="inline-flex h-11 items-center gap-2 rounded-lg bg-grad-brand px-6 text-sm font-semibold text-white shadow-md transition-all hover:scale-[1.02] hover:shadow-lg glow-primary"
              >
                Start free — 100 credits <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/pricing"
                className="inline-flex h-11 items-center gap-2 rounded-lg border bg-card px-6 text-sm font-medium transition-colors hover:bg-accent"
              >
                See pricing
              </Link>
            </div>

            <p className="mt-4 text-xs text-muted-foreground">
              No credit card · 30-day money-back guarantee · GDPR & CAN-SPAM compliant
            </p>
          </div>

          {/* Floating dashboard preview */}
          <div className="relative mx-auto mt-16 max-w-5xl">
            <div className="absolute -inset-4 rounded-3xl bg-grad-brand opacity-20 blur-2xl" />
            <div className="card-elevated relative overflow-hidden p-1">
              <div className="rounded-lg border bg-muted/30 p-6">
                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                  {STATS.map((s) => (
                    <div key={s.v} className="rounded-lg border bg-card p-4">
                      <div className="flex items-center justify-between">
                        <s.icon className="h-4 w-4 text-primary" />
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">live</span>
                      </div>
                      <div className="mt-2 text-2xl font-bold tabular-nums tracking-tight">{s.k}</div>
                      <div className="text-xs text-muted-foreground">{s.v}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─────────────────── LOGO BAR ─────────────────── */}
      <section className="border-y bg-muted/30 py-10">
        <div className="container">
          <p className="text-center text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Trusted by growth teams at
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-12 gap-y-4 text-lg font-bold text-muted-foreground/60">
            {LOGOS.map((l) => (
              <span key={l} className="grayscale opacity-80 transition-opacity hover:opacity-100">{l}</span>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────────────── FEATURES ─────────────────── */}
      <section id="features" className="container py-24">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-wider text-primary">Everything you need</p>
          <h2 className="mt-3 text-4xl font-bold tracking-tight md:text-5xl">
            One platform. The whole lead pipeline.
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            From scraping to verification to AI scoring to CRM sync — built to replace 4 tools you're already paying for.
          </p>
        </div>

        <div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="card-elevated group relative overflow-hidden p-6"
            >
              <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-grad-brand opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-10" />
              <div className="relative">
                <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl border bg-gradient-to-br from-primary/15 to-primary/5">
                  <f.icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="mt-4 text-lg font-semibold">{f.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ─────────────────── TESTIMONIALS ─────────────────── */}
      <section id="testimonials" className="border-y bg-muted/30 py-24">
        <div className="container">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-semibold uppercase tracking-wider text-primary">Customers</p>
            <h2 className="mt-3 text-4xl font-bold tracking-tight">Growth teams ship faster on LeadForge</h2>
          </div>

          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {TESTIMONIALS.map((t) => (
              <div key={t.author} className="card-elevated p-6">
                <div className="flex gap-0.5 text-amber-500">
                  {[...Array(5)].map((_, i) => <Star key={i} className="h-4 w-4 fill-current" />)}
                </div>
                <blockquote className="mt-4 text-sm leading-relaxed">"{t.quote}"</blockquote>
                <div className="mt-5 flex items-center gap-3 border-t pt-4">
                  <div className="grid h-9 w-9 place-items-center rounded-full bg-grad-brand text-xs font-bold text-white">
                    {t.author.split(' ').map(p => p[0]).join('')}
                  </div>
                  <div>
                    <div className="text-sm font-semibold">{t.author}</div>
                    <div className="text-xs text-muted-foreground">{t.role}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────────────── PRICING ─────────────────── */}
      <section id="pricing" className="container py-24">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-wider text-primary">Pricing</p>
          <h2 className="mt-3 text-4xl font-bold tracking-tight">Simple, usage-based</h2>
          <p className="mt-3 text-lg text-muted-foreground">Start free. Pay only for what you use. Cancel anytime.</p>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-4">
          {PRICING.map((p) => (
            <div
              key={p.tier}
              className={`relative rounded-xl border bg-card p-6 transition-shadow hover:shadow-lg ${
                p.featured ? 'border-primary shadow-lg ring-2 ring-primary/30' : ''
              }`}
            >
              {p.featured && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-grad-brand px-3 py-0.5 text-xs font-semibold text-white shadow-sm">
                  Most popular
                </div>
              )}
              <h3 className="text-lg font-semibold">{p.tier}</h3>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-4xl font-bold tracking-tight tabular-nums">${p.price}</span>
                <span className="text-sm text-muted-foreground">/mo</span>
              </div>
              <p className="text-sm text-muted-foreground">{p.credits.toLocaleString()} credits</p>
              <ul className="mt-6 space-y-2.5 text-sm">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> {f}
                  </li>
                ))}
              </ul>
              <Link
                href={`/signup?plan=${p.tier.toLowerCase()}`}
                className={`mt-6 block rounded-md py-2 text-center text-sm font-semibold transition-colors ${
                  p.featured
                    ? 'bg-grad-brand text-white shadow-sm hover:opacity-90'
                    : 'border hover:bg-accent'
                }`}
              >
                {p.cta}
              </Link>
            </div>
          ))}
        </div>

        <p className="mt-8 text-center text-xs text-muted-foreground">
          All plans include 30-day money-back guarantee · GDPR & CAN-SPAM compliant · SOC 2 in progress
        </p>
      </section>

      {/* ─────────────────── CTA BAND ─────────────────── */}
      <section className="container pb-24">
        <div className="relative overflow-hidden rounded-2xl border bg-grad-brand p-10 text-center text-white shadow-xl md:p-14">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.15),transparent_60%)]" />
          <div className="relative">
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
              Stop paying for 4 tools. Use one.
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-white/90">
              100 free leads. No credit card. Your first verified list ready in under 5 minutes.
            </p>
            <Link
              href="/signup"
              className="mt-7 inline-flex h-12 items-center gap-2 rounded-lg bg-white px-7 text-sm font-bold text-primary shadow-md transition-transform hover:scale-[1.02]"
            >
              Start free <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* ─────────────────── FOOTER ─────────────────── */}
      <footer className="border-t bg-muted/20 py-8">
        <div className="container flex flex-col items-center justify-between gap-4 text-xs text-muted-foreground md:flex-row">
          <div className="flex items-center gap-2">
            <div className="grid h-5 w-5 place-items-center rounded bg-grad-brand">
              <Sparkles className="h-3 w-3 text-white" />
            </div>
            © 2026 LeadForge AI · All rights reserved
          </div>
          <div className="flex gap-6">
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/docs">API</Link>
            <Link href="/contact">Contact</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
