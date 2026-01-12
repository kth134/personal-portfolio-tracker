import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,

  async headers() {
    // Your real Supabase project domain (from env)
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
              "style-src 'self' 'unsafe-inline'",               // Tailwind + shadcn
              "img-src 'self' data: blob: https:",              // Images, CDNs
              "font-src 'self' data: https:",                   // Fonts
              // ── connect-src: exact domains your app uses ──
              `connect-src 'self` +
                ` ${supabaseDomain} ${supabaseWildcard} wss://${supabaseDomain} wss://${supabaseWildcard}` + // Supabase (auth, DB, realtime)
                ` https://api.coingecko.com https://*.coingecko.com` +           // CoinGecko prices
                ` https://api.polygon.io` +                                      // Polygon API
                ` https://finnhub.io` +                                          // Finnhub quotes
                ` https://api.x.ai` +                                            // Grok API
                ` https://google.serper.dev` +                                   // Serper search
                ` https://*.vercel-scripts.com https://vercel.live` +            // Vercel analytics/speed insights
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