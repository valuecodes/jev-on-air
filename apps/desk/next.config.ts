import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Next 16 otherwise writes its own AGENTS.md/CLAUDE.md here on `next dev`;
  // the repo's AGENTS.md at the root covers this app.
  agentRules: false,
};

export default config;
