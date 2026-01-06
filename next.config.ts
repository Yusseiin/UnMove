import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "artworks.thetvdb.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "thetvdb.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "image.tmdb.org",
        pathname: "/**",
      },
    ],
  },
  output: "standalone",
};

export default nextConfig;
