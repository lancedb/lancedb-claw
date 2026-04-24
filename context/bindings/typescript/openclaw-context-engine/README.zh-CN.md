# `@lancedb-claw/context-lancedb`

`@lancedb-claw/context-lancedb` 是一个基于 LanceDB 的 OpenClaw context engine 插件。

建议配合 `2026.3.23+` 版本的 OpenClaw 使用。

当前这个 context engine 主要提供两个能力：

1. Retrieval：为长会话提供摘要与历史召回。这部分正在快速迭代，因此本文只做简要说明。
2. Skill 动态发现：索引当前 session 已解析出的 skills，在当前对话里检索最相关的 skill，并把结果注入 system prompt。

## Retrieval

Retrieval 目前仍在快速演进中。它的总体目标是基于 LanceDB 提供更好的长上下文摘要召回和细节召回，但具体策略和调参方式还在持续调整。

## Skill 动态发现

### 文中变量约定

- `<OPENCLAW_HOME>`：OpenClaw 状态目录，默认是 `~/.openclaw`
- `<MODEL_CACHE_DIR>`：本地 embedding 模型缓存目录，默认是 `~/.node-llama-cpp/models`
- `<SESSIONS_DIR>`：当前 agent 的 runtime session 目录
- `<LOCAL_EMBEDDING_MODEL>`：内置本地 embedding 模型标识，默认是 `hf:CompendiumLabs/bge-small-zh-v1.5-gguf/bge-small-zh-v1.5-f16.gguf`

### 目标

Skill 动态发现的目标是：

- 避免总是把一大段静态 skills 列表塞进 prompt；
- 只为当前轮次补充真正相关的 skill；
- 直接复用 OpenClaw core 已经产出的 `skillsSnapshot`，而不是在插件里重复实现一套 skill discovery。

### 工作方式

- 在 `bootstrap` 阶段，engine 会从当前 session 对应的 `<SESSIONS_DIR>/sessions.json` 中读取 `skillsSnapshot`，并把其中的 `resolvedSkills` 同步到 LanceDB。
- 在 `assemble` 阶段，engine 会从当前 prompt 和最近的用户消息中提取查询文本，对 skill 描述做向量检索，并把命中的 skill 以 `<dynamic_skill_discovery>` 的形式注入 `systemPromptAddition`。

### 必须配合的 OpenClaw 设置

使用 Skill 动态发现时，最好同时执行：

```bash
openclaw config set skills.limits.maxSkillsInPrompt 0 --strict-json
```

原因是：

- 当 `maxSkillsInPrompt` 大于 `0` 时，OpenClaw core 仍然可能把静态 `<available_skills>` 块塞进 prompt；
- 这样 Skill 动态发现就只会变成补充信息，而不是主要的 skill 注入来源；
- 设为 `0` 后可以减少 prompt 噪音，并让当前 context engine 主导本轮技能注入。

修改配置后需要重启 gateway。

### 为什么在 OpenClaw 自带保护下仍然有意义

OpenClaw 已经通过 `skills.limits.maxSkillsInPrompt` 和 `skills.limits.maxSkillsPromptChars` 对静态 skills prompt 做了保护。当完整 `<available_skills>` 过大时，core 会先切到 compact 模式，必要时还会继续截断列表。

这意味着当前内置的静态 skill 注入有两个关键特征：

- 它本质上是 meta 层注入，不是把完整 skill body 注入到 prompt；core 注入的只是 `<available_skills>` 中的 `name`、`description` 和 `location`；
- 但即使只是这层 meta 信息，在大量 skill 场景下也一样会遇到 prompt 上限瓶颈。

也就是说，在大规模 skill 场景里，问题已经不只是 token 消耗，还包括可发现性：

- 静态注入只能暴露出当前 prompt 预算能容纳的那一段前缀 skill；
- 超出预算的 skill 虽然已经本地安装，但模型在静态 catalog 里已经看不到它们；
- Skill 动态发现通过 LanceDB 为全部 resolved skills 建索引，只把当前轮次真正命中的子集注入 prompt，从而把“本地 skill 总量”与“prompt 可承载大小”解耦。

这也是为什么即使 OpenClaw 已经有静态 prompt 保护，Skill 动态发现仍然有明确价值。

### 最小配置示例

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

说明：

- `contextEngine` 必须选择为 `context-lancedb`。
- Skill 动态发现依赖 embedding provider。没有 embedding 时，skill sync 和 skill search 会退化为 no-op。
- 插件内置了一个本地 embedding 小模型。当 `embedding.provider` 设为 `local` 且未显式配置 `embedding.localModelPath` 时，默认使用 `<LOCAL_EMBEDDING_MODEL>`。
- 这个内置本地小模型默认输出 512 维 embedding。
- 这个内置本地小模型不需要远端 API Key，但首次使用时需要本地 `node-llama-cpp` 运行时，并且会有模型加载开销。
- `retrievalEnabled` 和 `skillSearchEnabled` 相互独立，可以单独开启，也可以同时开启。

### 本地小模型示例

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

### 插件参数

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `skillSearchEnabled` | `boolean` | `false` | 是否开启 Skill 动态发现。 |
| `skillSearchRecentMessageCount` | `number` | `2` | 额外参与检索的最近用户消息条数；如果当前 prompt 可用，也会一并作为查询。 |
| `skillSearchCandidateLimit` | `number` | `2` | 每个查询在 merge 和过滤之前期望拉取的候选 skill 数量。 |
| `skillSearchMinResults` | `number` | `2` | 每个查询在距离过滤之前的最小拉取数量下界；最终真正注入的 skill 数可能仍然更少。 |
| `skillSearchCacheSize` | `number` | `10` | 跨轮次保存在内存中的已命中 skill 数量。 |
| `skillSearchCleanupOlderThanDays` | `number` | `3` | 优化 skills 表时使用的清理时间窗口。 |
| `skillSearchMaxDistance` | `number` | `10` | 可接受的最大向量距离，值越小越严格。 |
| `skillSyncIntervalSeconds` | `number` | `60` | 兼容字段，当前同步路径中已废弃，不再实际生效。 |
| `dbPath` | `string` | `<OPENCLAW_HOME>/context-engine/lancedb` | Retrieval 和 Skill Search 共用的 LanceDB 存储路径。 |

### Embedding 参数

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `embedding.provider` | `string` | 配置 `embedding` 时必填 | Embedding provider，支持 `openai`、`doubao`、`local`。其中 `local` 可直接使用内置小模型。 |
| `embedding.model` | `string` | provider 相关 | Embedding 模型名。 |
| `embedding.apiKey` | `string` | 无 | 远端 provider 使用的 API Key。 |
| `embedding.url` | `string` | provider 默认值 | 远端 provider 的自定义 endpoint。 |
| `embedding.dimensions` | `number` | `local` 默认为 `512`，远端 provider 默认为 `2048` | 向量维度。 |
| `embedding.localModelPath` | `string` | `local` 时默认为 `<LOCAL_EMBEDDING_MODEL>` | `local` provider 使用的本地模型路径。 |
| `embedding.localModelCacheDir` | `string` | `local` 时默认为 `<MODEL_CACHE_DIR>` | 本地模型缓存目录。 |
| `embedding.retry.*` | `object` | 可选 | Embedding 请求的重试配置。 |

## 效果分析

下面的估算基于真实的 OpenClaw 内置 skill，而不是本地伪造样本。抽样对象包括：

- `1password`
- `github`
- `weather`
- `tmux`
- `gh-issues`
- `notion`
- `slack`
- `session-logs`

对于这组样本，静态 meta 条目，也就是 `name + description + location`，单个 skill 大约消耗 `48` 到 `134` tokens，平均约 `81` tokens。

Skill 动态发现的典型 prompt 成本则更平稳：

- 命中约 `4` 个 skill 时，大约 `0.5k` tokens；
- 当内存缓存增长到约 `10` 个命中 skill 时，大约 `1.0k` tokens。

在 OpenClaw 默认静态 prompt 保护开启时，可以粗略理解为：

| 本地 skill 数量 | 静态 skills prompt | 动态发现典型成本 | 大致节省 |
| --- | ---: | ---: | ---: |
| `10` | `~0.9k` tokens | `~0.5k` tokens | `~0.4k` tokens |
| `20` | `~1.7k` tokens | `~0.5k` tokens | `~1.2k` tokens |
| `100` | `~3.6k` tokens | `~0.5k` tokens | `~3.1k` tokens |
| `200` | `~5.4k` tokens | `~0.5k` tokens | `~5.0k` tokens |
| `500` | `~5.4k` tokens | `~0.5k` tokens | `~5.0k` tokens |

这里的含义是：

- 在小规模 skill 集合下，动态发现的收益一部分来自节省 token，一部分来自提升相关性；
- 当 skill 数量继续变大时，OpenClaw 的静态保护会阻止 token 无限制增长，但代价是静态可见的 skill catalog 会进入 compact 甚至 truncate；
- Skill 动态发现则可以在保持较低 prompt 成本的同时，继续在完整的本地 resolved skill 集合上做检索。

### 在完整 prompt 里的占比

以一份真实的 OpenClaw 完整 prompt 为基线估算，整条 prompt 大约是 `27.1k chars`，约 `6.8k tokens`。在这个基线里：

- 不含实际 skill catalog 时，固定的 `## Skills` 说明区只有约 `658 chars`，也就是约 `165 tokens`；
- 换句话说，没有 catalog 时，skill 相关部分只占完整 prompt 的约 `2.4%`；
- 一旦开始注入静态 skill catalog，skill 相关部分就会迅速变成整条 system prompt 中很显著的一块。

在同一条完整 prompt 基线下，可以粗略理解为：

| 本地 skill 数量 | 静态 skill 部分占完整 prompt 比例 | 动态发现占完整 prompt 比例 | skill 区域缩减比例 | 整体 prompt 缩减比例 |
| --- | ---: | ---: | ---: | ---: |
| `10` | `~13.9%` | `~8.9%` | `~39.8%` | `~5.5%` |
| `20` | `~22.1%` | `~8.9%` | `~65.7%` | `~14.5%` |
| `100` | `~36.5%` | `~8.9%` | `~83.1%` | `~30.3%` |
| `200` | `~46.0%` | `~8.9%` | `~88.6%` | `~40.7%` |
| `500` | `~46.0%` | `~8.9%` | `~88.6%` | `~40.7%` |

因此更直接的结论是：

- 在小规模 skill 集合下，Skill 动态发现主要是中等强度的 prompt 优化；
- 在大规模 skill 集合下，静态 skill catalog 会吞掉完整 prompt 中非常可观的一部分预算；
- Skill 动态发现能把 skill 部分的占比长期压在较低水平，这才是它在大规模本地 skill 场景下最重要的收益来源。

## 当前优势总结

当前 Skill 动态发现有三个直接优势：

- 节省 token：把原本较大的静态 meta catalog 替换成更小的当前命中子集；
- 基于 embedding 的高性能精准匹配：按照当前 prompt 和最近用户消息做向量检索，而不是依赖固定前缀列表；
- 几乎无限的本地 skill 发现能力：prompt 大小不再直接决定本地 skill 能否被发现，因为完整 resolved skill 集合会先被索引到 LanceDB，再按当前轮次只注入命中的子集。
