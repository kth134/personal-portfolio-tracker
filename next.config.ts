import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,

  async headers() {
    // Supabase domains from your env
    const supabaseDomain = "nhiqvvrfdhgngwkjntix.supabase.co";
    const supabaseWildcard = "*.supabase.co";

    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Next.js, React, shadcn/ui
              "style-src 'self' 'unsafe-inline'",               // Tailwind, shadcn
              "img-src 'self' data: blob: https:",              // Images/CDNs
              "font-src 'self' data: https:",
              // ── connect-src: only what your app actually calls ──
              `connect-src 'self` +
                ` ${supabaseDomain} ${supabaseWildcard} wss://${supabaseDomain} wss://${supabaseWildcard}` + // Supabase auth + realtime (future-proof)
                ` https://api.coingecko.com https://*.coingecko.com` +           // CoinGecko prices
                ` https://api.polygon.io` +                                      // Polygon API
                ` https://finnhub.io` +                                          // Finnhub quotes
                ` https://api.x.ai` +                                            // Grok chat integration
                ` https://google.serper.dev` +                                   // Serper search
                ` https://*.vercel-scripts.com https://vercel.live` +            // Vercel analytics/speed
                "';",
              "frame-src 'self'",
              "frame-ancestors 'none'",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
        ],
      },
    ];
  },
};

export default nextConfig;