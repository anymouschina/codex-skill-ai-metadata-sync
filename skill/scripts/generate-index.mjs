#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

const requireFromCwd = createRequire(path.join(process.cwd(), 'package.json'));
// Load TypeScript from the repo's dependencies (not from the installed skill folder).
const ts = requireFromCwd('typescript');

const SCHEMA_VERSION = 2;
const METADATA_DIR = 'ai-metadata';
const INDEX_JSON_PATH = path.join(METADATA_DIR, 'index.json');
const INDEX_MD_PATH = path.join(METADATA_DIR, 'index.md');

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css'];
const TAG_KEYWORDS = [
  'canvas',
  'artboard',
  'flow',
  'reactflow',
  'xyflow',
  'storyboard',
  'publish',
  'profile',
  'subscription',
  'settings',
  'http',
  'auth',
  'token',
  'kling',
  'yunwu',
  'gemini',
  'grs',
  'qrcode',
  'zip',
  'worker',
];

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists(filePath) {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function gitLsFiles() {
  const stdout = execFileSync('git', ['ls-files'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function readTsconfigPaths(projectRootAbs) {
  const tsconfigPath = path.join(projectRootAbs, 'tsconfig.json');
  try {
    const configText = ts.sys.readFile(tsconfigPath);
    if (!configText) return [];
    const parsed = ts.parseConfigFileTextToJson(tsconfigPath, configText);
    const paths = parsed?.config?.compilerOptions?.paths;
    if (!paths || typeof paths !== 'object') return [];

    return Object.entries(paths)
      .filter(([k, v]) => typeof k === 'string' && Array.isArray(v))
      .map(([pattern, targets]) => ({ pattern, targets }));
  } catch {
    return [];
  }
}

function applySimpleAlias(spec, aliasPaths) {
  for (const { pattern, targets } of aliasPaths) {
    if (!pattern.endsWith('/*')) continue;
    const prefix = pattern.slice(0, -2);
    if (!spec.startsWith(prefix + '/')) continue;

    const rest = spec.slice(prefix.length + 1);
    const firstTarget = targets?.[0];
    if (typeof firstTarget !== 'string') continue;

    if (firstTarget === './*') return rest;
    if (firstTarget.endsWith('/*')) return firstTarget.slice(0, -2) + '/' + rest;
  }
  return null;
}

async function resolveLocalImport(projectRootAbs, importerRel, spec, aliasPaths) {
  let candidateRel = null;

  if (spec.startsWith('./') || spec.startsWith('../')) {
    candidateRel = path.join(path.dirname(importerRel), spec);
  } else if (spec.startsWith('/')) {
    candidateRel = spec.slice(1);
  } else {
    const aliasRel = applySimpleAlias(spec, aliasPaths);
    if (aliasRel) candidateRel = aliasRel;
  }

  if (!candidateRel) return null;

  const candidateAbsNoExt = path.resolve(projectRootAbs, candidateRel);
  const hasExt = Boolean(path.extname(candidateAbsNoExt));

  const tryPaths = [];
  if (hasExt) {
    tryPaths.push(candidateAbsNoExt);
  } else {
    for (const ext of RESOLVE_EXTENSIONS) tryPaths.push(candidateAbsNoExt + ext);
    for (const ext of RESOLVE_EXTENSIONS) tryPaths.push(path.join(candidateAbsNoExt, 'index' + ext));
  }

  for (const absPath of tryPaths) {
    if (await pathExists(absPath)) {
      const relPath = path.relative(projectRootAbs, absPath);
      return toPosixPath(relPath);
    }
  }

  return null;
}

function externalPackageName(spec) {
  if (spec.startsWith('@')) {
    const parts = spec.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : spec;
  }
  return spec.split('/')[0] ?? spec;
}

function parseTsFile(text, fileName) {
  const kind = fileName.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : fileName.endsWith('.jsx')
      ? ts.ScriptKind.JSX
      : fileName.endsWith('.js') || fileName.endsWith('.mjs') || fileName.endsWith('.cjs')
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;

  const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
  const imports = new Set();
  const dynamicImports = new Set();
  const exportsNamed = new Set();
  let exportsDefault = false;

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
      imports.add(statement.moduleSpecifier.text);
    }

    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
      imports.add(statement.moduleSpecifier.text);
    }

    if (ts.isExportAssignment(statement)) {
      exportsDefault = true;
    }

    const mods = statement.modifiers;
    const isExported = Array.isArray(mods) && mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (isExported) {
      if (ts.isFunctionDeclaration(statement) && statement.name) exportsNamed.add(statement.name.text);
      if (ts.isClassDeclaration(statement) && statement.name) exportsNamed.add(statement.name.text);
      if (ts.isInterfaceDeclaration(statement) && statement.name) exportsNamed.add(statement.name.text);
      if (ts.isTypeAliasDeclaration(statement) && statement.name) exportsNamed.add(statement.name.text);
      if (ts.isEnumDeclaration(statement) && statement.name) exportsNamed.add(statement.name.text);
      if (ts.isVariableStatement(statement)) {
        for (const decl of statement.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) exportsNamed.add(decl.name.text);
        }
      }
    }
  }

  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length >= 1) {
        const arg0 = node.arguments[0];
        if (ts.isStringLiteral(arg0)) dynamicImports.add(arg0.text);
      }
      if (ts.isIdentifier(node.expression) && node.expression.text === 'require' && node.arguments.length >= 1) {
        const arg0 = node.arguments[0];
        if (ts.isStringLiteral(arg0)) dynamicImports.add(arg0.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return {
    importSpecifiers: Array.from(imports).sort(),
    dynamicImportSpecifiers: Array.from(dynamicImports).sort(),
    exports: {
      named: Array.from(exportsNamed).sort(),
      default: exportsDefault,
    },
  };
}

function featureFromPath(filePath) {
  const p = filePath.replaceAll('\\', '/');
  if (p.startsWith('pages/')) return 'route/page';
  if (p.startsWith('components/')) return 'ui/component';
  if (p.startsWith('utils/')) return 'utility';
  if (p.startsWith('worker/')) return 'worker/backend';
  if (p === 'App.tsx' || p === 'AppShell.tsx' || p === 'index.tsx') return 'app/entry';
  return 'module';
}

function inferRoutesFromPath(filePath) {
  const p = filePath.replaceAll('\\', '/');
  if (!p.startsWith('pages/')) return [];
  const base = path.basename(p).replace(/\.(tsx|ts|jsx|js|mjs|cjs)$/, '');
  if (base === 'index') return ['/'];
  return [`/${base}`];
}

function extractSemanticFromText(text, filePath, { externalDeps = [] } = {}) {
  const tags = new Set();
  const routes = inferRoutesFromPath(filePath);
  for (const r of routes) tags.add('route');

  const lowerPath = filePath.toLowerCase();
  for (const kw of TAG_KEYWORDS) {
    if (lowerPath.includes(kw)) tags.add(kw);
  }

  const lowerText = text.toLowerCase();
  for (const kw of TAG_KEYWORDS) {
    if (lowerText.includes(kw)) tags.add(kw);
  }

  for (const dep of externalDeps) {
    const d = String(dep).toLowerCase();
    if (d.includes('reactflow') || d.includes('xyflow')) tags.add('flow');
    if (d.includes('qrcode')) tags.add('qrcode');
    if (d.includes('jszip')) tags.add('zip');
  }

  const apiEndpoints = new Set();
  const apiRe = /(['"`])((?:https?:\/\/)[^'"`\s]+|\/api\/[a-zA-Z0-9._~!$&'()*+,;=:@\/-]+)\1/g;
  for (const m of text.matchAll(apiRe)) {
    const v = m[2];
    if (!v) continue;
    if (v.startsWith('http://') || v.startsWith('https://') || v.startsWith('/api/')) apiEndpoints.add(v);
    if (apiEndpoints.size >= 25) break;
  }

  const storageKeys = new Set();
  const storageRe = /localStorage\.(?:getItem|setItem|removeItem)\(\s*(['"`])([^'"`]+)\1/g;
  for (const m of text.matchAll(storageRe)) {
    const k = m[2];
    if (!k) continue;
    storageKeys.add(k);
    if (storageKeys.size >= 25) break;
  }

  const envVars = new Set();
  const envRe = /\b(?:process\.env|import\.meta\.env)\.([A-Z0-9_]+)/g;
  for (const m of text.matchAll(envRe)) {
    const k = m[1];
    if (!k) continue;
    envVars.add(k);
    if (envVars.size >= 40) break;
  }

  return {
    feature: featureFromPath(filePath),
    routes,
    tags: Array.from(tags).sort(),
    apiEndpoints: Array.from(apiEndpoints).sort(),
    storageKeys: Array.from(storageKeys).sort(),
    envVars: Array.from(envVars).sort(),
  };
}

export async function generateIndex() {
  const projectRootAbs = process.cwd();
  const aliasPaths = readTsconfigPaths(projectRootAbs);

  const previousIndex = await readJsonIfExists(INDEX_JSON_PATH);
  const previousFiles = previousIndex?.files && typeof previousIndex.files === 'object' ? previousIndex.files : {};

  const tracked = gitLsFiles();
  const sourceFiles = tracked.filter((p) => SOURCE_EXTENSIONS.has(path.extname(p)));

  const nextFiles = {};

  for (const relPath of sourceFiles) {
    const absPath = path.join(projectRootAbs, relPath);
    const text = await fs.readFile(absPath, 'utf8');
    const digest = sha256(text);

    const prev = previousFiles?.[relPath];
    const canReuse =
      prev?.sha256 === digest &&
      previousIndex?.schemaVersion === SCHEMA_VERSION &&
      prev?.semantic &&
      typeof prev.semantic === 'object';
    if (canReuse) {
      nextFiles[relPath] = prev;
      continue;
    }

    const parsed = parseTsFile(text, relPath);
    const rawSpecs = [...parsed.importSpecifiers, ...parsed.dynamicImportSpecifiers];
    const external = [];
    for (const spec of rawSpecs) {
      if (spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('/') || applySimpleAlias(spec, aliasPaths)) continue;
      external.push(externalPackageName(spec));
    }
    const externalDeps = Array.from(new Set(external)).sort();

    nextFiles[relPath] = {
      path: relPath,
      kind: path.extname(relPath).slice(1),
      bytes: Buffer.byteLength(text, 'utf8'),
      sha256: digest,
      ...parsed,
      semantic: extractSemanticFromText(text, relPath, { externalDeps }),
    };
  }

  const deps = {};
  const reverseDeps = {};

  const allPaths = Object.keys(nextFiles);
  for (const p of allPaths) reverseDeps[p] = [];

  for (const relPath of allPaths) {
    const file = nextFiles[relPath];
    const raw = [...(file.importSpecifiers ?? []), ...(file.dynamicImportSpecifiers ?? [])];

    const resolvedLocal = [];
    const unresolvedLocal = [];
    const external = [];

    for (const spec of raw) {
      const resolved = await resolveLocalImport(projectRootAbs, relPath, spec, aliasPaths);
      if (resolved) {
        resolvedLocal.push(resolved);
        continue;
      }

      if (spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('/') || applySimpleAlias(spec, aliasPaths)) {
        unresolvedLocal.push(spec);
        continue;
      }

      external.push(externalPackageName(spec));
    }

    resolvedLocal.sort();
    unresolvedLocal.sort();
    external.sort();

    deps[relPath] = {
      local: resolvedLocal,
      localUnresolved: unresolvedLocal,
      external,
    };

    for (const to of resolvedLocal) {
      if (!reverseDeps[to]) reverseDeps[to] = [];
      reverseDeps[to].push(relPath);
    }
  }

  for (const p of Object.keys(reverseDeps)) reverseDeps[p].sort();

  const generatedAt = new Date().toISOString();
  const index = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    project: {
      root: '.',
      name: path.basename(projectRootAbs),
      language: 'typescript',
      aliasPaths,
    },
    counts: {
      trackedFiles: tracked.length,
      sourceFiles: sourceFiles.length,
    },
    files: nextFiles,
    graph: { deps, reverseDeps },
  };

  await fs.mkdir(METADATA_DIR, { recursive: true });
  await fs.writeFile(INDEX_JSON_PATH, JSON.stringify(index, null, 2) + '\n', 'utf8');

  const dirCounts = new Map();
  for (const p of allPaths) {
    const dir = toPosixPath(path.dirname(p));
    dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
  }

  const topReferenced = allPaths
    .map((p) => ({ p, n: (reverseDeps[p] ?? []).length }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 25);

  const tagCounts = new Map();
  for (const p of allPaths) {
    const tags = nextFiles[p]?.semantic?.tags ?? [];
    for (const t of tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  }
  const topTags = Array.from(tagCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  const lines = [];
  lines.push('# AI Metadata Index');
  lines.push('');
  lines.push(`- Generated: ${generatedAt}`);
  lines.push(`- Source files indexed: ${sourceFiles.length}`);
  lines.push(`- Schema version: ${SCHEMA_VERSION}`);
  lines.push('');
  lines.push('## Top tags');
  if (topTags.length === 0) {
    lines.push('- (none)');
  } else {
    for (const [tag, n] of topTags) lines.push(`- \`${tag}\`: ${n}`);
  }
  lines.push('');
  lines.push('## Alias paths');
  if (aliasPaths.length === 0) {
    lines.push('- (none detected)');
  } else {
    for (const a of aliasPaths) {
      lines.push(`- \`${a.pattern}\` → \`${(a.targets ?? []).join(', ')}\``);
    }
  }
  lines.push('');
  lines.push('## Directory overview');
  const dirRows = Array.from(dirCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30);
  for (const [dir, n] of dirRows) {
    lines.push(`- \`${dir}\`: ${n}`);
  }
  lines.push('');
  lines.push('## Most referenced files');
  for (const { p, n } of topReferenced) {
    lines.push(`- \`${p}\` (referenced by ${n})`);
  }
  lines.push('');
  lines.push('## How to use');
  lines.push('- Open `ai-metadata/index.md` for a human-readable overview.');
  lines.push('- Use `ai-metadata/index.json` for dependency graph + semantic tags/routes.');
  lines.push('');

  await fs.writeFile(INDEX_MD_PATH, lines.join('\n') + '\n', 'utf8');
  process.stdout.write(`ai-metadata updated: ${INDEX_JSON_PATH}, ${INDEX_MD_PATH}\n`);
  return index;
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await generateIndex();
}
