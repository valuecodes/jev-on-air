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
| typescript  | `@repo/typescript`  | Shared tsconfig presets (`base.json`, `node.json`, `react.json`)                         |

CI helpers are not workspaces: the composite setup action lives in
`.github/actions/setup/` and the gitleaks script in `.github/scripts/`.

Apps may import packages; packages must never import apps. oxlint bans `../`
imports and deep `@repo/*/src` imports: import other workspaces by package name,
and inside an app use the `~/` alias (`src/*`) to go up the tree.

---

## Commands

**Prerequisites:** Node.js 24 (exact version in `.nvmrc`), pnpm 12.11.2 (`packageManager` in root `package.json`).
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
pnpm knip                        # unused files, exports and dependencies
pnpm typecheck                   # turbo run typecheck
pnpm test                        # turbo run test
pnpm build                       # turbo run build
pnpm format                      # oxfmt, writes in place
pnpm format:check                # oxfmt --check (no writes)
pnpm secrets:scan                # gitleaks over the full git history
pnpm clean                       # turbo run clean
```

`lint` and `knip` do not go through Turbo — each is a single process over the whole
repo. oxlint is configured by the root `.oxlintrc.json` (including `import/no-cycle`)
and prints nothing when there are no findings, so silent output means clean. Knip is
configured by the root `knip.jsonc` and exits 0 when clean. Formatting is oxfmt
(Prettier-compatible), configured by the root `.oxfmtrc.jsonc`, which also sorts
imports and Tailwind classes.

There is no post-edit formatting hook: run `pnpm format` yourself before committing.

`secrets:scan` runs gitleaks (`.github/scripts/secrets-scan.sh`, version pinned
there) using a local `gitleaks` v8.19+ if one is on PATH, otherwise the pinned Docker image.
It exits 0 when clean and 1 when it finds a leak.

CI checks are defined once in the reusable `.github/workflows/checks.yml`: typecheck,
lint, knip, format:check, test, build, secrets-scan, CodeQL code scanning
(`javascript-typescript` and `python`) and workflow-lint. `feature.yml` calls it on PRs and
`main.yml` on push to `main` (deploy jobs go there). workflow-lint calls the reusable
workflow from `valuecodes/automation`: actionlint (with shellcheck) and zizmor over the
workflow and action files. Each tool reads `.github/actionlint.yaml` / `zizmor.yml` if
added. `all-passed` in `feature.yml` fans the checks in and is the one check to require
in branch protection. The typecheck, test and build jobs restore Turbo's `.turbo` cache
from the previous run of the same task, so unchanged packages replay instead of rerunning.

Dependabot (`.github/dependabot.yml`) bumps the SHA-pinned actions and reusable workflows
monthly in one grouped PR; npm dependencies are updated by hand.

`maintenance-dashboard.yml` calls the maintenance dashboard workflow from
`valuecodes/automation` daily.
It keeps one issue, **Maintenance dashboard** (label `maintenance-dashboard`), listing
what is due: `catalog:` updates, pnpm (`packageManager`), gitleaks (`GITLEAKS_VERSION`
in the secrets-scan script), Node.js (`.nvmrc`) and `pnpm audit` findings. Like
`minimumReleaseAge`, a release shows up only once it is 14 days old; a Node.js security
release shows up right away and is flagged. It never opens PRs or commits; doing the
updates stays manual. For a Node.js bump, change only `.nvmrc` (the one place that
holds the exact version). If `GITLEAKS_VERSION` moves out of
`.github/scripts/secrets-scan.sh`, pass the new path as the `gitleaks-script` input. The
dashboard and workflow-lint callers pin the same `valuecodes/automation` commit, so bump
them together.

---

## Rules

- Keep diffs tight and focused; no drive-by refactors or new tooling without discussion.
- Never commit secrets, credentials, or `.env` files. All code must be public-safe.
- Add dependencies to the correct workspace with `pnpm --filter <package> add <dep>`.
  Every external version lives in the `catalog:` block of `pnpm-workspace.yaml`
  and manifests reference it as `catalog:`; `@repo/*` deps stay `workspace:*`.
  Update with `pnpm up --latest -r`; `updateConfig.ignoreDependencies` holds
  `@types/node` to the `.nvmrc` major, so bump it by hand.
- Every install enforces the supply-chain settings in `pnpm-workspace.yaml`
  (`minimumReleaseAge`, `trustPolicy: no-downgrade`) plus pnpm 12's default
  `blockExoticSubdeps`. When one fails, investigate: never disable it, and never
  exclude a whole package to get past it.
