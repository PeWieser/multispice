import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  // Wichtig: die API-Routen sind im statischen Modus nicht verfügbar.
  images: { unoptimized: true },
};

export default nextConfig;
