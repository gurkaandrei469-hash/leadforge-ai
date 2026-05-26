'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Search, Users, BadgeCheck, BarChart3, Settings, CreditCard,
  Key, FileCode2, ListTodo, Sparkles, Plug, FolderHeart, Building2, Send, Mail,
} from 'lucide-react';
import { WorkspaceSwitcher } from './workspace-switcher';

interface Team {
  id: string;
  name: string;
  planTier: string;
  creditsTotal: number;
  creditsUsed: number;
}

const NAV_SECTIONS = [
  {
    label: 'Workspace',
    items: [
      { href: '/dashboard',  label: 'Overview',       icon: LayoutDashboard, hot: false },
      { href: '/assistant',  label: 'AI Assistant',   icon: Sparkles,        hot: true },
      { href: '/extraction', label: 'New Extraction', icon: Search,          hot: false },
    ],
  },
  {
    label: 'Pipeline',
    items: [
      { href: '/jobs',         label: 'Jobs',          icon: ListTodo,    hot: false },
      { href: '/leads',        label: 'Leads',         icon: Users,       hot: false },
      { href: '/lists',        label: 'Lead Lists',    icon: FolderHeart, hot: true  },
      { href: '/companies',    label: 'Companies',     icon: Building2,   hot: true  },
      { href: '/verification', label: 'Verification',  icon: BadgeCheck,  hot: false },
    ],
  },
  {
    label: 'Outreach',
    items: [
      { href: '/campaigns',                     label: 'Campaigns',         icon: Send, hot: true },
      { href: '/settings/sending-accounts',     label: 'Sending accounts',  icon: Mail, hot: true },
      { href: '/analytics',                     label: 'Analytics',         icon: BarChart3, hot: false },
    ],
  },
  {
    label: 'Settings',
    items: [
      { href: '/settings/integrations', label: 'Integrations', icon: Plug,        hot: false },
      { href: '/settings/billing',      label: 'Billing',      icon: CreditCard,  hot: false },
      { href: '/settings/api-keys',     label: 'API Keys',     icon: Key,         hot: false },
      { href: '/settings',              label: 'Settings',     icon: Settings,    hot: false },
      { href: '/docs',                  label: 'API Docs',     icon: FileCode2,   hot: false },
    ],
  },
];

export function Sidebar({ team, onNavigate }: { team: Team | null; onNavigate?: () => void }) {
  const pathname = usePathname();

  // Pick the most specific matching route as "active" (longest prefix wins).
  const allHrefs = NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.href));
  const activeHref = allHrefs
    .filter((h) => pathname === h || pathname.startsWith(h + '/'))
    .sort((a, b) => b.length - a.length)[0];

  return (
    <aside className="flex h-full w-full flex-col border-r border-border/60 bg-card/95 backdrop-blur-md no-select md:sticky md:top-0 md:h-screen">
      {/* Logo */}
      <div className="flex h-16 items-center border-b border-border/60 px-5">
        <Link href="/dashboard" className="flex items-center gap-2 text-lg font-bold tracking-tight">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-grad-brand shadow-sm glow-primary">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          LeadForge<span className="text-grad-brand">.AI</span>
        </Link>
      </div>

      {/* Workspace switcher */}
      <div className="border-b border-border/60 p-3">
        <WorkspaceSwitcher initialTeam={team} />
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto p-3">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label} className="mb-5">
            <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              {section.label}
            </div>
            <div className="space-y-0.5">
              {section.items.map(({ href, label, icon: Icon, hot }) => {
                const active = activeHref === href;
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={onNavigate}
                    className={`group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all duration-150 md:py-2 ${
                      active
                        ? 'bg-primary/10 font-semibold text-primary shadow-sm'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground active:bg-accent/80'
                    }`}
                  >
                    {active && (
                      <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-grad-brand" />
                    )}
                    <Icon className={`h-4 w-4 shrink-0 transition-transform group-hover:scale-110 ${active ? 'text-primary' : ''}`} />
                    <span className="truncate">{label}</span>
                    {hot && !active && (
                      <span className="ml-auto rounded-full bg-grad-brand px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">
                        New
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer upgrade card */}
      {team?.planTier === 'FREE' && (
        <div className="border-t border-border/60 p-3">
          <Link
            href="/settings/billing"
            className="block rounded-xl border bg-grad-brand p-4 text-white shadow-sm transition-transform hover:scale-[1.02]"
          >
            <div className="text-sm font-semibold">Upgrade to Pro</div>
            <div className="mt-1 text-xs text-white/80">12,000 leads · AI scoring · HubSpot sync</div>
            <div className="mt-2 inline-flex items-center gap-1 text-xs font-semibold">
              See plans →
            </div>
          </Link>
        </div>
      )}
    </aside>
  );
}
