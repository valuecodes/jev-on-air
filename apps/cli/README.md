# CLI

Command-line entry point for JevOnAir. For now it only prints a greeting.
Arguments are parsed with Node's built-in `node:util` `parseArgs`.

## Stack

- Node.js 24 running TypeScript directly (type stripping, no build step)
- Vitest for unit tests

## Getting started

From the repo root:

```bash
pnpm install
pnpm cli --hello-world   # Hello, world!
pnpm cli                 # usage
```

The root `cli` script runs `pnpm --silent --filter cli start`, so any arguments after
`pnpm cli` are passed straight to `src/main.ts`.

## Common commands

| Task      | Command                       |
| --------- | ----------------------------- |
| Start     | `pnpm --filter cli start`     |
| Typecheck | `pnpm --filter cli typecheck` |
| Test      | `pnpm --filter cli test`      |
| Format    | `pnpm --filter cli format`    |
| Clean     | `pnpm --filter cli clean`     |

Linting is repo-wide: run `pnpm lint` from the root.
