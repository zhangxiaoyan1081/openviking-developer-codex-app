# 接入 OpenViking 个人版

请为我的 Codex 接入火山 OpenViking，并带我开始使用。

服务地址：https://api.vikingdb.cn-beijing.volces.com/openviking
API Key：{{OPENVIKING_API_KEY}}
插件仓库：https://github.com/zhangxiaoyan1081/openviking-developer-codex-app

## 执行

1. 下载上述仓库，读取 README 和 upstream.lock.json。安装官方 openviking-memory 与本仓库的 ov-personal；不安装本地 OpenViking 服务，不启用旧互动插件内置的记忆采集。
2. 使用 install.py --configure-stdin，通过标准输入传入 JSON {"api_key":"本指令提供的值"}。不要将 key 放进命令行参数、仓库、日志或归档，不要求我重复填写。本指令中的 key 若仍是占位符才请我补充。
3. 安装器遇到已有不同连接时，先向我说明现有目标与切换影响；确认后再使用 --replace-connection。已有可用同目标连接直接复用。不要改动无关配置。
4. 核对实际插件、火山鉴权和工具；按宿主要求引导我信任 Hook 或重新打开任务。安装完成、Hook 执行、原生记忆抽取和独立接续分别验证，不以空记忆当成接入失败。
5. 加载 ov-personal skill，调用 show_onboarding，在当前对话展示卡片，不打开浏览器。让我点击选择要带入的范围：近期全部工作、选择项目、描述范围，或从现在开始。支持多项目，不预先限制在当前项目。
6. 沿我选择的范围准备清单，调用 review_import 展示并让我点击确认；核对确认 hash 后导入未同步的历史与资料，复用已有内容。汇集相关 Session 最新可用 Working Memory，说明已完成、有效决定和下一步，并调用 show_workspace 展示工作进展。
7. 让我选择现在想继续的工作。遵循我已有的长期规则与文件分类；我提出需要时再生成日报、周报或知识洞察，归档并展示来源；不自动开启 Computer History 或定时同步。

需要重启时保留无凭据的本地进度文件，给我一句可以继续的指令。遇到接口、权限或来源缺失，完成可做部分并说明具体缺口。
