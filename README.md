# OpenViking Developer Codex App

在 Codex 对话中接入火山 OpenViking，带入已有工作，再接着做。

插件名：`openviking-codex-app`。个人版交互插件；自动记忆复用官方 `openviking-memory`。服务端仅连接火山商业化实例。本版不识别 key 对应的版本、不提供企业分流。

## 体验路径

1. 用户粘贴控制台生成的 [接入指令](docs/console-connect.md)。指令含 Key 时，Codex 验证后继续；没有提供 Key 时，先显示连接卡片，选择“使用当前连接 / 更换 API Key”或填写新 Key；宿主需要信任 Hook 或新任务加载时按实际提示完成。
2. 连接验证成功后，对话中显示范围卡片：近期全部工作、选择项目、描述范围、从现在开始。
3. 点击选择交回当前 Codex。Agent 准备可访问历史清单，再用卡片确认，随后执行导入与 Working Memory 汇总。
4. 工作台卡片显示工作进展、目录、报告与洞察。可直接接续工作或按需生成报告；需要长时间查看时在侧边栏打开工作台。

接入不自动打开浏览器。卡片使用标准 MCP Apps 的 `ui://` 资源、`callServerTool` 和 `sendMessage`。卡片是否展示、消息能否发回、展开方式由宿主支持决定。CLI 或不支持卡片的宿主使用原生选项/文本接续同一流程。

## 试用

已安装上一版，在此仓库目录执行（更新交互插件无需先配置 Key）：

```bash
python3 install.py --companion-only
```

它只更新本仓库插件，不重新安装官方记忆插件。已有旧名称安装时，先安装 `openviking-codex-app`，成功后卸载 `ov-personal`；凭据和本地同步、报告数据继续复用。安装后**新开一个 Codex 任务**并发送：

> 使用 openviking-codex-app，调用 show_onboarding，展示 OpenViking 接入卡片。先展示连接确认，不打开浏览器。

日常使用可以说：

> 打开我的 OpenViking 工作台。

> 根据最近 7 天的工作生成周报，列出来源。

> 在侧边栏打开 OpenViking 工作台。

侧边栏用于查看目录、已发布工作卡片和报告；生成报告与接续工作通过对话中的卡片或直接提问完成。它不会在用户没有发出请求时后台启动另一个 Agent。

首次接入使用 [控制台指令](docs/console-connect.md)。私有仓库可通过 `gh repo clone zhangxiaoyan1081/openviking-developer-codex-app` 获取。需要 Python 3.10+、Node.js 22+、Git、Codex CLI。分发包已包含打包 JS，用户无需 npm install。

仅打开日常工作台：

```bash
python3 plugins/openviking-codex-app/scripts/panel.py start
```

## 连接行为

- 指令带有 Key：验证鉴权和个人目录可读后继续，不重复填写。
- 只有本机旧配置：先点击“使用当前连接”或“更换 API Key”。已有配置本身不算本次连接确认。
- 没有 Key：卡片输入并连接。验证失败保留旧配置；成功后以 0600 权限原子保存。
- Key 更换会更新此设备的官方 OpenViking 连接，卡片要求新开 Codex 任务后再导入，避免当前官方代理仍用旧凭据。新任务应核对官方连接；宿主没有重载时重启 Codex。
- 连接凭据变化会隔离旧的选择、清单、工作台和报告；并发修改时旧卡片不能覆盖更新后的配置。

## 结构与边界

- `src/server.mjs`：标准 MCP Apps 工具和 HTML 资源，stdio 运行；凭据留在 Python 云端客户端中。
- `src/app.mjs`、`src/ui.mjs`：对话卡片、目录与报告。点击选择保存本地状态，发送消息由当前 Agent 接续，不伪造执行完成。
- `plugins/openviking-codex-app/scripts/app_backend.py`：同步范围、清单确认、报告发布；状态按连接身份隔离；只有连接明确确认后才能导入。
- `scripts/history.py`：已授权计划的分批导入、commit、去重和 Working Memory 读取。请求结果未知时不自动重放。
- `scripts/panel.py`：仅本机的日常工作台；不是 onboarding 入口。
- `skills/openviking-codex-app/SKILL.md`：安装、确认、导入、跨会话接续和证据驱动报告。

上述 scripts/skills 短路径均相对 `plugins/openviking-codex-app/`。已保存的 Key 不回显到卡片。新输入通过宿主的 App 工具和子进程 stdin 传给配置器，不放在命令参数或工具返回结果中；宿主可能记录工具输入，不能承诺对宿主日志隐身。Key 不进入导入清单或报告。本地状态位于 `~/.openviking/personal/`，按连接隔离；不扫描宿主私有数据库、不采集 Computer History、不自动创建定时任务。

官方依赖由 `upstream.lock.json` 固定 GitHub commit `eb2acdb8b632c83392a10625f39d444f26c3cd09`，版本 0.9.3；校验安装脚本 SHA256 后以同一 commit 安装。固定服务地址为 `https://api.vikingdb.cn-beijing.volces.com/openviking`，不安装开源服务端。首次完整安装会重新注册固定版本的官方 marketplace；`--companion-only` 不做该步骤。连接身份不同必须明确切换，不能静默覆盖。

## 升级与卡片故障

MCP 服务启动时，把自身 Python 后端和界面资源保存为仅当前运行使用的临时代码副本。升级清除旧插件缓存后，已有任务仍可继续运行其原版本。副本不含 Key、历史或报告，用户数据仍在原配置目录。工具结果的 runtimeVersion 标识实际运行版本。

若旧版本已经在升级中失去运行文件，需要重新打开 Codex 一次。修复后的运行副本用于避免以后重复发生。卡片失败时提供明确恢复动作；没有可见原生输入组件时，直接让用户回复“使用当前连接”或“更换 API Key”，不宣称已显示选项。

## 开发与验证

```bash
npm ci --ignore-scripts
npm run build
npm run test:mcp
python3 -m unittest discover -s tests -v
# 需安装 Playwright 和本机 Chrome
node tests/check_ui.cjs
```

测试包含独立 stdio MCP 客户端、真实 App SDK 在 iframe 中的模拟宿主交互、导入防重和清单失效保护。模拟 UI 与单元测试不代表 Codex 原生宿主验收，也不代表真实云端历史导入已验证。真实 Session 批量接口、commit/task、独立新会话接续仍需实际实例验收；没有上传测试历史来制造成功状态。

## 参考

- 同事 `ov-distributable`：复用标准 MCP Apps 交互形式，以及“概览、报告内容、来源、接续”的组织思路；未启用旧内置采集。
- [OpenViking Web Studio](https://github.com/volcengine/OpenViking/tree/main/web-studio)：参考目录导航与分栏预览，独立实现个人范围浏览，不复制其服务端启动流程。
- [MCP Apps](https://modelcontextprotocol.io/extensions/apps/overview)：标准卡片桥接。
- 第三方依赖许可见分发插件内 `THIRD_PARTY_NOTICES.txt`。本仓库仍为私有协作项目。

## 卡片预览

以下为模拟宿主截图，不是 Codex 原生宿主验收截图。

![连接确认](docs/screenshots/connection-card.png)
![输入 Key](docs/screenshots/api-key-card.png)
![范围选择](docs/screenshots/onboarding-card.png)
![报告](docs/screenshots/reports-card.png)
![目录](docs/screenshots/directory-card.png)
