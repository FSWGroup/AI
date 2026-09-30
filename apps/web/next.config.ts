import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // @wpi/core is TypeScript source using `.ts` import specifiers; Next/SWC transpiles it.
  transpilePackages: ["@wpi/core"],
  // Native/Node-only packages stay external to the server bundle.
  serverExternalPackages: ["postgres", "@anthropic-ai/sdk"],
  outputFileTracingRoot: path.join(here, "../../"),
  typescript: { ignoreBuildErrors: false },
  webpack: (config) => {
    // Allow `.ts` specifiers to resolve to `.ts`/`.tsx` files (and `.js` to `.ts`) inside the transpiled core package.
    config.resolve.extensionAlias = { ...(config.resolve.extensionAlias ?? {}), ".js": [".ts", ".tsx", ".js"], ".ts": [".ts", ".tsx"] };
    return config;
  },
};

export default nextConfig;
