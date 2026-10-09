# OpenViking Codex App 分发与桌面入口

日期：2026-10-09
状态：当前实现核查与发布建议；仓库已公开；未部署远程 MCP、未提交商店审核。
项目：https://github.com/zhangxiaoyan1081/openviking-developer-codex-app

## 当前可以交付什么

仓库已公开。团队成员和外部用户均可直接复制 [安装指令](install.md) 给 Codex，或匿名 clone 后运行安装器；不需要维护者逐个授权。ZIP 保留为可选方式。完整操作见 [团队试用说明](team-quickstart.md)。源包包含安装器、锁定的官方插件版本信息、交互插件和打包资源；本机安装后生成的绝对运行路径、凭据与历史不应进入分发包。

安装器在接收者的设备上检测解释器并生成该设备的启动配置。继续沿用这条已经验证过的安装路径；直接让成员复制维护者的插件缓存或本机 marketplace 目录会携带不适用于其电脑的绝对路径。

本次图标采用用户提供的 `marketing/icons and logos/openviking.svg` 原文件，作为插件 composerIcon、logo、logoDark，并内嵌到卡片与工作台页头，不依赖外部图片服务。

## 分发路径

自 v0.2.5 起，每次完成的更新提升版本号并创建独立 [GitHub Release](https://github.com/zhangxiaoyan1081/openviking-developer-codex-app/releases)。推送 `main` 后，自动验收通过才发布，附件提供含构建资源的安装 ZIP 与 SHA-256 校验文件。已发布标签和附件不覆盖；维护规则见 [AGENTS.md](../AGENTS.md)。

| 阶段 | 建议路径 | 当前条件与缺口 |
|---|---|---|
| 团队小范围试用 | 公开 GitHub 安装指令；ZIP 可选 | 当前可用；每人配置自己的 Key，桌面安装后在新任务加载 |
| 同一 ChatGPT workspace 统一提供 | workspace 管理员发布插件并限定角色 | 官方支持 workspace 发布；本插件的本地 stdio、Python/Node 依赖、官方 Hook 依赖仍需在成员设备验收，不能假设分享即安装完毕 |
| 面向 OV 用户的外部分发 | 公开 GitHub 仓库 + 控制台接入指令 | 仓库已可公开下载；大规模发行仍需固定发布版本、校验值、升级/回退说明，以及干净设备安装验收 |
| 官方公共插件目录 | 通过 OpenAI 提交、审核后发布 | 当前提交文档面向远程 HTTPS MCP；本插件是本地 stdio 服务，需要改造架构或联系 OpenAI 确认本地 MCP 支持，不是上传现有 ZIP 就自动上架 |

Workspace 内发布与公共目录发布的边界，参见 [官方打包与分发文档](https://developers.openai.com/plugins/build/plugins)。公共提交流程与远程 MCP 条件参见 [官方提交文档](https://developers.openai.com/plugins/deploy/submission)。本文未验证当前账号的管理员身份或发布入口可用性。

若走公共目录，建议保留本机组件负责本地历史、AGENTS.md 与官方 Hook，将可远程化的工作台、查询和报告服务作为远程 MCP；需要重新设计认证和本地/云端职责，不能将当前本地文件操作原样搬到服务端。具体映射、认证和实施步骤见 [远程 MCP 改造方案](remote-mcp.md)，尚未实现。

对外发行前需落实正式发布主体、支持入口、隐私说明，以及凭据/导入范围/已验证能力的用户说明。目前 manifest 的发布者仍为 Local developer；品牌图标更换不意味着已由官方主体发布。真正的完整用户验收还需覆盖干净设备、实际模型引导与多平台，不把 CI 测试当成全部完成。

## 桌面左侧入口

v0.2.8 新增本地原型：MCP 工具 `open_workspace` 声明 `_meta["openai/ui"].entrypoints=[{type:"global"}]`，绑定独立的 `ui://openviking/workspace.html` 资源。标题为 OpenViking，服务图标沿用仓库 SVG。该工具仅对 App/宿主可见，普通任务不应调用它产生卡片。

入口不以公开上架为前提。官方提供本地市场安装与测试路径；当前本机客户端代码也包含从本地 MCP 工具发现全局入口的路径。这能支持本地原型开发，但不等于真实左栏渲染已经验收。官方说明见 [Plugin Extensions](https://developers.openai.com/plugins/build/extensions) 与 [本地插件打包](https://developers.openai.com/plugins/build/plugins)。此前“没有公开侧栏接口”的判断已过时。

在仓库目录执行 `python3 install.py --companion-only`，仅更新 App；重启桌面客户端重新加载入口。若当前宿主支持并展示此入口，点击左侧 OpenViking 即可打开目录、工作进展、报告。原有对话指令仍使用右侧浏览器面板，不改变其交互。

页面在 MCP Apps 初始化后主动读取只读工作台状态，不依赖前置模型调用或 tool-result 通知。未连接时引导在对话接入；已连接时直接浏览。打开/刷新页面不会自动复用连接、确认协作模式、上传历史或完成绑定。工作台只浏览报告，生成与接续仍由用户在对话发起。

本机已安装 v0.2.8；通过已安装 transport 与新启动 Codex app-server 验证入口声明和 HTML 资源读取。原型验收包含协议元数据、资源读取、无 tool-result 独立启动、目录和 L1/文件预览、Session 概览、报告浏览、重开、错误重试。模拟宿主测试不代表真实 Codex UI 验收。当前桌面自动化工具禁止操作 Codex 主窗口，因此左栏实际出现与点击加载需人工确认；未通过修改客户端或绕过限制验证。

## 验证范围

图标：原 SVG 复制一致、manifest 路径存在、打包 HTML 内嵌一致、插件 schema 校验、模拟宿主卡片显示、本机安装配置可启动。插件列表的原生渲染未通过窗口自动化验收。

分发：ZIP 使用明确的源码/打包文件清单生成，排除 .git、node_modules、本机配置、缓存和个人历史；解压后执行安装计划及插件 schema 校验。团队其他设备尚未实际安装；workspace 和公共目录均未发布。

公开检查：检查了全部 14 个已有提交的 205 个可达 Git blob，对常见密钥格式和凭据字面量的扫描未发现命中；逐一检查了历史中的 17 张不同 PNG，内容为界面与测试样例。该检查不等同于完整安全审计。公开后另行验证匿名下载与安装计划；没有将本机配置、凭据或个人历史加入仓库。
