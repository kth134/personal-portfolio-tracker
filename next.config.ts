import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  reactCompiler: true,
  async headers() {
    // Supabase from your env.local
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
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Next.js hydration, shadcn/ui
              "style-src 'self' 'unsafe-inline'",               // Tailwind/shadcn
              "img-src 'self' data: blob: https:",              // images
              "font-src 'self' data: https:",                   // fonts
              // connect-src — exact, space-separated, no invalid sources
              `connect-src 'self' ${supabaseDomain} ${supabaseWildcard} wss://${supabaseDomain} wss://${supabaseWildcard} https://api.coingecko.com https://*.coingecko.com https://api.polygon.io https://finnhub.io https://api.x.ai https://google.serper.dev https://*.vercel-scripts.com https://vercel.live;`,
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