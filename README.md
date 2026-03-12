# lancedb-claw

This repository contains the `lancedb-claw` OpenClaw context-engine plugin package.

The project is currently experimental and still being iterated on. Expect multiple refactors before the package reaches a stable shape.

The plugin package root is `context/`. See `context/README.md` for package-specific documentation, including:

- how to install dependencies under `context/node_modules/`
- how to build and validate the package with `pnpm build`, `pnpm typecheck`, and `pnpm test`
- how to install the plugin into OpenClaw with `openclaw plugins install --link ./context`
- how to configure `plugins.slots.contextEngine = "lancedb-claw"`
