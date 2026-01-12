import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,

  async headers() {
    // Use env var for safety (fallback to a placeholder if missing)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://nhiqvvrfdhgngwkjntix.supabase.co';
    const supabaseDomain = supabaseUrl.replace(/^https?:\/\//, ''); // e.g. ea4f064edec7327ji.supabase.co
    const supabaseWildcard = `*.${supabaseDomain.split('.').slice(-2).join('.')}`; // *.supabase.co

    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // required for Next.js, React, shadcn/ui
              "style-src 'self' 'unsafe-inline'",                // Tailwind, shadcn
              "img-src 'self' data: blob: https:",               // images from CDNs, user uploads, etc.
              "font-src 'self' data: https:",                    // fonts
              // ── Critical: Allow Supabase auth & realtime ──
              `connect-src 'self` +
                ` ${supabaseDomain} ${supabaseWildcard} wss://${supabaseDomain} wss://${supabaseWildcard}` +
                ` https://api.coingecko.com https://*.coingecko.com` +      // price fetches
                ` https://api.polygon.io https://finnhub.io` +              // if still using
                ` https://api.x.ai https://google.serper.dev` +             // your existing ones
                ` https://*.vercel-scripts.com https://vercel.live` +       // Vercel analytics/speed insights
                ` https://*.googleapis.com https://*.google.com` +          // if using Google auth/maps later
                "';",
              "frame-src 'self'",
              "frame-ancestors 'none'",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
        ],
      },
    ];
  },
};

export default nextConfig;