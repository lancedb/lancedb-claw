<!-- SPDX-License-Identifier: Apache-2.0 -->

# LanceDB Context Engine

`lancedb-claw` is an OpenClaw context-engine plugin package that persists session context in LanceDB and rebuilds prompt state through digests, hybrid recall, and incremental index maintenance.

## Project Status

This project is currently experimental.

The package is still under active iteration, and the implementation should be treated as an evolving prototype rather than a stable integration target.

Expect several rounds of refactoring as the storage model, lifecycle behavior, package boundaries, and OpenClaw integration details continue to be refined.

Until the project reaches a stable milestone, breaking changes to code structure, configuration, internal APIs, and install flow may happen between revisions.

## Scope

- Store raw `turn` records and summarized `digest` records in LanceDB
- Rebuild a session baseline during `bootstrap`
- Assemble prompt context with temporary digest recall during `assemble`
- Append new turns and synchronize indexes during `afterTurn`
- Compact older context into digests during `compact`

## Package Layout

- `src/engine/`: ContextEngine facade
- `src/lifecycle/`: Lifecycle orchestration
- `src/db/`: LanceDB connection and schema setup
- `src/codec/`: Message normalization, query extraction, and rendering
- `src/reader/`: Read-only storage access
- `src/writer/`: Write-only storage access
- `src/indexing/`: Dirty-state handling and index synchronization
- `src/search/`: Text, vector, and hybrid recall
- `src/summary/`: Digest generation
- `src/embedding/`: OpenAI-compatible embeddings client
- `src/runtime-bridge/`: OpenClaw runtime adaptation
- `src/types/`: Public and internal package types
- `test/`: Unit and integration coverage

## Build the Package

The package root is `context/`. Run all package commands from this directory.

### Prerequisites

- Node.js 22+
- `pnpm`
- A local OpenClaw checkout if you want to link the plugin into a development gateway

### Install dependencies

```bash
cd context
pnpm install
```

This creates `context/node_modules/` and installs the local package toolchain used by `pnpm build`, `pnpm typecheck`, and `pnpm test`.

### Build

```bash
cd context
pnpm build
```

The compiled output is written to `context/dist/`.

`openclaw plugins install` loads this plugin from the package root declared in `openclaw.extensions`, so `pnpm build` is primarily a validation step for local development and release preparation.

### Validate the package

```bash
cd context
pnpm typecheck
pnpm test
```

Use `pnpm test` before linking the plugin into OpenClaw so the lifecycle package is validated in isolation.

## Install into OpenClaw

Use the OpenClaw plugin installer, following the same workflow used for packages.

### Recommended local development flow

Link the local working copy instead of copying files:

```bash
openclaw plugins install --link ./context
```

If you are running from a local OpenClaw checkout, use:

```bash
cd <openclaw-repo>
pnpm openclaw plugins install --link <lancedb-claw-repo>/context
```

This keeps OpenClaw pointed at the local package root and is the preferred setup while iterating on the plugin.

Run `pnpm install` in `context/` before using `--link`, because a linked install reuses the working tree and expects local runtime dependencies to already exist under `context/node_modules/`.

### Copy-based install

If you want OpenClaw to copy the package into its managed extensions directory instead of linking it:

```bash
openclaw plugins install ./context
```

OpenClaw copies path installs into `~/.openclaw/extensions/` unless `--link` is used. During copy-based installs, OpenClaw also installs the package runtime dependencies declared in `context/package.json`.

The plugin manifest intentionally allows installation before `semanticIndex` is configured. This avoids install-time validation failures when OpenClaw enables the plugin entry before writing user config.

## Enable the Context Slot

In most cases, `openclaw plugins install` records the plugin, enables it, and applies a compatible slot automatically.

If you need to set it explicitly, ensure the context-engine slot points at `lancedb-claw`:

```json
{
  "plugins": {
    "slots": {
      "contextEngine": "lancedb-claw"
    }
  }
}
```

Restart OpenClaw after configuration changes.

## Minimal OpenClaw Plugin Config

Add a `lancedb-claw` entry under `plugins.entries` in your OpenClaw config:

```json
{
  "plugins": {
    "entries": {
      "lancedb-claw": {
        "enabled": true,
        "config": {
          "storePath": "~/.openclaw/context/lancedb-claw",
          "tailKeepCount": 8,
          "shrinkStartRatio": 0.72,
          "startupRecallLimit": 3,
          "replyRecallLimit": 3,
          "semanticIndex": {
            "provider": "openai",
            "model": "text-embedding-3-small",
            "apiKey": "${OPENAI_API_KEY}"
          }
        }
      }
    }
  }
}
```

`semanticIndex` is recommended for production use, but it is not required for the initial install step. If it is missing, the plugin still loads and degrades to text-only recall until embedding credentials are configured.

If digest summarization should use an explicit model override, add `digestModel` in the same config block.

## Typical Local Workflow

```bash
cd context
pnpm install
pnpm build
pnpm typecheck
pnpm test

openclaw plugins install --link .
```

After installation:

1. Confirm `plugins.slots.contextEngine` resolves to `lancedb-claw`
2. Add `plugins.entries.lancedb-claw.config.semanticIndex` if you want digest embeddings and vector recall
3. Restart OpenClaw
4. Start a session and verify `bootstrap`, `assemble`, and `afterTurn` run without plugin load errors

## Public Config

```json
{
  "storePath": "~/.openclaw/context/lancedb-claw",
  "tailKeepCount": 8,
  "shrinkStartRatio": 0.72,
  "startupRecallLimit": 3,
  "replyRecallLimit": 3,
  "digestModel": {
    "provider": "openai",
    "model": "gpt-4.1-mini",
    "apiKey": "${OPENAI_API_KEY}"
  },
  "semanticIndex": {
    "provider": "openai",
    "model": "text-embedding-3-small",
    "apiKey": "${OPENAI_API_KEY}"
  },
  "logLevel": "info"
}
```

## Design Constraints

- Only `digest` records receive vectors
- Recall scope is limited to the current session
- `bootstrap` and `assemble` both use hybrid recall
- `afterTurn` and `compact` both synchronize indexes incrementally

Inspired by the context-engine implementation of openclaw and the design and implementation of losses claw
https://github.com/Martian-Engineering/lossless-claw
However, there are significant differences in capabilities and support regarding model design, embedding, and full-modalities.
