// jd git — сводка по всем репозиториям и отчёт «что я делал».

import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs, flagBool, flagNum, flagStr } from '../core/args.ts';
import { fail, info } from '../core/help.ts';
import { run } from '../core/shell.ts';
import { C, bold, fg, paint } from '../core/theme.ts';
import { table, truncate } from '../core/ui.ts';
import { timeAgo } from '../core/util.ts';
import type { Command } from '../core/registry.ts';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'vendor', '.cache', '.next', 'coverage']);

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function findRepos(root: string, maxDepth = 3): Promise<string[]> {
  const found: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (await exists(path.join(dir, '.git'))) {
      found.push(dir);
      return;
    }
    if (depth >= maxDepth) return;
    let entries: Awaited<ReturnType<typeof readdir>>;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      await walk(path.join(dir, entry.name), depth + 1);
    }
  }

  await walk(root, 0);
  return found;
}

interface RepoInfo {
  dir: string;
  name: string;
  branch: string;
  dirty: number;
  untracked: number;
  ahead: number | null;
  behind: number | null;
  lastSubject: string;
  lastWhen: string;
  empty: boolean;
}

async function repoInfo(dir: string): Promise<RepoInfo> {
  const name = path.basename(dir);
  const [branch, status, log, upstream] = await Promise.all([
    run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir, timeout: 10000 }),
    run('git', ['status', '--porcelain'], { cwd: dir, timeout: 15000 }),
    run('git', ['log', '-1', '--pretty=%s%n%cI'], { cwd: dir, timeout: 10000 }),
    run('git', ['rev-list', '--left-right', '--count', '@{upstream}...HEAD'], { cwd: dir, timeout: 10000 }),
  ]);

  const statusLines = status.ok ? status.stdout.split(/\r?\n/).filter((l) => l.trim()) : [];
  const untracked = statusLines.filter((l) => l.startsWith('??')).length;
  const logLines = log.ok ? log.stdout.trim().split(/\r?\n/) : [];

  let ahead: number | null = null;
  let behind: number | null = null;
  if (upstream.ok && upstream.stdout.trim()) {
    const [b, a] = upstream.stdout.trim().split(/\s+/).map(Number);
    behind = Number.isFinite(b) ? b : null;
    ahead = Number.isFinite(a) ? a : null;
  }

  return {
    dir,
    name,
    branch: branch.ok ? branch.stdout.trim() : '(нет ветки)',
    dirty: statusLines.length - untracked,
    untracked,
    ahead,
    behind,
    lastSubject: logLines[0] ?? '',
    lastWhen: logLines[1] ?? '',
    empty: !log.ok,
  };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      out[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return out;
}

function statusCell(info: RepoInfo): string {
  if (info.empty) {
    return info.untracked
      ? paint('нет коммитов', fg(C.faint)) + paint(' · ', fg(C.faint)) + paint(`${info.untracked} новых`, fg(C.info))
      : paint('пустой репозиторий', fg(C.faint));
  }
  if (info.dirty === 0 && info.untracked === 0) return paint('чисто', fg(C.ok));
  const parts: string[] = [];
  if (info.dirty) parts.push(paint(`${info.dirty} изм.`, fg(C.warn)));
  if (info.untracked) parts.push(paint(`${info.untracked} новых`, fg(C.info)));
  return parts.join(paint(' · ', fg(C.faint)));
}

export default {
  name: 'git',
  aliases: ['repos'],
  group: 'Разработка',
  title: 'Репозитории',
  desc: 'Сводка по всем репам и отчёт о коммитах',
  usage: 'jd git [status|log] [путь] [--days=7] [--depth=3] [--json]',
  examples: ['jd git', 'jd git C:\\projects', 'jd git log --days=7', 'jd git status --depth=2', 'jd git --json'],

  async run({ argv, cwd }) {
    const args = parseArgs(
      argv,
      { days: 'number', depth: 'number', root: 'string', all: 'boolean', json: 'boolean' },
    );
    const sub = ['log', 'status', 'report'].includes(args._[0] ?? '') ? args._[0] : 'status';
    const pathArg = args._[0] === sub ? args._[1] : args._[0];
    const root = path.resolve(flagStr(args, 'root', pathArg || cwd));
    const depth = Math.max(1, Math.min(flagNum(args, 'depth', 3), 6));

    if (!(await exists(root))) {
      fail(`Путь "${root}" не существует.`);
      return;
    }

    const spinner = (await import('../core/ui.ts')).spinner('ищу репозитории…');
    const repos = await findRepos(root, depth);
    spinner.stop();

    if (!repos.length) {
      info(`В "${root}" репозиториев не найдено.`);
      return;
    }

    if (sub === 'log' || sub === 'report') {
      const days = Math.max(1, flagNum(args, 'days', 7));
      const since = new Date(Date.now() - days * 86400000).toISOString();
      const spin = (await import('../core/ui.ts')).spinner(`собираю коммиты за ${days} дн…`);

      const results = await mapLimit(repos, 6, async (dir) => {
        const res = await run(
          'git',
          ['log', `--since=${since}`, '--pretty=%cI|%h|%s', '--no-merges'],
          { cwd: dir, timeout: 20000 },
        );
        return { dir, lines: res.ok ? res.stdout.split(/\r?\n/).filter(Boolean) : [] };
      });
      spin.stop();

      const byDay = new Map<string, { repo: string; hash: string; subject: string; time: string }[]>();
      for (const { dir, lines } of results) {
        const name = path.basename(dir);
        for (const line of lines) {
          const [iso, hash, ...rest] = line.split('|');
          const day = iso.slice(0, 10);
          if (!byDay.has(day)) byDay.set(day, []);
          byDay.get(day)!.push({ repo: name, hash, subject: rest.join('|'), time: iso.slice(11, 16) });
        }
      }

      if (!byDay.size) {
        info(`За последние ${days} дн. коммитов нет.`);
        return;
      }

      const daysSorted = [...byDay.keys()].sort().reverse();
      process.stdout.write('\n');
      for (const day of daysSorted) {
        const items = byDay.get(day)!;
        const label = new Date(day + 'T00:00:00').toLocaleDateString('ru-RU', { weekday: 'short', day: '2-digit', month: 'long' });
        process.stdout.write('  ' + paint(label, bold(), fg(C.accent)) + paint(`   ${items.length} коммит(ов)`, fg(C.faint)) + '\n');
        for (const item of items) {
          process.stdout.write(
            '    ' +
              paint(item.time, fg(C.faint)) +
              paint('  ' + truncate(item.repo, 18).padEnd(18), fg(C.info)) +
              paint(item.hash, fg(C.muted)) +
              '  ' +
              paint(truncate(item.subject, 60), fg(C.soft)) +
              '\n',
          );
        }
        process.stdout.write('\n');
      }
      return;
    }

    const spin = (await import('../core/ui.ts')).spinner(`читаю ${repos.length} репозиториев…`);
    const infos = await mapLimit(repos, 6, repoInfo);
    spin.stop();

    if (flagBool(args, 'json')) {
      process.stdout.write(
        JSON.stringify(
          {
            root: path.resolve(root),
            repos: infos.map((i) => ({
              name: i.name,
              dir: i.dir,
              branch: i.branch,
              dirty: i.dirty,
              untracked: i.untracked,
              ahead: i.ahead ?? null,
              behind: i.behind ?? null,
              lastCommit: i.lastSubject || null,
              lastWhen: i.lastWhen || null,
            })),
            summary: {
              total: infos.length,
              changed: infos.filter((i) => i.dirty || i.untracked).length,
              unpushed: infos.filter((i) => (i.ahead ?? 0) > 0).length,
            },
          },
          null,
          2,
        ) + '\n',
      );
      return;
    }

    const dirty = infos.filter((i) => i.dirty || i.untracked).length;
    const sync = infos.filter((i) => (i.ahead ?? 0) > 0).length;

    process.stdout.write(
      '\n' +
        table(
          ['РЕПОЗИТОРИЙ', 'ВЕТКА', 'СОСТОЯНИЕ', '↑↓', 'ПОСЛЕДНИЙ КОММИТ', 'КОГДА'],
          infos.map((i) => [
            paint(truncate(i.name, 24), bold(), fg(C.text)),
            paint(truncate(i.branch, 22), fg(C.accent)),
            statusCell(i),
            i.ahead === null && i.behind === null
              ? paint('—', fg(C.faint))
              : paint(`↑${i.ahead ?? 0} ↓${i.behind ?? 0}`, fg((i.ahead ?? 0) > 0 ? C.warn : C.faint)),
            paint(truncate(i.lastSubject || '—', 46), fg(C.soft)),
            paint(i.lastWhen ? timeAgo(i.lastWhen) : '—', fg(C.faint)),
          ]),
          { align: ['left', 'left', 'left', 'left', 'left', 'left'] },
        ) +
        '\n',
    );
    process.stdout.write(
      '\n  ' +
        paint(`репозиториев: ${infos.length}`, fg(C.muted)) +
        paint('  ·  ', fg(C.faint)) +
        paint(`с изменениями: ${dirty}`, fg(dirty ? C.warn : C.ok)) +
        paint('  ·  ', fg(C.faint)) +
        paint(`не запушено: ${sync}`, fg(sync ? C.warn : C.ok)) +
        '\n\n',
    );
  },
} satisfies Command;
