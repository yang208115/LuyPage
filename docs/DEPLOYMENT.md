# Cloudflare 发布记录

2026-10-16 08:06（UTC+8）发布起始主页，替换 2026-10-15 的核心版本。入口：[LuyPage](https://luypage.lyuy.workers.dev)。这次发布不表示全部 P0 已验收。

## 生效资源

| 资源 | 标识 |
| --- | --- |
| Cloudflare 账号 | `97163c2808d095a7726108c8074af8ca` |
| Worker | `luypage`，前端静态资源与 API 同域 |
| 当前版本 | `c769e06b-31bb-4418-9fae-1d7d02c209cc`，100% 流量 |
| 当前部署 | `ee5f52b5-76e7-434a-a7b6-00b81a055f04` |
| D1 | `luypage` / `6fa6c485-6817-4417-aad6-e44a30c90600`，APAC |
| Access 应用 | `26a926f8-1cc6-4321-a425-49b9c076a251` |
| Access 可复用策略 | `b52e1db9-b2ec-4848-ab0a-97c300ad2b9d`，仅关联上述应用 |

Access 保护整个 `luypage.lyuy.workers.dev` 主机，唯一 Allow 条件为 `a3305587173@outlook.com`，使用账号中已有的邮件验证码身份提供方，会话 24 小时。配置经用户明确批准；完整非秘密参数见 [access-deployment.json](access-deployment.json)。

Worker 同时校验 Access JWT 的签名、issuer、audience、有效期和 subject。预览 URL 关闭，没有配置其他域名或路由。若添加新域名，应先配置其 Access 保护，不能假定主机级规则自动覆盖新入口。依据：[Cloudflare Access for Workers](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)。

## 2026-10-16 主页发布与验证

- 发布默认主页、三张站内壁纸、搜索、时钟、日历、真实收藏入口和账号同步设置；管理页与回收站入口保留。实现及本地回归结果见 [HOMEPAGE](HOMEPAGE.md)。
- 发布前重新完成前端构建和 Worker dry-run；静态产物为 `index-C6rSMK4X.js`、`index-DNR_IByu.css`。Wrangler 成功上传 9 个新增或变更静态资源，并部署前端与 API。
- 先应用 `0003_homepage.sql`，再发布 Worker。远程核验三项迁移全部记录成功，既有账号得到默认主页偏好；原 `preferences` 与 `data_revision` 保持不变。
- 迁移前后均为 1 个用户、1 个工作区、0 个收藏、0 个分组，`PRAGMA foreign_key_check` 无结果；没有导入本地示例数据。
- Cloudflare API 确认新版本以 100% 流量生效，D1、Access 参数、观测配置和关闭预览 URL 的设置保持一致；Access 策略的修改时间仍为首次部署日期。
- 发布后，无会话请求 `/`、`/?view=library`、`/?view=trash`、`/api/homepage`、`/api/session`、新 JS 资源和默认壁纸均返回 302，目标为现有 Access 登录主机。
- 当前工具没有可用浏览器会话，因此本次未完成生产登录后的页面与业务读写验证；上述 302 仅证明访问保护仍生效。本地交互和视觉验收不替代生产登录验收。

发布前 SQL 备份保存在忽略目录 `.wrangler/release-backups/2026-10-16-before-homepage.sql`（权限 0600，16,875 字节），SHA-256 为 `e51c9fc4c263cc306da14ac91de26a9ab6cb9fe60f2e802330ec20a324cc7269`。备份已恢复到本地内存 SQLite，完整性检查为 `ok`，外键检查无结果，记录数与远程一致。首次写入曾因本地磁盘空间不足中断；重试取得完整文件后，已替换不完整副本并验证哈希。

迁移前的 Time Travel bookmark 为 `00000006-00000000-00005106-8ea12035140d277e21c6e99c459bb361`；备份元数据记录在同目录 `2026-10-16-homepage-release.json`。这些私有备份不得提交到仓库或作为静态资源发布。尚未进行远程 D1 恢复演练。

## 2026-10-15 首次部署与验证

- 前端生产构建、5 份 TypeScript 配置及 Worker dry-run 通过。
- 专用生产 D1 已执行 `0001_core.sql`、`0002_jobs.sql`，远程读取确认迁移记录，`PRAGMA foreign_key_check` 无结果。
- 初始化后生产库用户和收藏数量均为 0；没有上传本地开发身份或收藏数据。
- 远程 API 确认当前版本以 100% 流量生效、D1 绑定正确、Access 策略仅关联 1 个应用、预览 URL 关闭。
- 无会话请求 `/`、`/api/session`、`/api/bookmarks`、构建 JS 资源均返回 302，目标为当前组织的 Access 登录页。
- 向 `/api/session` 发送伪造 `Cf-Access-Jwt-Assertion` 同样被重定向到 Access，未返回私有数据。这验证边缘拦截，不替代 Worker 内部 JWT 校验的单元测试。
- Edge 浏览器已实际显示 `Log in to LuyPage`、Email 输入框和 Send login code 按钮。
- 线上观测开启 Logs / Traces，关闭请求调用日志，查询参数脱敏开启，避免搜索词进入观测 URL。

尚未完成邮箱验证码登录、登录后业务读写及真实跨设备验证。本轮未向生产库写入测试收藏。首次登录后的实际使用仍需验证，不能将登录页可见表述为完整线上验收。

导入导出、自动图标继续关闭；后台 Worker、图标 Worker、R2、Queues 未在本轮部署。完整功能与容量缺口见 [IMPLEMENTATION](IMPLEMENTATION.md)。

## 后续发布与恢复

登录对应 Cloudflare 账号后，审阅迁移并完成项目检查；新增迁移必须新建编号文件，不得重写已应用 SQL。显式执行 `pnpm run db:migrate:remote`，随后 `pnpm run deploy`。本地开发继续使用 `wrangler.local.jsonc`。

本次发布前的可回滚 Worker 版本为 `9ac359b3-8a9c-4da8-b620-297d16399a1d`，对应部署 `02aa8ed7-4819-4db5-b5bb-947382a01bf5`。主页迁移只新增带默认值的独立字段，旧版代码可以继续使用迁移后的数据库；代码回滚时无需删除主页字段。回滚 Worker 代码不会回滚数据库，数据库恢复须保留现状备份并先在隔离环境演练，避免覆盖发布后的新增数据。
