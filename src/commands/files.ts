// jd big / jd tree — куда уехало место на диске.

import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs, flagBool, flagNum, flagStr } from '../core/args.ts';
import { fail, info } from '../core/help.ts';
import { C, bold, fg, paint, statusColor } from '../core/theme.ts';
import { bar, spinner, table, truncate } from '../core/ui.ts';
import { formatBytes } from '../core/util.ts';
import type { Command } from '../core/registry.ts';

const SKIP_DIRS = new Set([
  'node_modules', '.git', '$RECYCLE.BIN', 'System Volume Information', '.cache',
  'AppData', 'Windows', 'Program Files', 'Program Files (x86)',
]);

interface FileInfo {
  path: string;
  size: number;
}

interface WalkResult {
  files: FileInfo[];
  dirSizes: Map<string, number>;
  total: number;
}

async function readDir(dir: string, withTypes = false): Promise<{ name: string; full: string; isDir: boolean; isLink: boolean }[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.map((e) => ({
      name: e.name,
      full: path.join(dir, e.name),
      isDir: e.isDirectory(),
      isLink: e.isSymbolicLink(),
    }));
  } catch {
    return [];
  }
}

async function walk(root: string, includeAll: boolean, onTick?: (count: number) => void): Promise<WalkResult> {
  const files: FileInfo[] = [];
  const dirSizes = new Map<string, number>();
  let scanned = 0;

  async function visit(dir: string): Promise<number> {
    let total = 0;
    for (const entry of await readDir(dir)) {
      if (entry.isLink) continue;
      if (entry.isDir) {
        if (!includeAll && SKIP_DIRS.has(entry.name)) continue;
        const size = await visit(entry.full);
        dirSizes.set(entry.full, size);
        total += size;
      } else {
        try {
          const st = await stat(entry.full);
          files.push({ path: entry.full, size: st.size });
          total += st.size;
          scanned++;
          if (onTick && scanned % 500 === 0) onTick(scanned);
        } catch {
          /* нет доступа — пропускаем */
        }
      }
    }
    return total;
  }

  const total = await visit(root);
  return { files, dirSizes, total };
}

function sizeColor(size: number, max: number): string {
  return statusColor(Math.min(100, (size / Math.max(1, max)) * 100));
}

export const big: Command = {
  name: 'big',
  aliases: ['size', 'du'],
  group: 'Файлы',
  title: 'Что занимает место',
  desc: 'Самые тяжёлые файлы и папки в дереве',
  usage: 'jd big [путь] [--top=12] [--all]',
  examples: ['jd big', 'jd big C:\\projects --top=20', 'jd big . --all'],

  async run({ argv, cwd }) {
    const args = parseArgs(argv, { top: 'number', all: 'boolean', path: 'string' });
    const root = path.resolve(flagStr(args, 'path', args._[0] || cwd));
    const top = Math.max(3, Math.min(flagNum(args, 'top', 12), 50));
    const includeAll = flagBool(args, 'all');

    const spin = spinner(`считаю размеры в ${truncate(root, 50)}…`);
    const started = Date.now();
    const result = await walk(root, includeAll, (count) => spin.update(`просканировано файлов: ${count}`));
    spin.stop();

    if (!result.files.length) {
      fail('Не найдено ни одного файла (или нет прав доступа).');
      return;
    }

    const topFiles = [...result.files].sort((a, b) => b.size - a.size).slice(0, top);
    const topDirs = [...result.dirSizes.entries()]
      .map(([dir, size]) => ({ dir, size }))
      .sort((a, b) => b.size - a.size)
      .slice(0, top);

    const maxFile = topFiles[0]?.size ?? 1;
    process.stdout.write(
      '\n  ' +
        paint('Самые большие файлы', bold(), fg(C.accent)) +
        '\n\n' +
        table(
          ['РАЗМЕР', '', 'ФАЙЛ'],
          topFiles.map((f) => [
            paint(formatBytes(f.size), fg(C.warn)),
            bar(f.size, maxFile, 14, sizeColor(f.size, maxFile)),
            paint(truncate(path.relative(root, f.path) || f.path, 90), fg(C.text)),
          ]),
          { align: ['right', 'left', 'left'], showHeader: false },
        ) +
        '\n',
    );

    if (topDirs.length) {
      const maxDir = topDirs[0]?.size ?? 1;
      process.stdout.write(
        '\n  ' +
          paint('Самые тяжёлые папки', bold(), fg(C.accent)) +
          '\n\n' +
          table(
            ['РАЗМЕР', '', 'ПАПКА'],
            topDirs.map((d) => [
              paint(formatBytes(d.size), fg(C.info)),
              bar(d.size, maxDir, 14, C.info),
              paint(truncate(path.relative(root, d.dir) || d.dir, 90), fg(C.text)),
            ]),
            { align: ['right', 'left', 'left'], showHeader: false },
          ) +
          '\n',
      );
    }

    process.stdout.write(
      '\n  ' +
        paint(`итого: ${formatBytes(result.total)}`, bold(), fg(C.text)) +
        paint(`   файлов: ${result.files.length}`, fg(C.muted)) +
        paint(`   за ${((Date.now() - started) / 1000).toFixed(1)} с`, fg(C.faint)) +
        '\n\n',
    );
  },
};

export const tree: Command = {
  name: 'tree',
  aliases: ['tr'],
  group: 'Файлы',
  title: 'Дерево папок',
  desc: 'Структура каталога с размерами',
  usage: 'jd tree [путь] [--depth=2] [--all]',
  examples: ['jd tree', 'jd tree src --depth=3'],

  async run({ argv, cwd }) {
    const args = parseArgs(argv, { depth: 'number', all: 'boolean', path: 'string' });
    const root = path.resolve(flagStr(args, 'path', args._[0] || cwd));
    const depth = Math.max(1, Math.min(flagNum(args, 'depth', 2), 8));
    const includeAll = flagBool(args, 'all');

    const spin = spinner('считаю размеры…');
    const result = await walk(root, includeAll);
    spin.stop();

    const out: string[] = [
      paint(path.basename(root) || root, bold(), fg(C.primary)) + paint('  ' + formatBytes(result.total), fg(C.faint)),
    ];

    const draw = async (dir: string, prefix: string, level: number): Promise<void> => {
      if (level > depth) return;
      const children = (await readDir(dir))
        .filter((e) => e.isDir && !e.isLink && (includeAll || !SKIP_DIRS.has(e.name)))
        .map((e) => ({ name: e.name, full: e.full, size: result.dirSizes.get(e.full) ?? 0 }))
        .sort((a, b) => b.size - a.size);

      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        const last = i === children.length - 1;
        out.push(
          paint(prefix + (last ? '└── ' : '├── '), fg(C.faint)) +
            paint(child.name, fg(C.soft)) +
            paint('  ' + formatBytes(child.size), fg(C.faint)),
        );
        await draw(child.full, prefix + (last ? '    ' : '│   '), level + 1);
      }
    };

    await draw(root, '  ', 1);

    if (out.length === 1) {
      info('Внутри нет подпапок.');
      return;
    }
    process.stdout.write('\n' + out.join('\n') + '\n\n');
  },
};

export default [big, tree];
