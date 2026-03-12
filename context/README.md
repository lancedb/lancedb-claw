<!-- SPDX-License-Identifier: Apache-2.0 -->

# LanceDB Context Engine

`lancedb-claw` is an OpenClaw context-engine plugin package that persists session context in LanceDB and rebuilds prompt state through digests, hybrid recall, and incremental index maintenance.

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
- All comments and inline documentation remain in English
