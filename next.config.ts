import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        hostname: "covers.openlibrary.org",
      },
      {
        hostname: "*.archive.org",
      },
      {
        hostname: "books.google.com",
      },
    ],
  },
};

export default nextConfig;
