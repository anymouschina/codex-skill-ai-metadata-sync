# `ai-metadata/index.json` schema (quick reference)

This reference describes the fields used by the local AI index created by `pnpm meta:update`.

## Top-level

- `schemaVersion`: index schema version
- `generatedAt`: ISO timestamp
- `counts.trackedFiles`: number of `git ls-files`
- `counts.sourceFiles`: number of indexed source files
- `files`: map `{ [path]: FileEntry }`
- `graph.deps`: map `{ [fromPath]: { local, localUnresolved, external } }`
- `graph.reverseDeps`: map `{ [toPath]: string[] }` (who imports this file)

## `FileEntry`

- `path`: repo-relative path
- `kind`: `ts`/`tsx`/`js`/`jsx`/`mjs`/`cjs`
- `bytes`: UTF-8 bytes
- `sha256`: content hash (used for incremental updates)
- `importSpecifiers`: static imports/re-exports (raw specifiers)
- `dynamicImportSpecifiers`: `import("...")` / `require("...")` specifiers
- `exports.named`: exported identifiers (best-effort AST scan)
- `exports.default`: whether a default export is present

## Suggested “index-first” queries

- “What files should I open to change X?”:
  1) Find candidate entry points by directory (`pages/`, `components/`, `utils/`)
  2) Use `graph.reverseDeps[target]` to see callers, then expand outward 1–2 steps.

- “What will be impacted if I change file Y?”:
  - Look at `graph.reverseDeps["Y"]` (direct)
  - Then check each caller’s reverse deps (second-order)

