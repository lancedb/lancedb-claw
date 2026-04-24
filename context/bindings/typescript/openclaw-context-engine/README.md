# `@lancedb-claw/context-lancedb`

`@lancedb-claw/context-lancedb` is a LanceDB-backed context engine plugin for OpenClaw.

Recommended OpenClaw version: `2026.3.23+`.

At the moment, this context engine mainly provides two capabilities:

1. Retrieval: summary and history recall for long-running sessions. This area is evolving quickly, so this README keeps it brief.
2. Dynamic Skill Discovery: index the current session's resolved skills, retrieve the skills most relevant to the current conversation, and inject them into the system prompt.

## Retrieval

Retrieval is under active iteration. The broad goal is to improve long-context recall with LanceDB-backed summaries and detail recall, but the exact strategy and tuning are still changing.

## Dynamic Skill Discovery

### Variables used below

- `<OPENCLAW_HOME>`: OpenClaw state directory. Default: `~/.openclaw`
- `<MODEL_CACHE_DIR>`: local embedding model cache directory. Default: `~/.node-llama-cpp/models`
- `<SESSIONS_DIR>`: the runtime session directory for the current agent
- `<LOCAL_EMBEDDING_MODEL>`: built-in local embedding model id. Default: `hf:CompendiumLabs/bge-small-zh-v1.5-gguf/bge-small-zh-v1.5-f16.gguf`

### Goal

Dynamic Skill Discovery is designed to:

- avoid always stuffing a large static skills block into the prompt;
- surface only the skills relevant to the current turn;
- reuse OpenClaw core's resolved `skillsSnapshot` instead of re-implementing skill discovery inside the plugin.

### How it works

- During `bootstrap`, the engine reads the current session's `skillsSnapshot` from `<SESSIONS_DIR>/sessions.json` and syncs `resolvedSkills` into LanceDB.
- During `assemble`, the engine extracts the current prompt and recent user messages as queries, runs vector search against indexed skill descriptions, and injects matched skills into `systemPromptAddition` as `<dynamic_skill_discovery>`.

### Required OpenClaw setting

Use Dynamic Skill Discovery together with the following setting:

```bash
openclaw config set skills.limits.maxSkillsInPrompt 0 --strict-json
```

Why this matters:

- when `maxSkillsInPrompt` is greater than `0`, OpenClaw core may still place a static `<available_skills>` block in the prompt;
- Dynamic Skill Discovery then becomes only a supplement instead of the primary source of skill context;
- setting it to `0` keeps the prompt smaller and lets this engine own skill injection for the current turn.

Restart the gateway after config changes.

### Why it still matters even with OpenClaw prompt protection

OpenClaw already protects the static skills prompt with `skills.limits.maxSkillsInPrompt` and `skills.limits.maxSkillsPromptChars`. When the full `<available_skills>` block grows too large, core switches to compact mode and may finally truncate the list entirely.

That means the current built-in static injection has two important properties:

- it is a meta-layer injection, not full skill-body injection; core only injects `name`, `description`, and `location` into `<available_skills>`;
- even this meta-layer has a prompt-size ceiling, so large local skill sets still hit a bottleneck.

In other words, under large-skill scenarios the core problem is no longer only token cost. It is also discoverability:

- static injection can only expose the prefix that fits in the prompt budget;
- skills beyond that budget are still installed locally, but they are no longer visible to the model through the static catalog;
- Dynamic Skill Discovery decouples local skill inventory size from prompt size by indexing all resolved skills in LanceDB and only injecting the matched subset for the current turn.

This is why Dynamic Skill Discovery remains valuable even when OpenClaw's built-in prompt protection is enabled.

### Minimal configuration

```json5
{
  plugins: {
    slots: {
      contextEngine: "context-lancedb",
    },
    entries: {
      "context-lancedb": {
        enabled: true,
        config: {
          skillSearchEnabled: true,
          embedding: {
            provider: "openai",
            model: "text-embedding-3-small",
            apiKey: "YOUR_API_KEY",
          },
        },
      },
    },
  },
  skills: {
    limits: {
      maxSkillsInPrompt: 0,
    },
  },
}
```

Notes:

- `contextEngine` must be set to `context-lancedb`.
- Dynamic Skill Discovery requires an embedding provider. Without embeddings, skill sync and skill search degrade to no-op.
- The plugin also provides a built-in local small embedding model. When `embedding.provider` is set to `local` and `embedding.localModelPath` is omitted, it defaults to `<LOCAL_EMBEDDING_MODEL>`.
- The built-in local small model uses 512-dimensional embeddings by default.
- The built-in local small model does not require a remote API key, but it does require local `node-llama-cpp` runtime support and model loading time on first use.
- `retrievalEnabled` and `skillSearchEnabled` are independent. You can enable either one or both.

### Local small model example

```json5
{
  plugins: {
    slots: {
      contextEngine: "context-lancedb",
    },
    entries: {
      "context-lancedb": {
        enabled: true,
        config: {
          skillSearchEnabled: true,
          embedding: {
            provider: "local",
          },
        },
      },
    },
  },
  skills: {
    limits: {
      maxSkillsInPrompt: 0,
    },
  },
}
```

### Plugin parameters

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `skillSearchEnabled` | `boolean` | `false` | Enables Dynamic Skill Discovery. |
| `skillSearchRecentMessageCount` | `number` | `2` | Number of recent user messages used as additional search queries. The current prompt is also used when available. |
| `skillSearchCandidateLimit` | `number` | `2` | Preferred number of candidates retrieved per query before merge and filtering. |
| `skillSearchMinResults` | `number` | `2` | Lower bound for per-query fetch size before distance filtering. The final injected count can still be smaller. |
| `skillSearchCacheSize` | `number` | `10` | Number of matched skills kept in the in-memory cache across turns. |
| `skillSearchCleanupOlderThanDays` | `number` | `3` | Cleanup horizon used when optimizing the skills table. |
| `skillSearchMaxDistance` | `number` | `10` | Maximum vector distance accepted for a discovered skill. Smaller values are stricter. |
| `skillSyncIntervalSeconds` | `number` | `60` | Compatibility field only. It is currently deprecated and not used by the current sync path. |
| `dbPath` | `string` | `<OPENCLAW_HOME>/context-engine/lancedb` | LanceDB storage path shared by retrieval and skill search. |

### Embedding parameters

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `embedding.provider` | `string` | required when `embedding` is set | Embedding provider. Supported values: `openai`, `doubao`, `local`. `local` can use the built-in small model. |
| `embedding.model` | `string` | provider-specific | Embedding model name. |
| `embedding.apiKey` | `string` | none | API key for remote providers. |
| `embedding.url` | `string` | provider default | Optional custom endpoint for remote providers. |
| `embedding.dimensions` | `number` | `512` for `local`, `2048` for remote providers | Embedding vector dimension. |
| `embedding.localModelPath` | `string` | `<LOCAL_EMBEDDING_MODEL>` for `local` | Local embedding model path for `local` provider. |
| `embedding.localModelCacheDir` | `string` | `<MODEL_CACHE_DIR>` for `local` | Local model cache directory. |
| `embedding.retry.*` | `object` | optional | Retry configuration for embedding requests. |

## Effect Analysis

The estimates below are based on real built-in OpenClaw skills, not synthetic placeholders. The sample set used for sizing includes:

- `1password`
- `github`
- `weather`
- `tmux`
- `gh-issues`
- `notion`
- `slack`
- `session-logs`

For this sample, the static meta entry (`name + description + location`) costs about `48` to `134` tokens per skill, with an average of about `81` tokens per skill.

Typical Dynamic Skill Discovery prompt cost is much flatter:

- about `0.5k` tokens for roughly `4` matched skills;
- about `1.0k` tokens when the in-memory cache grows to around `10` matched skills.

Under OpenClaw's default static prompt protection, the rough comparison looks like this:

| Local skill count | Static skills prompt | Dynamic discovery, typical | Approximate savings |
| --- | ---: | ---: | ---: |
| `10` | `~0.9k` tokens | `~0.5k` tokens | `~0.4k` tokens |
| `20` | `~1.7k` tokens | `~0.5k` tokens | `~1.2k` tokens |
| `100` | `~3.6k` tokens | `~0.5k` tokens | `~3.1k` tokens |
| `200` | `~5.4k` tokens | `~0.5k` tokens | `~5.0k` tokens |
| `500` | `~5.4k` tokens | `~0.5k` tokens | `~5.0k` tokens |

Interpretation:

- for small skill sets, the benefit is partly token reduction and partly better relevance;
- after the skill set becomes large, static prompt protection prevents unlimited token growth, but it does so by compacting and truncating the visible skill catalog;
- Dynamic Skill Discovery keeps prompt cost low while still letting the engine search across the full locally resolved skill inventory.

### Full prompt share

Using a real OpenClaw full-prompt sample as a baseline, the complete prompt is about `27.1k` chars, or about `6.8k` tokens. In that baseline:

- the fixed `## Skills` instruction section without an actual skill catalog is only about `658` chars, or about `165` tokens;
- that means the no-catalog skill section is only about `2.4%` of the full prompt;
- once a static skill catalog is injected, the skill section becomes a meaningful fraction of the whole system prompt.

With the same baseline prompt, the skill-related share looks roughly like this:

| Local skill count | Static skill share in full prompt | Dynamic discovery share in full prompt | Skill-section reduction | Whole-prompt reduction |
| --- | ---: | ---: | ---: | ---: |
| `10` | `~13.9%` | `~8.9%` | `~39.8%` | `~5.5%` |
| `20` | `~22.1%` | `~8.9%` | `~65.7%` | `~14.5%` |
| `100` | `~36.5%` | `~8.9%` | `~83.1%` | `~30.3%` |
| `200` | `~46.0%` | `~8.9%` | `~88.6%` | `~40.7%` |
| `500` | `~46.0%` | `~8.9%` | `~88.6%` | `~40.7%` |

So the main takeaway is:

- with a small local skill set, skill discovery is a moderate prompt optimization;
- with a large local skill set, the static skill catalog can dominate a very large fraction of the full prompt budget;
- Dynamic Skill Discovery keeps the skill portion comparatively flat, which is where most of the effective prompt-budget savings come from.

## Current Advantages

The current Skill Dynamic Discovery design has three practical advantages:

- token savings: it usually replaces a large static meta catalog with a much smaller matched subset;
- embedding-based high-performance matching: skill retrieval is vector-based, so relevance is driven by the current prompt and recent user messages instead of a fixed prefix list;
- almost unlimited local skill discovery capacity: prompt size no longer determines how many local skills can be discovered, because the full resolved skill set is indexed in LanceDB and only the matched subset is injected into the prompt.
