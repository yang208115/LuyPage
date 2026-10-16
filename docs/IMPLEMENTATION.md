# 实施记录

本轮先落地可运行的核心框架：pnpm workspace、共享契约、React 页面、Hono API、D1 约束与事务、认证边界及分层测试。PRD/ARCHITECTURE 仍为需求基线，未完成项不等于缩减 P0。

## 模块约定

- `packages/contracts` 是唯一浏览器可用的公共数据契约；API 返回直接 DTO，只有 mutation 使用 `{ data, revision }`。
- `GET /api/session` → Session；`GET /api/bootstrap` → Bootstrap。
- `GET /api/bookmarks` 和 `/api/trash` → BookmarkPage；参数 q/groupId/tagIds(逗号分隔)/pinned/sort/cursor/limit，未分组 groupId=ungrouped。
- `POST /api/bookmarks`、`PATCH /api/bookmarks/:id` → MutationResult<Bookmark>。
- `POST /api/bookmarks/:id/trash`、`POST /api/trash/:id/restore`、`DELETE /api/trash/:id` 接受 VersionInput；→ MutationResult<Bookmark | null>。
- `POST /api/bookmarks/batch` → BatchResult。
- `/api/groups`、`/api/tags` 的 POST/PATCH 使用 NameInput；DELETE 使用 VersionInput；→ MutationResult<Group | Tag | null>。
- `GET /api/layout/index` → LayoutIndex；`PUT /api/layout` 使用 LayoutSaveInput → MutationResult<LayoutIndex>。
- mutation 的 operationId 是 UUID，同一逻辑重试保留同一 ID；有意改动输入必须生成新 ID。
- auth 中间件设置 ownerId/displayName/isLocal/requestId。业务路由由 `registerRoutes(app: Hono<AppEnv>)` 注册，主入口负责认证/同源/错误/大小限制。
- 核心表由 persistence 模块维护。users(id, created_at)、auth_identities(provider, issuer, subject, owner_id)、workspace_state(owner_id, data_revision, …) 供 auth 初始化使用。
- `normalizeUrl(value)` → `{ url, normalizedUrl, hostname }`；`nameKey(value)` 与 `searchKey(value)` 用固定 Unicode case folding；`applyLayoutOperations(index, operations, preferences)` 返回不修改输入的 LayoutIndex。

## 本地与生产

本地身份仅存在于 local.ts 入口，生产入口不导入它。核心版本已于 2026-10-15 接入专用生产 D1 和仅本人邮箱可用的 Access，部署在 `luypage.lyuy.workers.dev`。所有日常开发命令仍只使用本地 D1 模拟；远程发布记录见 [DEPLOYMENT](DEPLOYMENT.md)。

导入/导出完整任务管线和自动图标暂不作为已完成能力。UI 明确显示不可用；自动图标在实际连接目标约束通过验证前禁止外部获取。

## 当前实现与证据

- 工程：pnpm workspace、严格 TypeScript、锁文件、独立前端/API/后台/图标类型检查，公共运行时类型由 Wrangler 生成。
- 认证：生产校验 Access JWT 的签名、issuer、audience、有效期及 subject；本地入口与生产入口分离。同源 JSON 写请求、1 MiB 请求体上限、结构化错误、私有 API 不缓存。
- 核心数据：真实 D1 持久化、同账号 URL 唯一（含回收站）、复合归属外键、Unicode 名称判重、多条件检索、带版本稳定游标、逐条批量结果、回收站。
- 写入：事务内 CHECK 版本断言、操作 ID 和请求摘要回执；并发响应丢失后可重试，布局顺序和偏好原子提交。
- 布局：完整轻量索引、相对操作、服务端默认布局只读预览。`GET /api/layout/default-preview` 不写入数据。删除分组/标签前可用 `GET /api/{groups|tags}/:id/impact` 查询有效、回收站及总影响数量。
- 后台：R2 不可变分片、租约代次、任务计数和 outbox 框架；未实现事件持久化失败后才确认。完整导入导出和图标网络获取继续关闭，详见 BACKGROUND。

测试覆盖 URL/Unicode/字段、前后端草稿重放、身份和 CSRF、D1 隔离/回收站/组合搜索/版本/幂等、中途失败整体回滚、5000 条布局原子保存、R2 条件写入和后台故障。验证均使用本地运行时，不是线上资源、真实跨设备或性能目标的验收。

### 本轮验证结果（2026-10-15）

| 检查 | 结果 |
| --- | --- |
| TypeScript | 前端、API、后台、图标及测试 5 份配置通过 |
| 规则及草稿单元测试 | 140 项通过 |
| API / D1 / R2 集成测试 | 23 项通过 |
| 后台与存储故障测试 | 18 项通过 |
| Playwright | 桌面 Chromium 4 项、360 px 手机模拟 3 项通过；触摸拖动 1 项明确跳过 |
| 构建 | 前端生产构建、API / 后台 / 图标 Worker dry-run 通过；前端与 API 已部署，后台与图标 Worker 尚未部署 |

浏览器用例使用独立 D1 目录，覆盖网址校验、断网与 Access 跳转后保留草稿、保存及刷新、搜索 URL、布局取消与失败重试、跨组保存、回收站恢复、重复收藏查看、被筛选隐藏的编辑冲突记录，以及真实鼠标拖动到空分组。测试不写入日常开发账号。桌面和手机截图位于 `test-results/*-collection.png`（重新执行测试会更新）。

子 agent 分工为持久化/API 业务、前端、公共契约/领域规则、后台/存储。主 agent 先建立公共接口和工程骨架，再负责认证入口、样式、故障修复与集成验收。前端子 agent 因上游连接故障中止后的剩余工作已由主 agent 接续完成。

## 迁移开发

Wrangler 只执行 `packages/persistence/migrations` 中经审阅的编号 SQL。`pnpm db:generate` 在 `packages/persistence/generated` 中产生 Drizzle 核心表的差异候选；此目录保存初始 snapshot，但不自动执行。新增变更时先审阅生成差异，再以新的连续编号加入正式迁移目录。后台任务的触发器和特殊 CHECK 约束通过正式 SQL 显式维护，不依赖 ORM 自动推导。

已应用的正式迁移不可重写。`0001_core.sql`、`0002_jobs.sql` 已应用到专用生产 D1，远程外键检查通过。本地初始化期间的最终约束已同步，且保留了开发账号。备份恢复演练仍需单独验证。

## 尚未完成的 P0

- HTML/JSON 完整解析预览、分片上传/确认/执行、可靠导出下载、任务恢复与清理。
- 512 MiB 合法极限样本端到端往返及资源用量。
- 自动图标的实际连接目标约束与真实获取/缓存。
- 登录后的线上业务流程、真实跨设备、移动设备和浏览器矩阵、备份恢复；R2 / Queues 完整资源接入仍待对应功能完成。
- A16 约定设备/网络上的加载与搜索性能指标；5000 条本地事务测试不能替代这项验收。

回执目前保留不自动过期，避免旧操作 ID 因回执清理而重新执行。后续须实现客户端重试窗口与过期墓碑/确认机制，并纳入容量评估。
