# codex-skill-ai-metadata-sync

Codex CLI 的一个 Skill：用于在大仓库中维护并同步本地 `ai-metadata/` 代码索引（生成/更新依赖关系、按文件的能力描述、以及 `ai-metadata/index.json` / `ai-metadata/index.md`）。

## 安装

在 Codex CLI 里安装（仓库自带安装脚本）：

```bash
node ./bin/install.mjs
```

或将 `skill/` 目录按你的 Codex 配置放入对应 skills 目录。

## 使用

在 Codex 对话中提到 `ai-metadata-sync` skill，按提示运行 `skill/scripts/sync-repo.mjs` 等脚本完成索引生成与同步。

## 后续

这个仓库后续可能会加入其他 Skill；届时会在 `skill/` 下按目录拆分，并在这里补充对应说明。

