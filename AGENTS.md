# AGENTS.md

Guidelines for AI agents and contributors working in this Turborepo monorepo.

`CLAUDE.md` is a symlink to this file. Never edit `CLAUDE.md` directly.

---

## Structure

### Apps (`apps/`)

| Name       | Filter       | Description                           |
| ---------- | ------------ | ------------------------------------- |
| playground | `playground` | Vite 8 + React 19 app for experiments |

### Packages (`packages/`)

| Name   | Filter         | Description                                    |
| ------ | -------------- | ---------------------------------------------- |
| logger | `@repo/logger` | pino logger emitting Cloud Logging shaped JSON |

### Tooling (`tooling/`)

| Name       | Filter             | Description                                                      |
| ---------- | ------------------ | ---------------------------------------------------------------- |
| prettier   | `@repo/prettier`   | Shared Prettier config                                           |
| typescript | `@repo/typescript` | Shared tsconfig presets (`base.json`, `node.json`, `react.json`) |
| github     | `@repo/github`     | GitHub Actions composite setup action, gitleaks `secrets-scan`   |

Apps may import packages; packages must never import apps.

---

## Commands

**Prerequisites:** Node.js 24.12.0 (`.nvmrc`), pnpm 11.24.0 (`packageManager` in root `package.json`).

```bash
pnpm install                     # Install all dependencies
pnpm --filter playground dev     # Vite dev server (port 3001)

pnpm lint                        # oxlint, one process over the whole repo
pnpm typecheck                   # turbo run typecheck
pnpm test                        # turbo run test
pnpm build                       # turbo run build
pnpm format                      # prettier --write .
pnpm format:check                # prettier --check . (no writes)
pnpm secrets:scan                # gitleaks over the full git history
pnpm clean                       # turbo run clean
```

`lint` is the one task that does not go through Turbo — oxlint is a single fast process
over the whole repo, configured by the root `.oxlintrc.json`. It prints nothing when
there are no findings, so silent output means clean.

There is no post-edit formatting hook: run `pnpm format` yourself before committing.

`secrets:scan` runs gitleaks (`tooling/github/scripts/secrets-scan.sh`, version pinned
there) using a local `gitleaks` v8.19+ if one is on PATH, otherwise the pinned Docker image.
It exits 0 when clean and 1 when it finds a leak.

CI (`.github/workflows/`) runs typecheck, lint, format-check, test, build and
secrets-scan on push to `main` and on PRs.

---

## Rules

- Keep diffs tight and focused; no drive-by refactors or new tooling without discussion.
- Never commit secrets, credentials, or `.env` files. All code must be public-safe.
- Add dependencies to the correct workspace with `pnpm --filter <package> add <dep>`.
  Versions shared by more than one package go in the `catalog:` block of
  `pnpm-workspace.yaml`; single-consumer deps are pinned inline.
