<!-- SPDX-License-Identifier: Apache-2.0 -->

# LanceDB Memory Plugin

`memory-lancedb-claw` is an OpenClaw memory plugin that provides long-term memory with vector search for AI conversations. It uses LanceDB for storage and supports multiple embedding providers, with seamless auto-recall and auto-capture via lifecycle hooks.

## Project Origin

This project is forked from [openclaw/extensions/memory-lancedb](https://github.com/openclaw/openclaw/tree/main/extensions/memory-lancedb) and will be iterated upon based on this foundation.

## Project Status

This project is currently under rapid iteration.

The package is still under active development, and the implementation should be treated as an evolving prototype rather than a stable integration target.

Expect frequent changes to code structure, configuration, internal APIs, and install flow as features and integrations continue to be refined.

## Scope

- Store and retrieve long-term memories with vector embeddings
- Auto-recall relevant memories before agent starts
- Auto-capture important information after conversation ends

## Features

- **Memory Tools**: `memory_recall`, `memory_store`, `memory_forget`
- **Auto-Recall**: Automatically inject relevant memories into context
- **Auto-Capture**: Automatically store important user information
- **Vector Search**: Semantic search using configurable embedding providers
- **Duplicate Detection**: Prevents storing similar memories

## Build the Package

The package root is `memory/`. Run all package commands from this directory.

### Prerequisites

- Node.js 22+
- `pnpm`
- A local OpenClaw checkout if you want to link the plugin into a development gateway

### Install dependencies

```bash
cd memory
pnpm install
```

### Run tests

```bash
cd memory
pnpm test
```

## Install into OpenClaw

### Recommended local development flow

Link the local working copy instead of copying files:

```bash
openclaw plugins install --link ./memory
```

If you are running from a local OpenClaw checkout, use:

```bash
cd <openclaw-repo>
pnpm openclaw plugins install --link <lancedb-claw-repo>/memory
```

### Copy-based install

```bash
openclaw plugins install ./memory
```

## Minimal OpenClaw Plugin Config

Add a `memory-lancedb-claw` entry under `plugins.entries` in your OpenClaw config:

```json
{
  "plugins": {
    "entries": {
      "memory-lancedb-claw": {
        "enabled": true,
        "config": {
          "dbPath": "~/.openclaw/memory/lancedb-claw",
          "autoRecall": true,
          "autoCapture": true,
          "captureMaxChars": 1000,
          "embedding": {
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

## Public Config

```json
{
  "dbPath": "~/.openclaw/memory/lancedb-claw",
  "autoRecall": true,
  "autoCapture": true,
  "captureMaxChars": 1000,
  "embedding": {
    "provider": "openai",
    "model": "text-embedding-3-small",
    "apiKey": "${OPENAI_API_KEY}",
    "baseUrl": "https://api.openai.com/v1",
    "dimensions": 1536
  }
}
```

## Typical Local Workflow

```bash
cd memory
pnpm install
pnpm test

openclaw plugins install --link .
```

After installation:

1. Confirm the plugin is enabled in your OpenClaw config
2. Configure `embedding.apiKey` for vector embeddings
3. Restart OpenClaw
4. Start a session and verify memory tools are available
