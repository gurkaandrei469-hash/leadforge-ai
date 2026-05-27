'use client';
import { useEffect, useState, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { X, Maximize2 } from 'lucide-react';
import Link from 'next/link';
import { AssistantChat } from './chat-core';

const STORAGE_KEY = 'leadforge_assistant_widget_open';
const HINT_DISMISSED_KEY = 'leadforge_assistant_hint_dismissed';

/**
 * Floating AI assistant widget — robot mascot with a friendly "Ask me anything"
 * hint bubble that pulses periodically until the user has opened the chat at
 * least once. Once opened it morphs into a full-height mobile bottom sheet that
 * resizes when the on-screen keyboard appears (uses visualViewport API; falls
 * back to dvh units for older browsers).
 */
export function AssistantWidget() {
  const [open, setOpen] = useState(false);
  const [showHint, setShowHint] = useState(false);
  // Panel geometry — mobile sheet height + offset from layout-viewport bottom.
  // bottomOffset > 0 when an on-screen keyboard is pushing the panel up.
  const [panelHeight, setPanelHeight] = useState<string>('100dvh');
  const [bottomOffset, setBottomOffset] = useState<number>(0);
  const pathname = usePathname();
  const panelRef = useRef<HTMLDivElement | null>(null);

  // ── Persist open/close across navigations ──────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setOpen(sessionStorage.getItem(STORAGE_KEY) === '1');
    // Show the "Ask me anything" hint until the user has interacted with the
    // assistant once (per browser, not per session — so they get one helpful
    // nudge then we stop bothering them).
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

  // ── Keyboard-aware sizing via visualViewport ────────────────────────────
  // When the on-screen keyboard appears, visualViewport.height shrinks by the
  // keyboard height. We resize the bottom sheet so its input bar stays above
  // the keyboard. dvh is a backup — it works on Chrome/Edge/Safari 17.2+ but
  // visualViewport is more reliable across iOS Safari versions.
  useEffect(() => {
    if (!open || typeof window === 'undefined') return;
    const vv = window.visualViewport;
    if (!vv) return;

    const measure = () => {
      // On desktop the panel is a floating card so we cap it at 600px and
      // don't shift its bottom (no soft keyboard involved).
      const isDesktop = window.innerWidth >= 640; // sm breakpoint
      if (isDesktop) {
        setPanelHeight('min(600px, 80vh)');
        setBottomOffset(0);
        return;
      }
      // Mobile: the panel sits between the top of the visible area and the
      // top of the keyboard. We compute the keyboard height as the slice of
      // the layout viewport that the visual viewport doesn't cover at the bottom.
      const kbHeight = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setBottomOffset(kbHeight);
      // Subtract 8px so the rounded top isn't pixel-perfect against the system bar
      setPanelHeight(`${Math.max(360, vv.height - 8)}px`);
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

  // ── Lock body scroll while open on mobile (prevents background scroll
  //    when the user drags inside the chat) ──────────────────────────────
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const isMobile = window.innerWidth < 640;
    if (open && isMobile) {
      const original = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = original; };
    }
  }, [open]);

  // Don't render on the dedicated /assistant page (would be a double-widget)
  if (pathname === '/assistant') return null;

  return (
    <>
      {/* ── "Ask me anything" hint bubble (collapsed state only) ──────── */}
      {!open && showHint && (
        <div
          className="fixed right-[5.25rem] z-50 hidden items-center sm:flex"
          style={{ bottom: 'calc(env(safe-area-inset-bottom) + 1.5rem)' }}
        >
          <div className="relative rounded-2xl bg-card px-3 py-2 text-xs font-medium text-foreground shadow-lg ring-1 ring-border/60 animate-hint-bob">
            Ask me anything ✨
            {/* Bubble tail pointing at the robot */}
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
            {/* Pulsing aura behind robot to draw attention */}
            <span className="pointer-events-none absolute inset-0 -z-10 animate-ping-slow rounded-full bg-primary/40 blur-md" />
            {/* Mobile-only mini tooltip dot — hint bubble is sm:flex only */}
            {showHint && (
              <span className="absolute -top-1 -right-1 grid h-5 w-5 animate-pulse place-items-center rounded-full bg-rose-500 text-[10px] font-bold text-white shadow-md sm:hidden">
                !
              </span>
            )}
          </>
        )}
      </button>

      {/* ── Chat panel ─────────────────────────────────────────────────
          Mobile: full-width bottom sheet, keyboard-aware via visualViewport
          Desktop: floating 420x600 panel anchored bottom-right            */}
      {open && (
        <>
          {/* Mobile backdrop — taps to close */}
          <div
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm sm:hidden"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="AI Assistant"
            // Mobile: bottom = keyboard height so panel sits above the keyboard.
            // Desktop: bottom is fixed (24px from corner) via the sm: classes below.
            style={{ height: panelHeight, ...(bottomOffset ? { bottom: `${bottomOffset}px` } : {}) }}
            className="fixed inset-x-0 bottom-0 z-50 flex flex-col overflow-hidden rounded-t-2xl border border-b-0 bg-background shadow-2xl ring-1 ring-border/50 safe-bottom transition-[bottom] duration-200 animate-in slide-in-from-bottom sm:inset-x-auto sm:bottom-24 sm:right-6 sm:w-[420px] sm:max-h-[80vh] sm:rounded-2xl sm:border-b"
          >
            {/* Drag-handle indicator on mobile (purely visual, helps users
                understand this is a dismissible sheet) */}
            <div className="grid place-items-center pt-2 sm:hidden">
              <div className="h-1.5 w-10 rounded-full bg-muted-foreground/25" />
            </div>

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
 * Inline animated robot SVG. CSS keyframes (defined in globals.css) drive:
 *   - antenna `bob` animation (gentle bounce of the bulb)
 *   - eye `blink` every ~4s
 *   - mouth subtle sway suggesting the bot is "talking" idly
 *
 * Rendered at 28px (h-7 w-7) — fits the 56px FAB with comfortable margin.
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
      {/* Antenna line */}
      <line x1="14" y1="2" x2="14" y2="5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      {/* Antenna bulb — pulsing */}
      <circle cx="14" cy="2" r="1.6" fill="currentColor" className="animate-antenna-bulb origin-center" />
      {/* Head */}
      <rect x="4.5" y="5.5" width="19" height="15" rx="4" stroke="currentColor" strokeWidth="1.6" fill="rgba(255,255,255,0.08)" />
      {/* Side ears */}
      <rect x="2.5" y="11" width="2" height="4" rx="1" fill="currentColor" opacity="0.7" />
      <rect x="23.5" y="11" width="2" height="4" rx="1" fill="currentColor" opacity="0.7" />
      {/* Eyes — blinking via CSS scaleY */}
      <g className="origin-center animate-robot-blink">
        <circle cx="10" cy="12.5" r="1.5" fill="currentColor" />
        <circle cx="18" cy="12.5" r="1.5" fill="currentColor" />
      </g>
      {/* Cheek lights */}
      <circle cx="7.5" cy="16" r="0.6" fill="#22d3ee" opacity="0.95" />
      <circle cx="20.5" cy="16" r="0.6" fill="#f472b6" opacity="0.95" />
      {/* Smile mouth */}
      <path d="M 10.5 16.5 Q 14 18.5 17.5 16.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      {/* Neck / body hint */}
      <rect x="11.5" y="20.5" width="5" height="2.5" rx="0.8" fill="currentColor" opacity="0.55" />
      <rect x="9" y="23" width="10" height="3" rx="1.4" stroke="currentColor" strokeWidth="1.4" fill="none" />
    </svg>
  );
}
