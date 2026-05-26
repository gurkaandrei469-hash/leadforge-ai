'use client';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Sparkles, X, Maximize2 } from 'lucide-react';
import Link from 'next/link';
import { AssistantChat } from './chat-core';

const STORAGE_KEY = 'leadforge_assistant_widget_open';

export function AssistantWidget() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Restore widget state across navigations (per-session, not per-page)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setOpen(sessionStorage.getItem(STORAGE_KEY) === '1');
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    sessionStorage.setItem(STORAGE_KEY, open ? '1' : '0');
  }, [open]);

  // Don't render on the dedicated /assistant page (would be a double-widget)
  if (pathname === '/assistant') return null;

  return (
    <>
      {/* Floating Action Button — lifted above iOS home indicator on mobile */}
      <button
        onClick={() => setOpen(!open)}
        aria-label="Toggle AI Assistant"
        style={{ bottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}
        className={`fixed right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full shadow-lg ring-1 ring-border/50 transition-all hover:scale-105 hover:shadow-xl sm:right-6 ${
          open
            ? 'bg-card text-muted-foreground'
            : 'bg-gradient-to-br from-primary to-primary/70 text-primary-foreground'
        }`}
      >
        {open ? <X className="h-5 w-5" /> : <Sparkles className="h-6 w-6" />}
        {!open && (
          <span className="absolute -inset-1 -z-10 animate-pulse rounded-full bg-primary/30 blur-md" />
        )}
      </button>

      {/* Chat panel — full-screen on mobile, floating panel on desktop */}
      {open && (
        <div
          className="fixed inset-x-0 bottom-0 z-40 flex h-[85svh] flex-col overflow-hidden rounded-t-2xl border bg-background shadow-2xl ring-1 ring-border/50 safe-bottom sm:inset-x-auto sm:bottom-24 sm:right-6 sm:h-[600px] sm:max-h-[80vh] sm:w-[420px] sm:rounded-2xl"
          role="dialog"
        >
          <AssistantChat
            variant="compact"
            persistKey="leadforge_assistant_chat"
            headerExtra={
              <>
                <Link
                  href="/assistant"
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  title="Open full assistant"
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                </Link>
                <button
                  onClick={() => setOpen(false)}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  title="Close"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </>
            }
          />
        </div>
      )}
    </>
  );
}
