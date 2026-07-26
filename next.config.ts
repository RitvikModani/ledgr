import type { NextConfig } from "next";

/**
 * Ledgr targets two shapes of host, and they need different builds.
 *
 *   Static  (GitHub Pages, S3, any file server) — `STATIC_EXPORT=1 npm run build`.
 *           Every page works, because the whole app is client-side. The one
 *           casualty is `app/api/digest`, which needs a server; email digests
 *           are unavailable and Settings says so rather than failing silently.
 *
 *   Server  (Vercel, Netlify, a Node box) — plain `npm run build`. Everything
 *           works, including digests and the security headers below.
 *
 * `NEXT_PUBLIC_BASE_PATH` exists because project Pages serve from a subpath
 * (`/ledgr`), and without it every asset and internal link resolves against the
 * domain root and 404s.
 */
const isStaticExport = process.env.STATIC_EXPORT === "1";
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  ...(isStaticExport ? { output: "export" as const } : {}),
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),

  // Static hosts serve files, not responses, so a static export cannot set
  // these — Next drops them with a warning. They are only declared for the
  // server build, where they actually take effect.
  ...(isStaticExport
    ? {}
    : {
        async headers() {
          return [
            {
              source: "/:path*",
              headers: [
                { key: "X-Frame-Options", value: "DENY" },
                { key: "X-Content-Type-Options", value: "nosniff" },
                { key: "Referrer-Policy", value: "no-referrer" },
                {
                  key: "Permissions-Policy",
                  value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
                },
              ],
            },
          ];
        },
      }),
};

export default nextConfig;
