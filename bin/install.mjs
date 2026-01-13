#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SKILL_NAME = 'ai-metadata-sync';
const AGENTS_START = '<!-- ai-metadata-sync:start -->';
const AGENTS_END = '<!-- ai-metadata-sync:end -->';

function parseArgs(argv) {
  const args = { force: false, dryRun: false, codexHome: null, generate: false, init: false, agents: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--force') args.force = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--generate') args.generate = true;
    else if (a === '--init') {
      args.init = true;
      args.generate = true;
      args.agents = true;
    }
    else if (a === '--agents') args.agents = true;
    else if (a === '--codex-home') {
      args.codexHome = argv[i + 1] ?? null;
      i += 1;
    } else if (a === '-h' || a === '--help') {
      args.help = true;
    }
  }
  return args;
}

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function defaultCodexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    process.stdout.write(
      [
        'Install the Codex skill: ai-metadata-sync (and optionally generate ai-metadata/)',
        '',
        'Usage:',
        '  codex-skill-ai-metadata-sync [--codex-home <dir>] [--force] [--dry-run] [--generate] [--agents] [--init]',
        '',
        'Defaults:',
        '  --codex-home defaults to $CODEX_HOME or ~/.codex',
        '',
        'Options:',
        '  --generate  Run bundled sync script to generate/update ai-metadata/ in the current directory',
        '  --agents    Create/update AGENTS.md with ai-metadata-sync instructions',
        '  --init      Convenience for --generate --agents (still installs the skill)',
        '',
      ].join('\n') + '\n',
    );
    return;
  }

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const packageRoot = path.resolve(__dirname, '..');
  const sourceDir = path.join(packageRoot, 'skill');

  const codexHome = path.resolve(args.codexHome || defaultCodexHome());
  const destDir = path.join(codexHome, 'Skills', SKILL_NAME);

  if (!(await pathExists(sourceDir))) {
    throw new Error(`Missing skill source directory: ${sourceDir}`);
  }

  const already = await pathExists(destDir);
  if (already && !args.force) {
    const backupDir = `${destDir}.bak-${Date.now()}`;
    if (args.dryRun) {
      process.stdout.write(`[dry-run] Would move existing skill to: ${backupDir}\n`);
    } else {
      await fs.rename(destDir, backupDir);
      process.stdout.write(`Existing skill moved to: ${backupDir}\n`);
    }
  } else if (already && args.force) {
    if (args.dryRun) {
      process.stdout.write(`[dry-run] Would remove existing skill: ${destDir}\n`);
    } else {
      await fs.rm(destDir, { recursive: true, force: true });
    }
  }

  if (!args.dryRun) {
    await fs.mkdir(path.dirname(destDir), { recursive: true });
    await fs.cp(sourceDir, destDir, { recursive: true });
  }

  process.stdout.write(`${args.dryRun ? '[dry-run] Would install skill to' : 'Installed skill to'}: ${destDir}\n`);

  if (args.agents) {
    const agentsPath = path.join(process.cwd(), 'AGENTS.md');
    const body = [
      AGENTS_START,
      '# Agent Instructions (Repo Local)',
      '',
      '本仓库启用 `ai-metadata/` 作为面向 AI 的本地索引。涉及定位/评估影响/修改代码时，先读索引再读源码。',
      '',
      '## Index-first',
      '- 优先读取 `ai-metadata/index.md`（概览）与 `ai-metadata/index.json`（依赖图、反向依赖、语义 tags/routes）。',
      '- 只有在索引把范围收敛到少量候选文件后，才打开源码文件做进一步分析与修改。',
      '',
      '## 变更后同步（必做）',
      '- 任何源码改动后，同步更新索引与描述：',
      `  - \`node "${'${CODEX_HOME:-$HOME/.codex}'}/Skills/${SKILL_NAME}/scripts/sync-repo.mjs"\``,
      '',
      AGENTS_END,
      '',
    ].join('\n');

    let existing = '';
    try {
      existing = await fs.readFile(agentsPath, 'utf8');
    } catch {
      existing = '';
    }

    const hasMarkers = existing.includes(AGENTS_START) && existing.includes(AGENTS_END);
    const nextText = hasMarkers
      ? existing.replace(new RegExp(`${AGENTS_START}[\\s\\S]*?${AGENTS_END}\\n?`, 'm'), body.trimEnd() + '\n')
      : (existing.trimEnd() ? existing.trimEnd() + '\n\n' : '') + body;

    if (args.dryRun) {
      process.stdout.write(`[dry-run] Would write: ${agentsPath}\n`);
    } else {
      await fs.writeFile(agentsPath, nextText, 'utf8');
      process.stdout.write(`Updated: ${agentsPath}\n`);
    }
  }

  if (args.generate) {
    const syncScript = path.join(destDir, 'scripts', 'sync-repo.mjs');
    const cmd = `node ${JSON.stringify(syncScript)}`;
    if (args.dryRun) {
      process.stdout.write(`[dry-run] Would run: ${cmd}\n`);
    } else {
      const { spawnSync } = await import('node:child_process');
      const r = spawnSync('node', [syncScript], { stdio: 'inherit' });
      if (r.status !== 0) process.exit(r.status ?? 1);
    }
  }

  process.stdout.write('Next: restart Codex CLI (or start a new session) and use `$ai-metadata-sync`.\n');
}

await main();
