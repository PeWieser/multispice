import type { NextConfig } from "next";

/**
 * Two build targets from one codebase:
 *
 * - static (default)  → `out/` for Cloudflare Pages. No server, no database.
 *                       Projects are stored in the browser (localStorage) and
 *                       can be exported as .ms / SPICE / SVG / CSV.
 * - server            → enabled automatically when DATABASE_URL is set, or
 *                       explicitly with NEXT_OUTPUT=server. Activates the API
 *                       routes in `src/app/api/**\/route.server.ts`
 *                       (projects, simulate, health).
 */
const serverMode = process.env.NEXT_OUTPUT === "server" || Boolean(process.env.DATABASE_URL);

const nextConfig: NextConfig = {
  ...(serverMode ? {} : { output: "export" as const, trailingSlash: true }),
  images: { unoptimized: true },
  // `route.server.ts` files are only routes in server mode.
  pageExtensions: serverMode ? ["server.ts", "tsx", "ts"] : ["tsx", "ts"],
  env: {
    NEXT_PUBLIC_PERSISTENCE: serverMode ? "server" : "local",
  },
};

export default nextConfig;
