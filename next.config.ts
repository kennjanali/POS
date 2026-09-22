import type { NextConfig } from 'next';

/**
 * Static export. No server functions, no serverless invocations.
 * Deploy target is Cloudflare Pages: static asset requests are free and
 * unlimited, and there is no non-commercial restriction (unlike Vercel Hobby).
 *
 * All data access goes browser -> Supabase PostgREST, guarded by RLS.
 */
const nextConfig: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: true,
  reactStrictMode: true,
};

export default nextConfig;
