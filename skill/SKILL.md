---
name: ai-metadata-sync
description: "Maintain and use a local ai-metadata/ code index for large repos: generate/update dependency graph + per-file feature descriptions, and prioritize ai-metadata/index.json + ai-metadata/index.md when locating files to modify. Use when tasks involve finding where to change code, understanding module relationships, or keeping an AI-focused index in sync after edits."
---

# AI Metadata Sync

## Workflow

### 1) Locate files (always index-first)

- Read `ai-metadata/index.md` for the quick overview.
- Use `ai-metadata/index.json` as the primary router for “which files matter”, via `graph.deps` and `graph.reverseDeps`.
- Only open source files after narrowing to a small candidate set from the index.

### 2) Keep metadata in sync (after any code change)

- Recommended one-liner (from repo root): `node "${CODEX_HOME:-$HOME/.codex}/Skills/ai-metadata-sync/scripts/sync-repo.mjs"`.
- Or run separately:
  - Update dependency graph + exports/imports: `pnpm -s meta:update` (or `npm run -s meta:update`).
  - Update per-file feature descriptions: `node "${CODEX_HOME:-$HOME/.codex}/Skills/ai-metadata-sync/scripts/describe-files.mjs"`.
- If the repo has `pnpm -s meta:hooks`, install once with `pnpm -s meta:hooks` so commits keep the index up to date.

### 3) Fill descriptions (only changed files)

- Prefer updating descriptions incrementally: only summarize files whose `sha256` changed in `ai-metadata/index.json`.
- Descriptions should be 1–2 lines, focusing on: “what feature/module does this file implement” + “key dependencies or APIs it touches”.

## Output files

- `ai-metadata/index.json`: machine-readable index (imports/exports, dependency graph, reverse deps, hashes).
- `ai-metadata/index.md`: human-readable overview (dirs, most referenced files).
- `ai-metadata/descriptions.json`: per-file description cache keyed by path + sha256.
- `ai-metadata/descriptions.md`: a compact Markdown view for quick scanning.

## References

- Load `references/index-schema.md` when you need field meanings or suggested queries against `ai-metadata/index.json`.
