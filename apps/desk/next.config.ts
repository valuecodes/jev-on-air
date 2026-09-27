import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source; the stream route imports
  // `@repo/jev/replay` at runtime.
  transpilePackages: ["@repo/jev"],
  // Next 16 otherwise writes its own AGENTS.md/CLAUDE.md here on `next dev`;
  // the repo's AGENTS.md at the root covers this app.
  agentRules: false,
};

export default config;
