'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Search, Building2, Loader2, Globe, Users, MapPin } from 'lucide-react';
import { useApi } from '@/lib/client-api';

interface Company {
  domain: string;
  name: string;
  website: string | null;
  industry: string | null;
  size: string | null;
  revenue: string | null;
  country: string | null;
  leadCount: number;
  technologies: string[];
}

export default function CompaniesPage() {
  const api = useApi();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  async function load() {
    setLoading(true);
    const qs = new URLSearchParams();
    if (search) qs.set('search', search);
    try {
      const res = await api.get<{ companies: Company[] }>(`/companies?${qs}`);
      setCompanies(res.companies);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [search]);

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Companies</h1>
        <p className="mt-1 text-sm text-muted-foreground">Every company in your pipeline, grouped by domain.</p>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search companies, domains…"
          className="w-full rounded-md border bg-background pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>

      {loading ? (
        <div className="card-elevated grid place-items-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : companies.length === 0 ? (
        <div className="card-elevated grid place-items-center py-16 text-center">
          <Building2 className="h-10 w-10 text-muted-foreground/40" />
          <h3 className="mt-3 font-semibold">No companies yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">Run an extraction to populate this view.</p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {companies.map((c) => (
            <Link
              key={c.domain}
              href={`/companies/${encodeURIComponent(c.domain)}`}
              className="card-elevated group p-5 transition-transform hover:scale-[1.01]"
            >
              <div className="flex items-start justify-between">
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary/15 to-primary/5">
                  <Building2 className="h-5 w-5 text-primary" />
                </div>
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold">
                  <Users className="h-2.5 w-2.5" /> {c.leadCount}
                </span>
              </div>
              <h3 className="mt-3 truncate font-semibold">{c.name}</h3>
              <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                <Globe className="h-3 w-3 shrink-0" />
                <span className="truncate font-mono">{c.domain}</span>
              </div>

              {(c.industry || c.country) && (
                <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
                  {c.industry && <span>{c.industry}</span>}
                  {c.industry && c.country && <span>·</span>}
                  {c.country && <span className="inline-flex items-center gap-1"><MapPin className="h-2.5 w-2.5" /> {c.country}</span>}
                </div>
              )}

              {c.technologies.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {c.technologies.slice(0, 4).map((t) => (
                    <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">{t}</span>
                  ))}
                  {c.technologies.length > 4 && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">+{c.technologies.length - 4}</span>
                  )}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
