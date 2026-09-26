# Agentic Monorepo Starter

A Turborepo template for agentic development: strict repo guardrails, consistent tooling,
and clear package boundaries — so agents move fast without turning the codebase into spaghetti.

## What's inside

- Vite playground in `apps/playground` (Vite 8, React 19, Tailwind CSS 4)
- Shared tooling: oxlint, Prettier, TypeScript 7, Turbo
- `@repo/logger` — structured JSON logging for Cloud Run / Cloud Logging
- pnpm catalog for versions, with a 14-day release-age guard on new releases
- Agent settings in `.claude/`, `.codex/`, and `.github/`

```text
apps/playground        Vite 8 + React 19 sandbox
packages/logger        pino logger, Cloud Logging shaped JSON
tooling/prettier       shared Prettier config
tooling/typescript     shared tsconfig presets (base, node, react)
tooling/github         composite action: pnpm + Node + install; secrets-scan script
.oxlintrc.json         single root lint config for the whole repo
```

## Getting started

Requires Node.js 24.12.0 (`.nvmrc`) and pnpm 11.24.0 (`packageManager` in `package.json`).

```bash
pnpm install
pnpm dev          # playground at http://localhost:3001
```

## Commands

```bash
pnpm lint           # type-aware linting, whole repo in one oxlint process
pnpm typecheck      # TypeScript 7 (tsc) across the repo
pnpm test           # test suite
pnpm build          # production builds
pnpm format         # Prettier write
pnpm format:check   # Prettier check (CI gate)
pnpm secrets:scan   # gitleaks secret scan over git history
```

oxlint prints nothing when there are no findings, so silent output means clean.

CI runs typecheck, lint, format-check, test, build and a gitleaks secret scan on push to
`main` and on PRs. `secrets:scan` needs either `gitleaks` v8.19+ on PATH or a running
Docker daemon.

## Use this template

Use GitHub's **Use this template** button, then:

- Optionally rename the `@repo/*` scope to your own (e.g. `@acme/*`)
- Update `name` and `description` in `package.json`
- Verify everything is green: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`

## Working with AI agents

`AGENTS.md` is the contract — repo structure, commands, and rules. `CLAUDE.md` is a
symlink to it, so edit `AGENTS.md` and never `CLAUDE.md`.

- Claude Code: permissions in `.claude/settings.json`. No post-edit format hook — run
  `pnpm format` before committing.
- Codex: config in `.codex/config.toml`.

Recommended editor extensions are listed in `.vscode/extensions.json`.
