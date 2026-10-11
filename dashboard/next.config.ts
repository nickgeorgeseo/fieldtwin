import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  // `next dev` would otherwise write AGENTS.md and CLAUDE.md here; the project keeps its guidance in CONTRIBUTING.md.
  agentRules: false,
  // dashboard/ is its own package; without this, Next takes the twin's lockfile one folder up for the workspace root.
  turbopack: { root: import.meta.dirname },
};

export default config;
