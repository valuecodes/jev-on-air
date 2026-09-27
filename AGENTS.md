# AGENTS.md

Guidelines for AI agents and contributors working in JevOnAir, a Turborepo monorepo that
monitors livestreams, transcribes speech, and turns market-moving statements detected by Jev
into simulated trade signals.

`CLAUDE.md` is a symlink to this file. Never edit `CLAUDE.md` directly.

---

## Structure

### Apps (`apps/`)

| Name | Filter | Description                                                            |
| ---- | ------ | ---------------------------------------------------------------------- |
| cli  | `cli`  | Node.js 24 command-line app, runs TypeScript via tsx                   |
| desk | `desk` | Local-only Next.js dashboard: start/stop `jev` runs, watch them stream |

### Packages (`packages/`)

| Name        | Filter              | Description                                                                              |
| ----------- | ------------------- | ---------------------------------------------------------------------------------------- |
| alpaca      | `@repo/alpaca`      | Alpaca live prices: Gold, Bitcoin, S&P 500, Oil                                          |
| jev         | `@repo/jev`         | Paper-trading decision engine: transcript + prices → Jev (TypeSafe AI) → simulated fills |
| logger      | `@repo/logger`      | pino logger emitting Cloud Logging shaped JSON                                           |
| transcriber | `@repo/transcriber` | YouTube → faster-whisper transcript stream (Python + uv)                                 |

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
`pnpm cli transcribe` also needs [uv](https://docs.astral.sh/uv/) and `ffmpeg` on `PATH`.
`pnpm cli prices` needs `ALPACA_API_KEY_ID` and `ALPACA_API_SECRET_KEY`, in the environment
or in a root `.env` (see `.env.example`). `pnpm cli jev` needs those plus `TYPESAFE_API_KEY`.

```bash
pnpm install                     # Install all dependencies
pnpm cli --hello-world           # Run the CLI (args go to apps/cli)
pnpm cli transcribe <youtube-url> # Stream a live/video transcript
pnpm cli prices                  # Stream live prices from Alpaca
pnpm cli prices --from=<iso> --to=<iso> --json  # Past prices for a window
pnpm cli jev <youtube-url>       # Paper-trade a stream with Jev (see apps/cli/README.md)
pnpm desk                        # Dashboard at http://127.0.0.1:3000 (see apps/desk/README.md)

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
