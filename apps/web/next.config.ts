import path from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const here = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  /*
   * A server rather than a static export: `app/api/*` proxies sign-in and sync
   * to the Lift API from the server side, so the session token lives in an
   * httpOnly cookie on this origin and the API never has to list this origin in
   * `TRUSTED_ORIGINS`.
   */
  output: "standalone",
  outputFileTracingRoot: path.join(here, "../.."),
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
};

export default nextConfig;
