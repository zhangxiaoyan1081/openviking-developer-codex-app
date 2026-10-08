# 仓库更新与发布

用户要求：每次更新同步 GitHub，并创建新的 Release。

- 一次完成并准备交付的更新使用一个新版本；开发过程中的中间修改不单独发布。
- 发布前同步 `package.json`、`package-lock.json`（顶层与根包）和 `plugins/openviking-codex-app/.codex-plugin/plugin.json` 的版本。
- 新增 `docs/releases/v<版本>.md`，说明最终功能/修复、升级方式、验收及实际限制；不包含本机凭据、私人用户标识或测试对话。
- 完成相应测试和构建，将源码、测试、必要文档与打包资源一并提交。禁止提交用户配置、凭据、会话或本地运行时。
- 推送 `main` 后，GitHub Actions 在验收通过后创建 `v<版本>` 标签与 Release，附分发 ZIP 和 SHA-256。等待并验证 Release 及附件实际可下载，不能把推送成功视为发布成功。
- 不覆盖已发布标签、版本或附件；后续更新提升版本号。发布失败时报告实际失败环节，不能声称已发布。
