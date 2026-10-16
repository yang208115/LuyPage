# 后台与存储安全框架

本轮实现核心框架与安全失败路径，需求仍以 ARCHITECTURE 第 9–14 章和 PRD P0 为准。**512 MiB JSON 导入/导出全管线尚未完成，也未完成容量、真实云资源、跨设备或恢复验收。** 2026-10-16 起，设置已接入独立的同步迁移接口 `POST /api/imports` 与 `GET /api/exports`（5000 条、10 MiB），详见 [功能说明](TRANSFERS.md)。本文的分片上传、队列任务及其子资源仍返回 `503 CAPABILITY_UNAVAILABLE`，不创建任务、不返回虚假 `202`。身份认证、同源校验及 requestId 由 API 主入口负责。

## 已实现与接入

| 文件 | 职责 |
| --- | --- |
| `packages/storage/src/jobs.ts` | 状态转移门禁、互斥结果计数、不重复计数的结果替换、最小队列消息校验 |
| `packages/storage/src/chunks.ts` | 实际读取最多 1 MiB、SHA-256、不可变对象键、R2 条件创建与重试校验、有序清单摘要 |
| `packages/storage/src/leases.ts` | D1 条件领取任务，校验事件/游标/调度代次，返回唯一 token 与递增租约代次 |
| `packages/persistence/migrations/0002_jobs.sql` | 任务、分片、条目结果、outbox、调度控制和失败索引；独立增量迁移，不修改核心表 |
| `apps/jobs/src/background.ts` | outbox 有界补发、有限重试、投递/租约超时处理、Queue/DLQ 的持久化失败路径 |
| `apps/jobs/src/index.ts` | Queue/Scheduled 入口；HTTP 明确不可用 |
| `apps/icon-fetcher/src/index.ts` | `503` + `fallback: builtin`；保留调用方本地图标，不读取 URL、不请求公网 |
| `apps/api/src/transfers.ts` | `registerTransferRoutes(app: Hono<AppEnv>)`；同步收藏迁移已接入；未实现的后台任务方法及子资源继续 `503` |

jobs 和 icon-fetcher 的独立 `wrangler.jsonc` 均关闭 workers.dev 和预览 URL，无公开 route；jobs 的 cron 默认空。jobs 配置的 D1 ID、R2、Queue/DLQ 名称只用于本地模拟。图标 Worker 不携带业务 D1、私网绑定、图标桶或其他当前不需要的权限。设置中的自动图标现由 `apps/api/src/icons.ts` 提供固定 DuckDuckGo 目标的代理，仅返回有界 PNG/ICO，不经过该后台 Worker，也不直接抓取收藏网址。本轮未创建云资源、未部署、未执行远程 Wrangler 命令。

各入口的绑定类型由自己的 Wrangler 配置生成；公共运行时类型位于 `types/runtime.d.ts`。执行 `pnpm cf:types` 可统一重新生成，也可仅生成后台绑定：

```sh
WRANGLER_LOG_PATH=/tmp/luypage-wrangler-logs ./node_modules/.bin/wrangler types apps/jobs/worker-configuration.d.ts --config apps/jobs/wrangler.jsonc --env-interface JobsBindings --include-runtime=false --strict-vars=false
WRANGLER_LOG_PATH=/tmp/luypage-wrangler-logs ./node_modules/.bin/wrangler types apps/icon-fetcher/worker-configuration.d.ts --config apps/icon-fetcher/wrangler.jsonc --env-interface IconBindings --include-runtime=false --strict-vars=false
```

输出分别是 `apps/jobs/worker-configuration.d.ts`、`apps/icon-fetcher/worker-configuration.d.ts`。生产源代码通过 `tsconfig.api.json`、`tsconfig.jobs.json`、`tsconfig.icon.json` 分别检查，各配置仅载入自身绑定声明。跨入口集成测试使用 `tsconfig.tests.json` 汇集测试所需声明；不手改生成文件。生成配置不代表资源存在或可部署。

## 数据与提交不变量

- `total = succeeded + duplicate + trashed + invalid + write_failed + unprocessed`。计数为非负整数，当前源收藏总数上限 5,000。`duplicate` 包含文件内重复与有效收藏重复；`trashed` 专指回收站重复。
- `(job_id, source_index)` 唯一。首次结果插入由 SQL trigger 原子扣减未处理数并增加一个结果类别；重试只允许替换 `write_failed`，先减旧类别再增新类别。重复已提交结果不新增成功数。不得绕开条目结果表直接维护计数。
- 条目提交检查任务正在运行、源索引范围、有效租约及代次、当前调度代次与暂停标志。游标只能前进到已有连续结果的边界。领取不是业务提交；后续必须在**同一个 D1 batch 事务**中写业务数据、带租约代次的结果、游标及下一步 outbox。仅在事务外检查租约不构成 fencing。
- 每个 owner 最多一个活动导入；`needs_attention` 仍占活动槽，必须显式解决、取消或过期。`partial` 的重新排队仍受该唯一索引约束。
- 导入执行必须有冻结清单和当前预览版本确认。完整完成还要求无未处理/写入失败条目且布局已应用或明确保留。导出只有记录完整对象、字节数、SHA-256、验证时间且处理完毕才能置 `ready`；本轮没有任何业务代码能产生 ready 导出。
- 租约 token、代次和游标由服务端获得；客户端 owner、对象键、计数及摘要声明不作为信任依据。示例后台表只是可扩展基础，尚无公开任务创建/预览/确认/恢复 API。
- 输入清单冻结后不能新增输入引用，分片引用不能改写，活动任务及仍 ready 的导出不能删除分片引用。结果保留期内及活动任务不允许删除结果；终态过期清理保留摘要计数，已清除结果的任务不能重新执行。

## R2 与容量边界

对象键由服务端身份、任务、阶段、序号及实际 SHA-256 构成：`imports/{ownerId}/{jobId}/{input|normalized}/{index}-{sha256}` 或 `exports/{ownerId}/{jobId}/output/{index}-{sha256}`。ID 拒绝斜杠及路径转义输入，键不包含收藏 URL。

`putImmutableChunk` 只接受实际读取不超过 1 MiB 的流，校验声明长度与摘要后使用 `If-None-Match: *` 条件 PUT，向 R2 提供 SHA-256 校验值。相同内容的并发重试不会覆盖已有对象；条件失败时重新有界读取已有对象并校验内容。R2 对象完成后才能提交 D1 引用；两者不存在跨服务事务。D1 的 `(job_id, stage, chunk_index)` 唯一键保护同编号引用，不同内容的孤儿对象等待后续清理。

`freezeManifest` 校验最多 512 个连续分片、归属/阶段一致、总字节边界并返回不可变副本。它产生的是**有序清单摘要，不是整文件 SHA-256**，也不替代数据库原子冻结、格式解析、引用校验或服务端权威预览。测试中的 512 MiB 是清单字节预算验证，没有读取/导出一个 512 MiB 文件。HTML 仍为 10,000,000 字节；JSON 保持 512 MiB 需求，不下调 P0 容量。

## 投递与故障语义

Queue 消息只接受 `eventId`、`jobId`、`chunkIndex`、`dispatchEpoch`，无 owner/正文/URL。任务归属和事件类型取 D1。增加调度代次用于恢复隔离；恢复时先暂停后台并切换代次/重建事件，旧消息不会继续执行。当前控制表 `paused = 1` 时消费者重试、Scheduled 不补发。

Scheduled 每轮最多处理 50 个过期任务、50 个超时已投递事件及 50 个待投递事件。outbox 条件领取有 60 秒租约、最多 5 次尝试和有界退避；发送成功才标记 `sent`，`sent` 仅表示投递，不表示业务成功。发送成功但标记失败可能重复投递。未确认投递超过 1 小时转 `needs_attention`；任务最大存活/租约到期同样可查询。阈值是骨架初值，正式管线需根据实测调整。

**所有业务事件（包括未知类型、解析、导入、导出、图标与对象清理）均未实现。** 收到匹配的事件时，在一个 D1 batch 中把事件标记 `failed / EVENT_NOT_IMPLEMENTED`，活动任务标记 `needs_attention`，撤销租约后才 ACK。DLQ 使用 `QUEUE_RETRIES_EXHAUSTED`。ACK 仅表示失败已持久化，不是完成工作。已失败事件重投不重复计数、不改完成任务。

非法消息、找不到事件或消息/事件不匹配时，写 `background_failures(status = needs_attention)` 后 ACK，不能凭不可信 jobId 改其他任务。D1 不可用或事务失败时只重试，绝不 ACK。日志只包含内部 ID、固定错误码和尝试次数，不输出原始异常、文件内容、URL 或身份凭据。DLQ 自身无法持久化期间仍可能最终耗尽重试，正式接入必须有外部告警与恢复程序；不能把队列留存当作唯一故障记录。

当前 Scheduled 不删除任何对象或任务，不宣称已实现清理。未来未知事件不得进入“空 handler 后 ACK”的分支，只有业务事务完成或失败被持久化才能确认。

## 本地验证

```sh
./node_modules/.bin/vitest run --config vitest.config.ts packages/storage/src/storage.test.ts
WRANGLER_LOG_PATH=/tmp/luypage-wrangler-logs ./node_modules/.bin/vitest run --config apps/jobs/vitest.config.ts
./node_modules/.bin/tsc --noEmit
```

纯函数测试覆盖计数更替/重复/非法值、状态门禁、实际读取上限、摘要、路径注入、清单隔离与容量预算。独立 `apps/jobs/vitest.config.ts` 使用官方 `@cloudflare/vitest-plugin`，测试存放 `packages/storage/src/background.workers.ts`，在本地 Workers runtime 的 D1/R2 模拟中验证迁移、事务回滚、并发领取、代次 fencing、消息失败与重放、outbox 重试、R2 条件写入和 API/图标 fail-closed。测试的 Queue 发送与 ACK 是按生成 runtime 类型构造的 mock，**不代表真实 Queue 投递/死信服务验收**。

本轮证据（2026-10-15）：纯函数 10 项、后台 Workers 测试 18 项通过；jobs/icon-fetcher 两个配置均通过本地 `wrangler deploy --dry-run` 打包。最新全仓 tsc 尚因其他并行范围的 `apps/web/src/App` 缺失失败，本范围无类型错误；主 agent 完成组装后仍需统一复验。未运行任何云端部署或资源创建。

## 后续 P0 与故障验收清单

以下均仍需实现/验证；本轮局部测试不能替代完整发布条件。

- [ ] 分片上传身份隔离、实际总量、原子冻结清单、文件摘要与重新选文件续传；缺失/损坏分片拒绝进入业务写入。
- [ ] JSON 增量解析及安全 HTML 解析、版本/字段/引用/结束状态检查，分组映射冲突和路径过长处理、规范化分片与权威预览版本更新。
- [ ] 5,000 条和合法最大字段、转义/Unicode 的 512 MiB 往返样本；实际 CPU、内存、D1/R2/Queues 资源计量及手机浏览器证据。
- [ ] 用户确认后，业务写入/逐项结果/游标/下一事件同事务；乱序消息、提交后崩溃、租约过期旧消费者、重复消息和事务中段失败。
- [ ] 每批重新验证有效收藏/回收站重复、分组归属和版本，不覆盖既有元数据；失败项原结果重试，计数与错误索引保持一致。
- [ ] 空账号完整顺序/时间/布局恢复，非空账号的明确布局选项，额外设备写入、部分失败和布局冲突需再次确认。
- [ ] 导出稳定游标、每批 data_revision 验证、有限重试、流式/有界对象生成、完整摘要、ready 门禁、带归属校验的下载；中断、长度不符和缺失对象都不能显示成功。
- [ ] 24 小时输入/规范化分片清理、等待上传/确认过期、导出到期撤销可见性、30 天结果清理；清理与租约并发、R2 删除失败可恢复，活动对象不会被删。
- [ ] outbox 发送后标记失败、消费事务完成后 ACK 丢失、长时间 D1/Queue 故障、DLQ 自身故障/告警、恢复后旧事件隔离；死信不会使任务永久显示运行中。
- [ ] 图标获取的实际连接目标约束（IPv4/IPv6、非标准地址、DNS 变化、逐跳重定向）、整体超时/实际字节/内容类型限制；未证明前继续只用本地图标。
- [ ] 图标结果回写前验证收藏 URL、图标选择与开关未改变；图标失败不能影响收藏事务，缓存按私有权限提供安全栅格内容。
- [ ] 接入真实隔离 D1/R2/Queues/Access 后执行归属/权限测试；备份恢复先暂停写入及调度，保留现状备份，切换代次并核对缺失对象。
- [ ] PRD A01–A20 全部 P0、真实跨设备/浏览器、iOS Safari/触摸、备份恢复及性能证据。日期到来或本地测试通过均不能跳过验收。

实现参考：[R2 条件操作与摘要](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)、[Queues ACK 与重试](https://developers.cloudflare.com/queues/configuration/batching-retries/)、[D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/)、[Wrangler 生成类型](https://developers.cloudflare.com/workers/languages/typescript/)。
