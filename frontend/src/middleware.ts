import { clerkMiddleware } from '@clerk/nextjs/server';

// Protection moved to layout-level auth() checks because of a Clerk 7 + Next 16
// middleware session-cookie validation bug. clerkMiddleware() still runs so
// Clerk's dev-browser handshake works.
export default clerkMiddleware();

export const config = {
  matcher: [
    '/((?!.*\\..*|_next).*)',
    '/',
    '/(api|trpc)(.*)',
  ],
};
