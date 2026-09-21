# 私有导入计划

由当前 Agent 从获授权来源准备，不提交 Git。时间需要时区；message source ID 唯一；项目名称仅展示，peer_id 来自核实的既有映射。

```json
{"sessions":[{"source_id":"原始任务标识","title":"项目讨论","project":"项目名称","ended":true,"capture_checked":true,"peer_id":"已核实的Peer","messages":[{"role":"user","content":"真实用户内容","created_at":"2026-09-20T09:00:00+08:00","source_message_id":"原始消息标识"}]}]}
```

已在 OV 中的会话：填 source_id、title、project、existing_session_id 即可，无需重传 messages。capture_checked 是 Agent 完成核对的记录，不是替代服务端幂等的开关。

apply 返回 submitted 后再 status 查 task。抽取完成、文件保存、读回与可检索分别验证。失败或响应丢失标 unknown；应核对已写消息范围后处理，不能通过删进度文件重试。当前脚本不自动解决未知写入，也不与活跃会话争抢写入权。
