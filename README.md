# LuyPage

个人私有的视觉网站收藏夹。需求与架构基线见 [PRD](docs/PRD.md) 和 [ARCHITECTURE](docs/ARCHITECTURE.md)。起始主页已于 2026-10-16 部署到 [LuyPage](https://luypage.lyuy.workers.dev)，尚未完成全部 P0 验收。

线上使用 Cloudflare Access 邮件验证码登录，仅允许已批准的本人邮箱，会话有效期 24 小时。部署详情、资源与验证边界见 [发布记录](docs/DEPLOYMENT.md)。

## 本地运行

需要 Node.js ≥ 22.12、pnpm 11。

```sh
pnpm install
pnpm cf:types
pnpm dev
```

打开 http://127.0.0.1:5173。启动命令会先应用本地 D1 迁移，随后启动 Vite 与 Wrangler。页面使用固定的本地开发身份，数据持久保存在 `.wrangler/state`，重启不会清空。不要把此目录提交到仓库。测试使用独立的内存/临时 D1，不会清理开发数据。

本地默认只监听回环地址。`wrangler.local.jsonc` 和 `local.ts` 仅用于本地开发；生产入口不导入本地模拟认证。开发时不要改为绑定公网。

## 工程边界

| 路径 | 职责 |
| --- | --- |
| `apps/web` | React + TanStack Query + dnd-kit；表单和布局草稿在内存中 |
| `apps/api` | Hono API、Access JWT 认证、同源校验 |
| `apps/jobs` | 后台任务与 outbox 框架 |
| `apps/icon-fetcher` | 隔离的图标 Worker；网络能力默认关闭 |
| `packages/contracts` | 公共类型、Zod 校验、Unicode 与 URL 规则 |
| `packages/domain` | 不依赖数据库的布局规则 |
| `packages/persistence` | D1 SQL 迁移、Drizzle 模型、原子写入 |
| `packages/storage` | R2 对象与任务基础规则 |

前端只能依赖公共契约，不读取数据库模型或 Worker bindings。数据由 D1 作为事实来源，未使用浏览器持久化收藏副本。

## 验证

```sh
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:background
pnpm build
pnpm build:worker
pnpm exec playwright install chromium
pnpm test:e2e
```

`build:worker` 仅构建打包检查，不会部署。后台 Worker 配置与能力边界见 [BACKGROUND](docs/BACKGROUND.md)。实施进度与验证证据见 [IMPLEMENTATION](docs/IMPLEMENTATION.md)。

## 生产部署

`wrangler.jsonc` 已绑定专用生产 D1 和 `luypage.lyuy.workers.dev`，并配置 Access issuer、audience 与同域 `APP_ORIGIN`。Access 允许名单记录于 `docs/access-deployment.json`；预览 URL 保持关闭。生产入口在认证配置缺失时拒绝请求，不会降级为本地账号。

后续发布需登录对应 Cloudflare 账号，审阅新增迁移并完成检查，再显式执行远程命令：

```sh
pnpm run db:migrate:remote
pnpm run deploy
```

日常 `pnpm dev` 和 `pnpm db:migrate` 仍只操作本地数据。发布命令不会创建或修改 Access 策略；新增域名须先配置相应保护。

导入导出完整管线、512 MiB 极限往返、自动图标连接目标约束、真实跨设备、手机实机及备份恢复仍需完成对应验收。当前关闭的能力返回明确 503，不会返回假的任务成功。数据库独立备份必须覆盖回收站和任务，用户 JSON 导出不能替代数据库备份。

D1 关键写入依据 [官方 batch 事务语义](https://developers.cloudflare.com/d1/worker-api/d1-database/)实现；Workers 测试依据 [官方 Vitest 插件文档](https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/)。

数据库迁移开发约定见 [实施记录](docs/IMPLEMENTATION.md#迁移开发)：`db:generate` 输出仅作差异审阅，正式应用目录是 `packages/persistence/migrations`。

## 起始主页

`/` 是壁纸起始页，`/?view=library` 保留完整收藏管理，`/?view=trash` 进入回收站；原有带搜索、分组、标签等筛选参数的链接继续打开管理结果。

主页提供搜索引擎切换、常用收藏、分组文件夹、时钟和日历。主页设置可预览三张内置壁纸、选择默认搜索方式并显示／隐藏时钟和日历，保存后随账号同步；时间使用设备本地时区。收藏排序、分组和批量操作继续在收藏管理中完成。

本地启动会应用 `0003_homepage.sql`，为已有账号增加独立的主页偏好，不改动收藏和原布局。生产环境已应用该增量迁移并发布主页，验证边界见 [发布记录](docs/DEPLOYMENT.md)。内置主页图片随前端静态资源提供。主页设置还支持多张本地背景图库：图片自动压缩为静态 WebP，仅保存在当前浏览器的 IndexedDB，按账号隔离，不上传、不跨设备同步。导入、选择和删除都先预览，点击“保存主页设置”后才生效；其他设备继续显示账号保存的内置壁纸。退出登录保留已保存图库，清除网站数据会删除图库。不需要 R2 或外部壁纸服务。
