# OpenViking Codex App 团队试用

日期：2026-09-21
状态：团队试用说明；已验证 macOS 本地安装，尚未完成其他操作系统的真实安装验收。

## 获取插件

直接把 [安装指令](install.md) 复制给 Codex。仓库已公开，无需 GitHub 账号或仓库授权。每位成员使用自己的火山 OpenViking API Key。

也可以在终端执行：

```bash
git clone https://github.com/zhangxiaoyan1081/openviking-developer-codex-app.git
cd openviking-developer-codex-app
```

无法直接访问 GitHub 的成员可以从维护者取得 `openviking-codex-app-team.zip`，解压后打开目录。安装包不包含 API Key、个人历史或本机连接配置。

## 开始使用

需要 Codex 桌面版、可用的 Codex CLI、Python 3.10+、Node.js 22+ 和 Git。已附打包资源，无需执行 npm install。

把以下内容发给在仓库或解压目录中打开的 Codex：

> 请安装当前目录的 OpenViking Codex App。先读取 README.md 和 docs/console-connect.md，执行 python3 install.py --companion-only。安装完成后告诉我如何在新任务接入；不要自动沿用旧连接，也不要上传历史。

安装后，在新任务中发送：

> 使用 openviking-codex-app 接入 OpenViking。

按引导选择连接或填写自己的 API Key，确认协作方式，再决定是否带入历史。官方 openviking-memory 插件按接入流程安装和验证；只装交互插件不代表自动记忆已经启用。

已有连接时也会让你选择沿用或更换；无需把 Key 发给插件维护者。不导入历史也可以开始使用。

## 日常使用

- “打开我的 OpenViking 工作台。”
- “回顾上次的工作，建议几个推进方向，先不要执行。”
- “根据最近 7 天的工作生成周报，列出来源。”
- “在右侧打开 OpenViking 工作台。”

想保留一个常用入口，可以将工作台所在的任务命名为“OpenViking 工作台”并固定到左侧 Pinned。固定的是任务；工作台在任务内打开。

## 更新

从维护者取得新版 ZIP，或在仓库目录中执行 `git pull --ff-only`，然后执行：

```bash
python3 install.py --companion-only
```

在新任务中使用新版。此操作不修改 API Key、AGENTS.md 和已保存的工作数据，也不重新安装官方记忆插件。
