/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Allow the dev server to serve assets to remote browsers via tunnels.
  // Without this, Next 15 blocks _next/* requests from non-localhost origins.
  allowedDevOrigins: [
    'localhost',
    '127.0.0.1',
    '*.trycloudflare.com',
    '*.ngrok-free.app',
    '*.ngrok.io',
  ],
  async rewrites() {
    return [
      {
        source: '/api/backend/:path*',
        destination: `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/api/v1/:path*`,
      },
    ];
  },
};
export default nextConfig;
