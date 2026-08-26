/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['yahoo-finance2', '@prisma/client', 'googleapis'],
  // Phase 5: brief + overview merged into the unified Conviction Desk.
  // Keep deep links working for anyone with a stale bookmark.
  async redirects() {
    return [
      { source: '/dashboard/brief',    destination: '/dashboard', permanent: true },
      { source: '/dashboard/overview', destination: '/dashboard', permanent: true },
    ];
  },
}

module.exports = nextConfig
