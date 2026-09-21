# 接入 OpenViking 个人版

请为我的 Codex 接入火山 OpenViking，并带我开始使用。

服务地址：https://api.vikingdb.cn-beijing.volces.com/openviking
API Key：{{OPENVIKING_API_KEY}}
插件仓库：https://github.com/zhangxiaoyan1081/openviking-developer-codex-app

## 执行

1. 下载上述仓库，读取 README 和 upstream.lock.json。安装官方 openviking-memory 与本仓库的 openviking-codex-app；不安装本地 OpenViking 服务，不启用旧互动插件内置的记忆采集。
2. 使用 install.py --configure-stdin，通过标准输入传入 JSON {"api_key":"本指令提供的值"}。不要将 key 放进命令行参数、仓库、日志或归档，不要求我重复填写。本指令中的 key 若仍是占位符才请我补充。
3. 安装器遇到已有不同连接时，先向我说明现有目标与切换影响；确认后再使用 --replace-connection。本指令已提供的 Key 与现有目标相同时，验证后直接继续；如果本指令没有 Key，不要自动复用旧配置，先调用 show_onboarding(step="connection") 展示连接卡片。不要改动无关配置。
4. 核对实际插件、火山鉴权和工具；按宿主要求引导我信任 Hook 或重新打开任务。安装完成、Hook 执行、原生记忆抽取和独立接续分别验证，不以空记忆当成接入失败。
5. 加载 openviking-codex-app skill，调用 show_onboarding，在当前对话展示卡片，不打开浏览器。Key 尚未提供或确认时，先让我选择当前连接或填写 Key。连接验证后检查实际生效的 AGENTS.md 与已有授权：同等规则直接沿用并简短说明；新增或改变的协作方式，先让我确认行为摘要及作用范围，再精确合并、读回。保留其他规则与我已有的文件分类。
6. 让我选择带入近期全部工作、一个或多个项目、描述范围，或从现在开始。不导入时也继续说明实际协作状态、后续使用预期，提供开始工作、保存资料、稍后，不直接结束。
7. 导入分支先准备清单，调用 review_import 展示并让我确认；确认后先调用 show_onboarding 展示整理进度，再核对 hash 后导入未同步的历史与资料，复用已有内容。读回核对，保存任务回执并短暂查询抽取状态；不要一直等待抽取，也不要在“处理中”结束引导。汇集最新可用 Working Memory，尚未生成时使用已核对原文，展示目标、上次进展、有效决定、待办、具体下一步和来源；publish_work(onboarding=true) 直接展示摘要；若通过脚本发布，必须再调用 show_onboarding。
8. 根据摘要让我选择继续、修正、开始新工作或稍后。默认当前任务接续；只有我明确选择新任务才创建，并等待验证结果反馈回来。卡片工具可用时优先调用，不以原生单选或 Markdown 代替可视化展示；卡片确实不可用时通过脚本和对话完成同样的步骤，不提示卡片缺失或交互方式切换，只有实际阻塞且需要我处理时才说明必要动作，不要求我额外输入“继续 onboarding”。日报、周报或知识洞察按需生成；不自动开启 Computer History 或定时同步。

更换 Key 后若卡片要求新开任务，先停止当前任务的旧库读写，给我一句“继续 OpenViking 接入”的指令。需要重启时保留无凭据的本地进度文件，给我一句可以继续的指令。遇到接口、权限或来源缺失，完成可做部分并说明具体缺口。
