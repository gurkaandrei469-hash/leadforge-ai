import Link from 'next/link';
import { Check } from 'lucide-react';

const plans = [
  { tier: 'Free', price: 0, credits: 100, features: ['100 leads/mo', 'Basic filters', 'CSV export', 'Email support'] },
  { tier: 'Starter', price: 29, credits: 2_500, features: ['2,500 leads/mo', 'All filters', 'CSV/XLSX/JSON', 'Email verification', 'Priority email'], featured: false },
  { tier: 'Pro', price: 99, credits: 12_000, features: ['12,000 leads/mo', 'AI classification', 'API access', 'Team accounts (5)', 'Webhooks', 'Chat support'], featured: true },
  { tier: 'Business', price: 299, credits: 50_000, features: ['50,000 leads/mo', 'Unlimited team', 'CRM integrations', 'Priority queue', 'SLA + phone'] },
];

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container py-16">
        <div className="text-center">
          <h1 className="text-4xl font-bold tracking-tight">Simple, usage-based pricing</h1>
          <p className="mt-3 text-muted-foreground">Start free. Pay only for what you use. Cancel anytime.</p>
        </div>
        <div className="mt-12 grid gap-6 md:grid-cols-4">
          {plans.map((p) => (
            <div key={p.tier} className={`rounded-lg border p-6 ${p.featured ? 'border-primary ring-2 ring-primary' : ''}`}>
              {p.featured && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">Most popular</span>}
              <h3 className="mt-2 text-lg font-semibold">{p.tier}</h3>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-3xl font-bold">${p.price}</span>
                <span className="text-sm text-muted-foreground">/mo</span>
              </div>
              <p className="text-sm text-muted-foreground">{p.credits.toLocaleString()} credits</p>
              <ul className="mt-6 space-y-2 text-sm">
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2"><Check className="h-4 w-4 text-primary" />{f}</li>
                ))}
              </ul>
              <Link href={`/signup?plan=${p.tier.toLowerCase()}`} className="mt-6 block rounded-md border bg-primary py-2 text-center text-sm text-primary-foreground hover:opacity-90">
                Choose {p.tier}
              </Link>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
