# Playground

Vite + React playground for experimenting with UI and agent workflows in this monorepo.

## Stack

- Vite 8 + React 19
- Tailwind CSS 4
- Vitest for unit tests

## Getting started

From the repo root:

```bash
pnpm install
pnpm --filter playground dev
```

Open http://localhost:3001 to view the app.

## Common commands

| Task      | Command                              |
| --------- | ------------------------------------ |
| Dev       | `pnpm --filter playground dev`       |
| Build     | `pnpm --filter playground build`     |
| Preview   | `pnpm --filter playground preview`   |
| Typecheck | `pnpm --filter playground typecheck` |
| Test      | `pnpm --filter playground test`      |
| Format    | `pnpm --filter playground format`    |
| Clean     | `pnpm --filter playground clean`     |

Linting is repo-wide: run `pnpm lint` from the root.

## Styling

`src/globals.css` imports Tailwind and sets `@source` scanning. There is no shared
theme package, so use plain Tailwind utilities.
