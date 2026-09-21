# 流程与对话降级执行契约

所有脚本位于已核实的活动插件 scripts 目录。凭据不进入任何命令参数；stdin JSON 文件只保存本次必要数据。下列 action 均通过 stdin JSON 调用，先以 get_state 或 app_backend.py state 检查实际状态。

| 行为 | 卡片/MCP | 脚本入口与 JSON |
|---|---|---|
| 读取状态 | get_state | app_backend.py state，`{}` |
| 准备协作方案 | prepare_collaboration | onboarding.py prepare_rules，`{path,mode,scope,summary,block?,evidence?,check_files?}` |
| 用户采用/调整 | choose_collaboration | onboarding.py choose_rules，`{revision,choice:"adopt"或"adjust"}`，仅用户明确选择后 |
| 落盘规则 | Agent 执行脚本 | onboarding.py apply_rules，`{revision}`，仅 accepted 后；active 可重入 |
| 记录已核查能力 | Agent 执行脚本 | onboarding.py capabilities，`{memoryTools,hooks,appTools,messageBridge}`，各值 verified/unverified/unavailable |
| 保存历史范围 | select_scope | app_backend.py scope，`{mode,days?,text?}` |
| 清单预览 | review_import | app_backend.py review，`{path,coverage}` |
| 确认清单 | confirm_import | app_backend.py confirm，`{hash}`，仅用户明确确认后 |
| 导入/核对/抽取 | history.py | apply 文件 --confirm hash；verify 文件；status 文件 --wait 10；collect 文件 |
| 查询进度 | import_status | history.py status 文件，或 app_backend.py import_status，`{jobId}` |
| 发布接续摘要 | publish_work | workspace.py stdin `{onboarding:true,scopeRevision:<准备摘要前读取的范围版本>,works:[...]}` |
| 展示下一步 | show_onboarding | app_backend.py state，按实际内容在对话中展示摘要/效果预期 |
| 用户下一步 | choose_next | onboarding.py choose_next，`{choice:"start"/"save"/"later"/"continue"/"correct"}` |

prepare_rules 的 mode=reuse 必须基于实际已读规则和已有同等授权；不会写 AGENTS.md。mode=merge 只准备管理块，文件并发变化会拒绝 apply。用户可选当前项目 scope=project，但 Agent 要使用对应项目真实规则路径并核对覆盖文件；scope=global 同理。不要根据文件存在自动猜测授权。

文字模式执行示例结构：`python3 <实际脚本路径> <action> < <本次私有JSON文件>`。先生成 JSON 文件，不在 shell 拼接用户内容。用户规则已有同等授权无需重复确认；新规则的具体内容和影响必须已展示。不得靠手改状态文件绕过校验。

导入 job 存在按连接隔离的私有目录，包括冻结计划与逐项回执。查询状态不上传消息；查询异常为 unknown，不盲目重试 apply。status 每次最多查询三个任务，终态缓存、结果落盘。--wait 是有界等待；卡片有界退避刷新，关闭或进程退出后不承诺持续通知。不要用后台定时任务弥补未验证的宿主能力。

无卡片时直接使用原生选项或文本完成相同阶段，不说明卡片缺失或交互方式切换。没有可用输入组件时，给出能直接回复的选项；不要声称显示了不存在的按钮。网络/权限/宿主故障需要用户动作时才解释必要事实。不为了输出一个卡片反复重启、重装或打开浏览器。

独立接续：仅用户选择新任务时 create_thread，随后 wait_threads；结果只读核对后反馈到原任务。若子任务工具缺失，记录未验证及恢复动作；可继续当前任务的实际工作，不把本地摘要当成已经从云端取回的证明。
