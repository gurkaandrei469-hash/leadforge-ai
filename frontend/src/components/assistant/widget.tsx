'use client';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { X, Maximize2 } from 'lucide-react';
import Link from 'next/link';
import { AssistantChat } from './chat-core';

const STORAGE_KEY = 'leadforge_assistant_widget_open';
const HINT_DISMISSED_KEY = 'leadforge_assistant_hint_dismissed';

/**
 * Floating AI assistant widget — robot mascot with a friendly "Ask me anything"
 * hint bubble. Opening it morphs into a mobile bottom sheet positioned via the
 * visualViewport API (so keyboard never covers the input) or a desktop floating
 * card anchored bottom-right.
 *
 * On mobile we use TOP + HEIGHT positioning (not bottom + height) because iOS
 * Safari's bottom:0 silently slides under the on-screen keyboard. visualViewport
 * gives us the exact (top, height) rectangle of the visible viewport above the
 * keyboard, which works on iOS 15+ reliably.
 */
export function AssistantWidget() {
  const [open, setOpen] = useState(false);
  const [showHint, setShowHint] = useState(false);
  // Mobile sheet geometry derived from visualViewport.
  const [sheetTop, setSheetTop] = useState<number>(0);
  const [sheetHeight, setSheetHeight] = useState<number>(0);
  const pathname = usePathname();

  // ── Persist open/close across navigations ──────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setOpen(sessionStorage.getItem(STORAGE_KEY) === '1');
    setShowHint(localStorage.getItem(HINT_DISMISSED_KEY) !== '1');
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    sessionStorage.setItem(STORAGE_KEY, open ? '1' : '0');
    if (open) {
      localStorage.setItem(HINT_DISMISSED_KEY, '1');
      setShowHint(false);
    }
  }, [open]);

  // ── Keyboard-aware mobile sheet sizing ────────────────────────────────
  useEffect(() => {
    if (!open || typeof window === 'undefined') return;
    const vv = window.visualViewport;
    if (!vv) {
      // Older browsers without visualViewport — fall back to a fixed 80vh sheet
      setSheetTop(0);
      setSheetHeight(0);
      return;
    }
    const measure = () => {
      // Mobile only — desktop layout pegs the panel via static CSS classes.
      if (window.innerWidth >= 640) return;
      // visualViewport.offsetTop is the height of any top-side UI Safari hides
      // when scrolled (URL bar). visualViewport.height is the area available
      // to render content above the keyboard.
      setSheetTop(vv.offsetTop);
      setSheetHeight(vv.height);
    };
    measure();
    vv.addEventListener('resize', measure);
    vv.addEventListener('scroll', measure);
    window.addEventListener('orientationchange', measure);
    return () => {
      vv.removeEventListener('resize', measure);
      vv.removeEventListener('scroll', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, [open]);

  // ── Lock body scroll on mobile while open ──────────────────────────────
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!open) return;
    const isMobile = window.innerWidth < 640;
    if (!isMobile) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // iOS sometimes auto-scrolls the page when an input gets focus. Stomp on
    // that so the body stays at the top — the sheet itself handles scrolling.
    const stomp = () => { window.scrollTo(0, 0); };
    window.addEventListener('focusin', stomp);
    return () => {
      document.body.style.overflow = original;
      window.removeEventListener('focusin', stomp);
    };
  }, [open]);

  // Don't render on the dedicated /assistant page (would be a double-widget)
  if (pathname === '/assistant') return null;

  // The FAB serves as Open on every screen + Close on desktop. On mobile while
  // open the panel header has its own large close button, so the FAB hides
  // (otherwise it overlaps the textarea — looks broken).
  const showFab = !open || (typeof window !== 'undefined' && window.innerWidth >= 640);

  // Mobile sheet style — only used when we have a real visualViewport reading.
  const mobileSheetStyle =
    sheetHeight > 0
      ? { top: `${sheetTop}px`, height: `${sheetHeight}px` }
      : undefined;

  return (
    <>
      {/* ── "Ask me anything" hint bubble (desktop, collapsed) ────────── */}
      {!open && showHint && (
        <div
          className="fixed right-[5.25rem] z-50 hidden items-center sm:flex"
          style={{ bottom: 'calc(env(safe-area-inset-bottom) + 1.5rem)' }}
        >
          <div className="relative rounded-2xl bg-card px-3 py-2 text-xs font-medium text-foreground shadow-lg ring-1 ring-border/60 animate-hint-bob">
            Ask me anything ✨
            <span className="absolute -right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 rotate-45 bg-card ring-1 ring-border/60 [clip-path:polygon(100%_0,100%_100%,0_100%)]" />
            <button
              onClick={() => {
                localStorage.setItem(HINT_DISMISSED_KEY, '1');
                setShowHint(false);
              }}
              className="absolute -top-1.5 -left-1.5 grid h-4 w-4 place-items-center rounded-full bg-muted text-[10px] text-muted-foreground hover:bg-accent"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* ── Floating Action Button: animated robot mascot ────────────── */}
      {showFab && (
        <button
          onClick={() => setOpen(!open)}
          aria-label={open ? 'Close AI Assistant' : 'Open AI Assistant — ask me anything'}
          style={{ bottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}
          className={`fixed right-4 z-50 grid h-14 w-14 place-items-center rounded-full shadow-xl ring-1 ring-border/40 transition-all sm:right-6 ${
            open
              ? 'rotate-90 bg-card text-muted-foreground'
              : 'bg-gradient-to-br from-violet-500 via-primary to-fuchsia-500 text-white hover:scale-110 active:scale-95 animate-robot-bob'
          }`}
        >
          {open ? (
            <X className="h-6 w-6" />
          ) : (
            <>
              <RobotIcon />
              <span className="pointer-events-none absolute inset-0 -z-10 animate-ping-slow rounded-full bg-primary/40 blur-md" />
              {showHint && (
                <span className="absolute -top-1 -right-1 grid h-5 w-5 animate-pulse place-items-center rounded-full bg-rose-500 text-[10px] font-bold text-white shadow-md sm:hidden">
                  !
                </span>
              )}
            </>
          )}
        </button>
      )}

      {/* ── Chat panel ─────────────────────────────────────────────────── */}
      {open && (
        <>
          {/* Mobile backdrop — tap to close */}
          <div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm sm:hidden"
            onClick={() => setOpen(false)}
            aria-hidden
          />

          {/* Mobile sheet — positioned via visualViewport (top + height)        */}
          <div
            role="dialog"
            aria-modal="true"
            aria-label="AI Assistant"
            style={mobileSheetStyle}
            className={`fixed inset-x-0 z-50 flex flex-col overflow-hidden border bg-background shadow-2xl ring-1 ring-border/50 animate-in slide-in-from-bottom duration-200 sm:hidden ${
              mobileSheetStyle ? '' : 'bottom-0 h-[88dvh] rounded-t-2xl'
            }`}
          >
            {/* Prominent mobile header — drag handle + brand + BIG close X */}
            <div className="flex shrink-0 items-center justify-between border-b border-border/60 bg-gradient-to-r from-primary/10 via-fuchsia-500/5 to-transparent px-4 pt-2 pb-3 safe-top">
              <div className="flex items-center gap-2.5">
                <div className="relative grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-violet-500 via-primary to-fuchsia-500 text-white shadow-md">
                  <RobotIcon />
                </div>
                <div>
                  <div className="text-sm font-semibold leading-tight">AI Assistant</div>
                  <div className="text-[10px] text-muted-foreground leading-tight">Ask me anything</div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Link
                  href="/assistant"
                  onClick={() => setOpen(false)}
                  className="grid h-10 w-10 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
                  title="Open full assistant"
                  aria-label="Open full assistant"
                >
                  <Maximize2 className="h-4 w-4" />
                </Link>
                <button
                  onClick={() => setOpen(false)}
                  className="grid h-10 w-10 place-items-center rounded-full bg-muted text-foreground hover:bg-accent"
                  title="Close"
                  aria-label="Close assistant"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            {/* Chat takes remaining space and scrolls internally */}
            <div className="flex min-h-0 flex-1 flex-col">
              <AssistantChat
                variant="compact"
                persistKey="leadforge_assistant_chat"
                hideInternalHeader
              />
            </div>
          </div>

          {/* Desktop floating panel — unchanged static positioning */}
          <div
            role="dialog"
            aria-modal="true"
            aria-label="AI Assistant"
            className="fixed bottom-24 right-6 z-50 hidden h-[600px] max-h-[80vh] w-[420px] flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl ring-1 ring-border/50 sm:flex"
          >
            <AssistantChat
              variant="compact"
              persistKey="leadforge_assistant_chat"
              headerExtra={
                <>
                  <Link
                    href="/assistant"
                    onClick={() => setOpen(false)}
                    className="grid h-9 w-9 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                    title="Open full assistant"
                    aria-label="Open full assistant"
                  >
                    <Maximize2 className="h-4 w-4" />
                  </Link>
                  <button
                    onClick={() => setOpen(false)}
                    className="grid h-9 w-9 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                    title="Close"
                    aria-label="Close assistant"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </>
              }
            />
          </div>
        </>
      )}
    </>
  );
}

/**
 * Inline animated robot SVG. CSS keyframes drive antenna pulse, eye blink,
 * and idle bob. Rendered at 28px (h-7 w-7) for the FAB and at scale-[0.6]
 * inside the chat header.
 */
function RobotIcon() {
  return (
    <svg
      viewBox="0 0 28 28"
      className="h-7 w-7"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <line x1="14" y1="2" x2="14" y2="5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="14" cy="2" r="1.6" fill="currentColor" className="animate-antenna-bulb origin-center" />
      <rect x="4.5" y="5.5" width="19" height="15" rx="4" stroke="currentColor" strokeWidth="1.6" fill="rgba(255,255,255,0.08)" />
      <rect x="2.5" y="11" width="2" height="4" rx="1" fill="currentColor" opacity="0.7" />
      <rect x="23.5" y="11" width="2" height="4" rx="1" fill="currentColor" opacity="0.7" />
      <g className="origin-center animate-robot-blink">
        <circle cx="10" cy="12.5" r="1.5" fill="currentColor" />
        <circle cx="18" cy="12.5" r="1.5" fill="currentColor" />
      </g>
      <circle cx="7.5" cy="16" r="0.6" fill="#22d3ee" opacity="0.95" />
      <circle cx="20.5" cy="16" r="0.6" fill="#f472b6" opacity="0.95" />
      <path d="M 10.5 16.5 Q 14 18.5 17.5 16.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      <rect x="11.5" y="20.5" width="5" height="2.5" rx="0.8" fill="currentColor" opacity="0.55" />
      <rect x="9" y="23" width="10" height="3" rx="1.4" stroke="currentColor" strokeWidth="1.4" fill="none" />
    </svg>
  );
}
