# 侧边工作台与公有云目录浏览

日期：2026-09-21
状态：已实现；本机与公有云读取验收记录。远程 MCP 未部署。

## 使用方式

发送“打开我的 OpenViking 工作台”后，Codex 在右侧打开工作台，不先展示工作台卡片。接入确认、长期协作、导入进度和接续摘要保留对话卡片。

目录采用两个区域：左侧完整目录树，右侧内容预览。取消中间的当前目录列表。文件夹和文件都在树中展示，展开箭头只负责展开或收起，点击名称切换预览。窄侧边栏仍显示树，手机宽度改为上下排列。

根节点优先排列 `user`、`resources`，其他根节点以公有云返回为准。个人路径保留 `viking://user/default/...`，不再将 `memories`、`resources`、`sessions` 等直接挂在 `user` 下。当前个人版连接支持 default 身份；这不代表已实现多用户管理或其他用户的枚举。

点击目录自动读取两份内容：

- 一级菜单：摘要（L0）、概览（L1）。
- 每个菜单内：预览、源码、路径。
- 预览展示 Markdown 正文；目录摘要的 YAML 元数据保留在源码中。
- 路径显示对应的 `.abstract.md` 或 `.overview.md`，可复制。

点击文件后直接显示预览、源码、路径。支持 Markdown、格式化 JSON、文本，以及公有云 read 返回的图片和音频。每次读取 200 行，继续读取追加内容。错误时提供重试，不把失败伪装为空目录或已加载。

支持面包屑、返回上级、输入目录路径、刷新和隐藏文件开关。目录树按需加载子节点，可持续深入完整层级；不是预先下载整个库。没有 VikingBot、编辑、上传或删除。PDF/Office 原件查看器尚未实现，Markdown 外链图片不会自动加载。

## 实现与上游对应

参考 [OpenViking Web Studio](https://github.com/volcengine/OpenViking/tree/main/web-studio)，本地上游基线 `32a6aff8f9ab1a153740e9f586f7fdd96194f60e`。核查 `dir-browser.tsx`、`item-column.tsx`、`file-preview.tsx` 和资源 API。

沿用上游的文件夹/文件图标体系，使用 `lucide@0.545.0` 中的 Folder、FolderOpen、FileText 和导航图标，版本对应 Web Studio 的 lucide-react 基线。图标授权随插件 THIRD_PARTY_NOTICES 一起分发。当前界面为独立轻量实现，没有复制上游 React 页面或引入 VikingBot。上游此基线的目录预览为 L0/L1 开关及分段内容；本次按产品要求组织为一级菜单和下属预览/源码/路径菜单。

`show_workspace` 与 `open_workspace_panel` 只返回本机地址，无 App 资源元数据；技能使用 `open_in_codex`、`placement=right` 打开。浏览器请求本机 `/api/list`、`/api/tree`、`/api/read`，本机代理使用已有火山 API Key 请求公有云 MCP，Key 不下发前端。

公有云 `list(viking://user)` 实际返回当前用户的内容，相当于用户目录别名。因此代理在浏览 `user` 时，先验证 `list(viking://user/default)` 可读，再返回 default 身份节点；下层继续读取真实标准路径。不是从 Key 字符串猜测用户身份，也不会把共享 resources 放进个人目录。

初始 tree 请求限制两层、200 节点，作为根目录读取失败时的有限回退；各层列表以 list 为准，避免 tree 中的 user 别名再次造成扁平化。摘要和概览并行读取；目录展开不等待摘要完成，切换节点后忽略旧请求结果。名称和 Markdown 均按不可信内容处理，预览经 DOMPurify 清理。浏览范围只读，归档写入仍限制个人目录。

## 验收

- 50 项 Python 测试通过：包含 user 别名到标准身份路径的适配、权限拒绝、路径校验、只读范围、HTTP tree 与连接切换。
- 4 项真实 stdio MCP 测试通过；原有 App SDK / Python onboarding 状态机及卡片消息回归通过。
- 浏览器回归通过：仅两个区域；user 优先；default 不重复；树含文件与 SVG 图标；L0/L1 自动读取；两级菜单；完整源码和正确路径；旧异步结果隔离；目录收起再展开；Markdown 安全处理；图片和分页；680/390 像素布局。
- 仓库截图来自虚构数据的自动化验收，不含用户云端资料。
- 真实公有云已确认标准路径 `viking://user/default` 及其 `.abstract.md`、`.overview.md` 均可读取。本机 Codex 内置浏览器已验证 user/default 层级、resources 目录的摘要/概览、正文预览、含元数据的源码及标准路径。

没有创建新的 Codex 任务执行模型选工具验收，不将服务注册检查等同于独立自然语言流程验收。

安装版本：`0.2.0+codex.20260921150438`。已打开的旧工作台需要重新打开，新任务加载更新后的插件版本。
