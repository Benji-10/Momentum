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
};

export default nextConfig;
