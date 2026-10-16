# 收藏迁移与自动图标

设置中的两项功能已接入，无新增迁移、绑定或云资源。`TRANSFER_ENABLED=false` 仍表示未实现的后台任务管线关闭，不控制本次同步接口。

## 收藏迁移

- 支持浏览器 Netscape HTML 书签与 LuyPage JSON v1。单次 5000 条、10 MiB，分组与标签各最多 5000 个；超限明确拒绝，不截断。
- 文件先在浏览器预览，确认后提交 `POST /api/imports`。HTML 在惰性的 template 中解析，不执行脚本或加载资源；非 HTTP/HTTPS 条目计数并跳过，其余无效字段拒绝整份导入。
- 导入只新增。按照现有 URL 规范化规则跳过账号内和文件内重复项，含回收站；按照既有 Unicode 名称规则复用同名分组/标签，不覆盖原有内容。嵌套目录转换为 `父目录 / 子目录`，路径超过分组名称 40 字限制时提示修正。
- 服务端重新验证全部输入。分组、标签、收藏和幂等收据在同一带 revision 检查的 D1 batch 中提交，错误回滚；丢失响应后 UI 保留文件预览与同一操作编号，可重试。
- `GET /api/exports` 在同一 D1 batch 中读取有效收藏、分组与标签，前端生成 JSON 或 HTML 下载，不依赖当前筛选或已加载分页。导出执行条数和字节限制检查。
- JSON 保存备注、标签、分组、置顶、图标选择和创建/更新时间；HTML 使用标准书签结构，并用 `DATA-LUYPAGE` 属性携带扩展字段。浏览器重新导出时可能丢弃这些扩展字段，完整元数据迁移优先用 JSON。
- 不导出回收站、布局、账号偏好或本地壁纸；导入追加到现有分组和收藏顺序。此功能是收藏迁移，不是数据库备份或 512 MiB 后台任务管线。

## 自动图标

- `LayoutPreferences.autoIcons` 默认 false，开关使用现有布局保存接口持久化，保留其他布局字段并检查 revision。首页快捷方式、文件夹预览和收藏列表共用账号隔离的偏好。
- `GET /api/bookmarks/:id/icon` 先验证登录身份、归属、开关、删除状态与图标选择。浏览器只访问同源 API，不直接向第三方发送请求。
- 服务端连接地址固定为 `https://icons.duckduckgo.com/ip3/<hostname>.ico`，仅发送域名，不发送收藏的路径、查询参数、备注、Cookie 或 Access 凭据。设置明确告知提供方；IP、私有后缀、非标准端口等地址保留默认图标。
- 不跟随重定向，整体超时 4 秒，实际响应体最多 128 KiB；仅接受 MIME 与文件签名匹配的 PNG/ICO，拒绝 SVG/HTML。响应为 private/no-store，失败不影响收藏写入，页面回退到首字母或内置图标。
- 固定代理避免把用户网址作为连接目标，无需启用尚未完成任意网站抓取约束的 icon-fetcher Worker。服务依赖 DuckDuckGo 可用性；本轮本机直连该提供方出现 TLS 握手错误，真实上游连通性尚未验证。

## 验证

单元测试覆盖域名限制、重定向、内容类型和字节限制；本地 Workers 测试覆盖导入/导出、幂等、重复/回收站、事务回滚、5000 条边界和归属隔离；Playwright 覆盖桌面与 360px 手机视口的文件预览、导入、两种格式下载/再次导入和开关持久化。图标成功与失败采用模拟响应，不代表线上上游验收。

实现依据：[D1 batch 事务语义](https://developers.cloudflare.com/d1/worker-api/d1-database/)、[Workers Request 重定向控制](https://developers.cloudflare.com/workers/runtime-apis/request/)、[DuckDuckGo 仓库中的图标服务说明](https://github.com/duckduckgo/Android/issues/527)。
