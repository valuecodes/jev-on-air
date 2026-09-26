import type { Config } from "prettier";

const config: Config = {
  trailingComma: "es5",
  plugins: [
    "@ianvs/prettier-plugin-sort-imports",
    "prettier-plugin-tailwindcss",
  ],
  // Third-party imports, a blank line, then relative imports. No workspace
  // defines a path alias right now; add a group here (e.g. `^~/(.*)$`)
  // alongside the alias if one is introduced.
  importOrder: ["<THIRD_PARTY_MODULES>", "", "^[./]"],
};

export default config;
