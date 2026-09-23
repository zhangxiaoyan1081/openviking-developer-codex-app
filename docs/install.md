# 复制到 Codex 开始安装

日期：2026-09-21
状态：当前本机版安装指引；不是远程 MCP 部署指令。

将下面整段复制给 Codex 桌面版或 CLI：

```text
请从 https://github.com/zhangxiaoyan1081/openviking-developer-codex-app 安装 OpenViking Codex App。
下载仓库，读取 README.md、docs/console-connect.md 和 upstream.lock.json。先检查 Python 3.10+、Node.js 22+、Git 和 Codex CLI，然后运行 python3 install.py --companion-only。
我还没有在这条指令中提供 API Key：不要自动沿用旧连接，也不要导入历史。安装完成后，引导我在新任务发送“使用 openviking-codex-app 接入 OpenViking”，再通过连接卡片选择已有连接或输入 Key。
后续按技能完成官方记忆插件安装与验证（已安装则复用）、选择自动记忆或按需使用、引导在 /hooks 启用并信任或关闭官方 Hooks 并核查、确认协作方式、选择是否带入历史。不安装本地 OpenViking 服务，不采集 Computer History。选择回顾工作时只总结进度和建议方向，等我下一条指令再执行。
```

如果你习惯自己执行命令：

```bash
git clone https://github.com/zhangxiaoyan1081/openviking-developer-codex-app.git
cd openviking-developer-codex-app
python3 install.py --companion-only
```

然后新开 Codex 任务，发送：

```text
使用 openviking-codex-app 接入 OpenViking。
```

交互插件安装不等于官方记忆插件和 Hook 已启用，后续接入流程会分别核查。CLI 没有可视化卡片时使用文字引导。当前已验证 macOS 安装；尚未完成其他操作系统的真实安装验收。

控制台如果已为用户提供 API Key，应生成 [完整接入指令](console-connect.md)，让安装器通过 stdin 直接配置，无需重复输入。不要把任何真实 Key 写进公开仓库或通用分发指令。

更新 App 不会重装已存在的官方插件。`--official-only` 只在官方插件缺失时安装，已有安装仍复用；官方升级请单独执行，升级后重新核对 Node 启动路径与 Hook 信任。
