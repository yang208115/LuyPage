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

设置中已支持 HTML / JSON 收藏迁移（单次 5000 条、10 MiB）与自动网站图标。迁移只新增有效收藏，同名分组/标签合并，重复网址（含回收站）跳过；JSON 保留分组、标签、备注、置顶、图标选择和时间，不包含回收站或页面布局。HTML 支持浏览器书签文件，嵌套目录按路径合并为分组（最多 40 字）。导入先预览，确认后原子提交；失败可重试。自动图标默认关闭，开启后服务端只向 DuckDuckGo 发送域名，失败回退到默认图标。详见 [功能说明](docs/TRANSFERS.md)。512 MiB 后台任务管线、真实跨设备、手机实机及备份恢复仍需完成对应验收；未实现的后台子资源继续返回明确 503。数据库独立备份必须覆盖回收站和任务，用户 JSON 导出不能替代数据库备份。

D1 关键写入依据 [官方 batch 事务语义](https://developers.cloudflare.com/d1/worker-api/d1-database/)实现；Workers 测试依据 [官方 Vitest 插件文档](https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/)。

数据库迁移开发约定见 [实施记录](docs/IMPLEMENTATION.md#迁移开发)：`db:generate` 输出仅作差异审阅，正式应用目录是 `packages/persistence/migrations`。

## 起始主页

`/` 是壁纸起始页，`/?view=library` 保留完整收藏管理，`/?view=trash` 进入回收站；原有带搜索、分组、标签等筛选参数的链接继续打开管理结果。

主页提供搜索引擎切换、常用收藏、分组文件夹、时钟和日历。主页设置可预览三张内置壁纸、选择默认搜索方式并显示／隐藏时钟和日历，保存后随账号同步；时间使用设备本地时区。编辑主页布局时，单个常用网站可拖到任意网格空位，原位置留空；拖到已有网站上会交换位置。支持方向键移动、Esc 取消、撤销和自动保存，刷新后保留空位；电脑和手机分别保存，窗口宽度变化时按网格顺序换行。收藏管理中的排序、分组和批量操作独立保留。

主页网站磁贴和管理页收藏卡片支持右键打开、编辑、设为／取消常用、复制链接及移入回收站；回收站卡片提供恢复和永久删除，并沿用操作确认。文件夹右键可打开、添加收藏到该分组、管理分组和编辑主页布局；主页空白处提供添加收藏、布局、收藏管理、设置及刷新。菜单支持方向键、Home／End、Esc 和 Shift+F10，自动避开屏幕边缘；按住 Shift 右击及输入框保留浏览器原生菜单。布局编辑和多选时保留对应操作模式。

编辑常用网站时直接拖动网站本身，拖动提示位于图标角上，不再单独占一行；编辑与浏览保持相同行距。主页设置的“网站图标”可将边长调为 40–128 px（默认 62 px），图标外框宽高严格相等，内部图片等比显示，网站名称保持原字号。大小影响常用网站和文件夹弹窗中的网站图标，支持预览、取消、恢复默认并随账号保存；缩放时网格列数自动调整，保留已保存的空位索引，旧客户端写入时保留大小设置。

每个常用网站还可独立设置尺寸：进入“编辑布局”，拖动该图标右下角即可等比缩放，方向键逐像素调整，Shift 加方向键每次调整 10 px。拖动期间实时预览，松手自动保存，Esc 取消本次缩放，支持撤销；电脑和手机分别保存。尺寸按网站 ID 保留，换位置后跟随网站，其他图标大小不变。设置中的默认大小仅影响未单独调整的图标；恢复默认主页布局会清除当前设备的独立尺寸。

天气磁贴显示当前温度、天气、体感、湿度、风速及当天高低温，可在主页设置中隐藏或选择城市，也可点击“使用当前位置”请求浏览器定位授权。只在点击时定位，坐标取整到小数点后两位后用于 Open-Meteo 查询，保存后随账号同步；拒绝授权或定位失败时可手动选城市，或点击“按网络估算城市”，读取本站请求的 Cloudflare 城市信息（明确标记网络估算，可能受代理／VPN 影响，不额外调用 IP 查询服务）。天气每十分钟刷新，失败可重试并保留已有数据显示更新时间；城市搜索与天气通过已认证的本站接口请求固定服务地址，不转发会话信息。数据来源：[Open-Meteo](https://open-meteo.com/)。天气位置存入现有偏好 JSON，旧客户端写入时保留新增字段，无需数据库迁移。

本地启动会应用 `0003_homepage.sql`，为已有账号增加独立的主页偏好，不改动收藏和原布局。生产环境已应用该增量迁移并发布主页，验证边界见 [发布记录](docs/DEPLOYMENT.md)。内置主页图片随前端静态资源提供。主页设置还支持多张本地背景图库：图片自动压缩为静态 WebP，仅保存在当前浏览器的 IndexedDB，按账号隔离，不上传、不跨设备同步。导入、选择和删除都先预览，点击“保存主页设置”后才生效；其他设备继续显示账号保存的内置壁纸。退出登录保留已保存图库，清除网站数据会删除图库。不需要 R2 或外部壁纸服务。
