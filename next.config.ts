import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
   * Standalone output bundles a self-contained server for container images, but
   * it is incompatible with `next start` — which is what `npm run start` and the
   * end-to-end harness use to serve a production build locally. Gate it on the
   * build target so both paths work: set BUILD_STANDALONE=true in the Docker
   * build (see DEPLOYMENT.md) and leave it unset everywhere else.
   */
  ...(process.env.BUILD_STANDALONE === "true" ? { output: "standalone" as const } : {}),
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
        /*
         * Uploaded media is untrusted content, so it is served with a bare
         * `sandbox` — no script execution at all. The negative lookahead
         * excludes the SCORM subtree, which needs the different policy below;
         * without it, both rules would match and emit conflicting headers.
         */
        source: "/api/media/:path((?!scorm/).*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "sandbox; default-src 'none'; media-src 'self'; img-src 'self'",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      {
        /*
         * SCORM packages are third-party code that must run its own JavaScript
         * to work at all, so a bare `sandbox` would break every package.
         *
         * `allow-scripts` without `allow-same-origin` is the right trade: the
         * package executes in a unique opaque origin, so it can run its own
         * code but cannot read this application's cookies, localStorage, or
         * DOM. Progress reaches the platform only through postMessage, which
         * the player validates. Granting both allow-scripts and
         * allow-same-origin together would let a package escape the sandbox
         * entirely — that combination must never appear here.
         */
        source: "/api/media/scorm/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "sandbox allow-scripts allow-forms allow-popups allow-downloads",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};

export default nextConfig;
