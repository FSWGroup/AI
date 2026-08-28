import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  eslint: {
    // Lint runs as a dedicated CI step (`npm run lint`); avoid duplicating it in the build.
    ignoreDuringBuilds: true,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "geolocation=(), payment=(), usb=()",
          },
        ],
      },
      {
        // Uploaded/untrusted content is served sandboxed under /api/media.
        source: "/api/media/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "sandbox; default-src 'none'; media-src 'self'; img-src 'self'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};

export default nextConfig;
