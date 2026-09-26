# AGENTS.md - apps/playground

This directory inherits `/AGENTS.md`. This file lists only additions and overrides specific to the playground app.

---

## What This Workspace Is

- Vite 8 + React 19 app for fast experiments.
- Tailwind CSS 4.
- Single-page app rendered from `src/home.tsx`.

---

## Workspace Commands

| Task      | Command                              |
| --------- | ------------------------------------ |
| Dev       | `pnpm --filter playground dev`       |
| Build     | `pnpm --filter playground build`     |
| Preview   | `pnpm --filter playground preview`   |
| Typecheck | `pnpm --filter playground typecheck` |
| Test      | `pnpm --filter playground test`      |
| Format    | `pnpm --filter playground format`    |
| Clean     | `pnpm --filter playground clean`     |

Or run repo-wide via root `pnpm typecheck` / `pnpm test` / `pnpm build`.

There is no per-workspace `lint` script: linting is a single root `pnpm lint`
(oxlint) covering the whole repo.

---

## Local Conventions (Deltas from Root)

### Entry Point

- `src/main.tsx` mounts the app and renders `Home` from `src/home.tsx`.

### Styling

- `src/globals.css` imports Tailwind and declares its `@source` scanning.
- Plain Tailwind utilities — there is no shared theme package, so semantic
  tokens like `text-muted-foreground` are not available.

### TypeScript

- `tsconfig.json` sets `"types": ["vite/client"]`. This is load-bearing:
  without it, TypeScript 7 rejects `import "./globals.css"` with TS2882.

### Vite Notes

- No path alias; use relative imports.

---

## Footguns / Gotchas

1. **Clean uses `rm -rf`** - Unix command. On Windows, run via pnpm for cross-platform handling.
2. **Tests run once** - `pnpm --filter playground test` uses `vitest run` (no watch mode).
3. **Typecheck is separate** - run `pnpm --filter playground typecheck` to catch TS errors early.
4. **Tailwind scanning** - if you add new directories, update `@source` entries in `src/globals.css`.
5. **`build` runs `tsc && vite build`** - a type error fails the build even though Vite itself would not catch it.
