import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["impit"],
  distDir: process.env.POINTSNAP_NEXT_DIST_DIR || ".next",
};

export default nextConfig;
