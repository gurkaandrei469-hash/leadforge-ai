import type { Metadata, Viewport } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import { ThemeProvider } from 'next-themes';
import { Toaster } from 'sonner';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: 'LeadForge AI — Intelligent B2B Lead Discovery',
  description: 'Extract, verify, and classify high-quality B2B leads at scale.',
  // iOS Safari home-screen install support — looks like a native app when installed
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'LeadForge',
  },
  formatDetection: {
    // Stop iOS from auto-linking phone numbers / emails which messes up table cells
    telephone: false,
    email: false,
    address: false,
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  // Critical for iOS — sizes the layout to the visual viewport, not the bigger initial one
  viewportFit: 'cover',
  // Tell Chrome/Edge/modern Safari to resize layout when the on-screen keyboard appears,
  // instead of overlaying it. This makes 100dvh actually shrink when keyboard opens, so
  // the assistant chat input stays above the keyboard automatically.
  interactiveWidget: 'resizes-content',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0a' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en" suppressHydrationWarning>
        <body className="min-h-screen antialiased [-webkit-tap-highlight-color:transparent]">
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
            {children}
            <Toaster richColors position="top-right" closeButton />
          </ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
