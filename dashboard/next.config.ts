import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  // dashboard/ is its own package; without this, Next takes the twin's lockfile one folder up for the workspace root.
  turbopack: { root: import.meta.dirname },
};

export default config;
