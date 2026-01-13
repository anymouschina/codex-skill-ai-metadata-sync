#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const INDEX_JSON = path.join('ai-metadata', 'index.json');
const DESC_JSON = path.join('ai-metadata', 'descriptions.json');
const DESC_MD = path.join('ai-metadata', 'descriptions.md');
const DESC_SCHEMA_VERSION = 2;

async function readJson(filePath) {
  const text = await fs.readFile(filePath, 'utf8');
  return JSON.parse(text);
}

async function readJsonIfExists(filePath) {
  try {
    return await readJson(filePath);
  } catch {
    return null;
  }
}

function truncate(list, n) {
  return Array.isArray(list) ? list.slice(0, n) : [];
}

function featureFromPath(filePath) {
  const p = filePath.replaceAll('\\', '/');
  if (p.startsWith('pages/')) return 'route/page';
  if (p.startsWith('components/')) return 'ui/component';
  if (p.startsWith('utils/')) return 'utility';
  if (p.startsWith('worker/')) return 'worker/backend';
  if (p === 'App.tsx' || p === 'AppShell.tsx') return 'app/shell';
  return 'module';
}

function defaultDescription({ filePath, file, deps }) {
  const feature = featureFromPath(filePath);
  const baseName = path.basename(filePath).replace(/\.(tsx|ts|jsx|js|mjs|cjs)$/, '');

  const routes = Array.isArray(file?.semantic?.routes) ? file.semantic.routes : [];
  const tags = Array.isArray(file?.semantic?.tags) ? file.semantic.tags : [];
  const apiEndpoints = Array.isArray(file?.semantic?.apiEndpoints) ? file.semantic.apiEndpoints : [];
  const storageKeys = Array.isArray(file?.semantic?.storageKeys) ? file.semantic.storageKeys : [];
  const envVars = Array.isArray(file?.semantic?.envVars) ? file.semantic.envVars : [];

  const named = truncate(file?.exports?.named, 6);
  const hasDefault = Boolean(file?.exports?.default);
  const external = Array.from(new Set(truncate(deps?.external, 6)));
  const local = truncate(deps?.local, 4);

  const exportHint =
    named.length || hasDefault
      ? `Exports: ${[hasDefault ? 'default' : null, ...named].filter(Boolean).join(', ')}.`
      : 'Exports: (none detected).';

  const depHintParts = [];
  if (external.length) depHintParts.push(`Ext deps: ${external.join(', ')}`);
  if (local.length) depHintParts.push(`Local deps: ${local.join(', ')}`);

  const depHint = depHintParts.length ? depHintParts.join(' | ') : 'Deps: (none detected).';

  const semanticParts = [];
  if (routes.length) semanticParts.push(`Routes: ${truncate(routes, 3).join(', ')}`);
  if (tags.length) semanticParts.push(`Tags: ${truncate(tags, 8).join(', ')}`);
  if (apiEndpoints.length) semanticParts.push(`API: ${truncate(apiEndpoints, 2).join(', ')}`);
  if (storageKeys.length) semanticParts.push(`Storage: ${truncate(storageKeys, 2).join(', ')}`);
  if (envVars.length) semanticParts.push(`Env: ${truncate(envVars, 4).join(', ')}`);
  const semanticHint = semanticParts.length ? semanticParts.join(' | ') : null;

  if (feature === 'route/page') {
    const route = baseName === 'index' ? '/' : `/${baseName}`;
    return `Page for route \`${route}\` (${feature}). ${exportHint} ${depHint}${semanticHint ? ` ${semanticHint}` : ''}`;
  }

  if (feature === 'ui/component') {
    return `UI component \`${baseName}\` (${feature}). ${exportHint} ${depHint}${semanticHint ? ` ${semanticHint}` : ''}`;
  }

  if (feature === 'utility') {
    return `Utility module \`${baseName}\` (${feature}). ${exportHint} ${depHint}${semanticHint ? ` ${semanticHint}` : ''}`;
  }

  if (feature === 'worker/backend') {
    return `Worker module \`${baseName}\` (${feature}). ${exportHint} ${depHint}${semanticHint ? ` ${semanticHint}` : ''}`;
  }

  if (feature === 'app/shell') {
    return `App entry/shell \`${baseName}\` (${feature}). ${exportHint} ${depHint}${semanticHint ? ` ${semanticHint}` : ''}`;
  }

  return `Module \`${baseName}\` (${feature}). ${exportHint} ${depHint}${semanticHint ? ` ${semanticHint}` : ''}`;
}

async function main() {
  const index = await readJson(INDEX_JSON);
  const prev = (await readJsonIfExists(DESC_JSON)) ?? { schemaVersion: DESC_SCHEMA_VERSION, files: {} };

  const files = index?.files ?? {};
  const deps = index?.graph?.deps ?? {};

  const next = { schemaVersion: DESC_SCHEMA_VERSION, generatedAt: new Date().toISOString(), files: {} };

  let updated = 0;
  let carried = 0;

  for (const [filePath, file] of Object.entries(files)) {
    const sha256 = file?.sha256 ?? null;
    const previous = prev.files?.[filePath];

    const canCarry =
      prev.schemaVersion === DESC_SCHEMA_VERSION &&
      previous?.sha256 &&
      sha256 &&
      previous.sha256 === sha256 &&
      typeof previous.description === 'string';
    if (canCarry) {
      next.files[filePath] = { ...previous, carriedFrom: prev.generatedAt ?? null };
      carried += 1;
      continue;
    }

    const description = defaultDescription({ filePath, file, deps: deps[filePath] });
    const feature = featureFromPath(filePath);

    next.files[filePath] = {
      path: filePath,
      sha256,
      feature,
      description,
      needsReview: true,
    };
    updated += 1;
  }

  await fs.writeFile(DESC_JSON, JSON.stringify(next, null, 2) + '\n', 'utf8');

  const rows = Object.values(next.files)
    .map((f) => ({ path: f.path, feature: f.feature, description: f.description, needsReview: f.needsReview }))
    .sort((a, b) => a.path.localeCompare(b.path));

  const lines = [];
  lines.push('# AI File Descriptions');
  lines.push('');
  lines.push(`- Generated: ${next.generatedAt}`);
  lines.push(`- Files: ${rows.length}`);
  lines.push(`- Updated (new/changed): ${updated}`);
  lines.push(`- Carried (unchanged): ${carried}`);
  lines.push('');
  lines.push('| file | feature | needsReview | description |');
  lines.push('|---|---:|---:|---|');
  for (const r of rows) {
    const desc = String(r.description ?? '').replaceAll('\n', ' ');
    lines.push(`| \`${r.path}\` | \`${r.feature}\` | ${r.needsReview ? '✅' : ''} | ${desc} |`);
  }
  lines.push('');

  await fs.writeFile(DESC_MD, lines.join('\n') + '\n', 'utf8');

  process.stdout.write(`Updated: ${DESC_JSON}, ${DESC_MD}\n`);
  process.stdout.write(`Files: ${rows.length}, updated: ${updated}, carried: ${carried}\n`);
}

await main();
