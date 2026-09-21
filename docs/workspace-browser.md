# 侧边工作台与公有云目录浏览

日期：2026-09-21
状态：实现与验收记录，非远程 MCP 部署。

## 用户操作

发送“打开我的 OpenViking 工作台”后，Codex 获取工作台地址并在右侧打开，不再先展示工作台卡片。接入确认、长期协作、导入进度与接续摘要仍使用对话卡片。

目录从 `viking://` 开始，展示当前 Key 有权访问的结构。共享 `resources`、用户目录及其他根节点均以公有云实际返回为准，不硬编码个人三个目录，也不生成空的虚拟根。此次实测根目录返回 `resources` 与 `user`。

支持：

- 可展开的目录树、逐层进入、面包屑、返回上级、输入路径、刷新。
- 当前目录文件名筛选、隐藏文件显示、名称正序/倒序。大量条目每次显示 100 项，可继续显示。
- Markdown 渲染与源码切换、JSON 格式化、文本源码、MCP read 返回的受支持图片与音频。
- 目录 L0 摘要、L1 概览（读取 `.abstract.md`、`.overview.md`）；未生成或无权限时显示实际读取失败。
- 文本每次读取 200 行，继续读取追加到已有内容。内部资源链接可继续浏览。

目录和文件浏览只读。不包含 VikingBot、编辑、上传或删除。二进制预览范围取决于公有云 read；PDF/Office 原件下载与嵌入式查看器尚未实现。Markdown 内嵌远程图片不会自动加载；云端图片文件由 read 返回的媒体内容展示。

## 实现

`show_workspace` 与 `open_workspace_panel` 都只返回地址，无 UI 资源元数据；技能随后调用 `open_in_codex`，`placement=right`。原来的默认工作台展示入口不再生成卡片。报告发布与 onboarding 不受此入口变更影响。

目录 UI 参考 [OpenViking Web Studio](https://github.com/volcengine/OpenViking/tree/main/web-studio) 的目录列、路径导航和文件预览方式；核查本地上游源码基线 `32a6aff8f9ab1a153740e9f586f7fdd96194f60e` 的 `dir-browser.tsx`、`item-column.tsx`、`file-preview.tsx` 和资源 API。当前插件使用独立轻量实现 `src/explorer.mjs`，没有复制上游 React 页面或引入其 VikingBot 路由。

浏览器调用本机 `/api/list`、`/api/tree`、`/api/read`，本机代理使用用户已经配置的火山 API Key 调用公有云 MCP。Key 不下发到浏览器。已实际核查云端 tools/list 的参数：list(uri, recursive)，tree(uri, level_limit, node_limit, include_abstract)，read(uris, offset, limit)。没有假设云端已同步开源 Web Studio 的全部 HTTP 参数。

目录树初始最多两层、200 节点；逐层进入后以 list 获取当前目录，树截断不限制深入浏览。名称、正文按不可信数据处理；Markdown 通过 DOMPurify 净化。浏览用独立的只读 URI 校验，资源归档仍沿用个人目录限制，不扩展写入权限。

面板启动记录包含构建指纹和连接身份，更新后不会继续复用旧页面服务；已打开页面遇到连接切换会停止读取并提示重新打开。

## 验收

自动化包括 Python 的根目录范围、路径校验、服务端拒绝、HTTP 目录树和连接切换；MCP 工具元数据验证工作台入口没有 App 资源；浏览器验证目录树、路径导航、文件预览、Markdown 脚本清理、分页追加、错误与窄面板布局。原有 onboarding 卡片与消息回传回归继续运行。

本地截图为虚构资料的浏览器验收，不作为用户云端数据快照。公有云只执行读取验证，不上传或改写已有资料。实际完成结果见本次交付说明。


本轮验证结果：49 项 Python 测试、4 项真实 stdio MCP 测试、原有 App SDK/状态机集成回归与新增目录浏览器回归均通过。插件/技能 schema、已安装版本最小 PATH 启动、Codex app-server 注册与资源读取通过。依赖审计未报告漏洞。

使用真实公有云连接执行 list(viking://)、tree(viking://)、list(viking://user) 和已有项目文档 read，均成功。在 Codex 内置浏览器打开工作台，实际点击目录、展开 user、进入项目文档目录，并验证 Markdown 渲染和源码切换。没有创建新任务去跑模型选工具的独立自然语言验收；该部分由工具元数据、技能路由和已安装服务检查覆盖，不声称已完成独立新任务验收。

安装版本：0.2.0+codex.20260921143329。新版需要新任务加载技能与工具；已经打开的工作台可重新打开以加载新页面。
