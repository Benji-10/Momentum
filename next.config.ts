import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // "standalone" output is used by this sandbox's own production start.
  // On Netlify the build is handled by @netlify/plugin-nextjs, which wants
  // the regular build output instead.
  ...(process.env.NETLIFY === "true" ? {} : { output: "standalone" as const }),
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  devIndicators: false,
  async headers() {
    return [
      {
        // the service worker must always be revalidated (a stale SW pins a
        // stale shell), and the manifest needs its JSON content type
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [
          { key: "Cache-Control", value: "public, max-age=3600" },
          { key: "Content-Type", value: "application/manifest+json" },
        ],
      },
    ];
  },
};

export default nextConfig;
