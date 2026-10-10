// jd arch — архитектура проекта: из чего состоит, что где лежит, что чем является.
//
// Две подачи одного и того же:
//   * дерево с типами файлов, строками и размерами — для чтения и копирования;
//   * полноэкранный обзор с вкладками по папкам — чтобы ходить по проекту стрелками.
//
// Вёрстка обеих подач — чистые функции от ArchSummary, поэтому их можно проверять.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { flagBool, flagNum, parseArgs } from '../core/args.ts';
import {
  describeFile,
  diffSnapshots,
  flattenFiles,
  KIND_ICON,
  KIND_LABEL,
  scanTree,
  snapshotOf,
  type ArchDir,
  type ArchFile,
  type ArchSnapshot,
  type ArchSummary,
  type FileKind,
} from '../core/arch.ts';
import { runDashboard, type DashItem, type DashTab } from '../core/dashboard.ts';
import { fail, info, ok } from '../core/help.ts';
import { isInteractive, pause } from '../core/input.ts';
import { neonBanner } from '../core/neon.ts';
import { C, bold, fg, paint } from '../core/theme.ts';
import { kv } from '../core/store.ts';
import { bar, box, table, truncate } from '../core/ui.ts';
import { countOf, formatBytes, num } from '../core/util.ts';
import type { Command } from '../core/registry.ts';

/** Ключ снимка архитектуры: свой для каждой папки проекта. */
function snapshotKey(root: string): string {
  return `arch_snapshot:${path.resolve(root).toLowerCase()}`;
}

function loadSnapshot(key: string): ArchSnapshot | null {
  try {
    const raw = kv.get(key, '');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ArchSnapshot;
    return Array.isArray(parsed?.entries) ? parsed : null;
  } catch {
    return null;
  }
}

const FILES_FORMS = ['файл', 'файла', 'файлов'] as const;
const DIRS_FORMS = ['папка', 'папки', 'папок'] as const;
const LINES_FORMS = ['строка', 'строки', 'строк'] as const;

export function linesLabel(lines: number): string {
  return countOf(lines, LINES_FORMS);
}

/* --------------------------- статистика для вывода ------------------------- */

function dirEntries(node: ArchDir): number {
  return node.dirs.length + node.files.length;
}

/** Заголовок: корень, тип проекта и итоговые цифры. */
export function summaryHeader(summary: ArchSummary): string[] {
  const parts = [
    paint(countOf(summary.files, FILES_FORMS), fg(C.text)),
    paint(countOf(summary.dirs, DIRS_FORMS), fg(C.text)),
    paint(linesLabel(summary.lines), fg(C.info)),
    paint(formatBytes(summary.bytes), fg(C.accent)),
  ];
  const lines: string[] = [];
  lines.push(paint(summary.root, fg(C.soft)));
  lines.push(paint(summary.projectType, bold(), fg(C.primary)));
  lines.push('');
  lines.push(parts.join(paint('  ·  ', fg(C.faint))));
  if (summary.binaryFiles) {
    lines.push(paint(`${countOf(summary.binaryFiles, FILES_FORMS)} без подсчёта строк (бинарные или очень большие)`, fg(C.faint)));
  }
  if (summary.entryPoints.length) {
    lines.push('');
    lines.push(paint('точки входа: ', fg(C.muted)) + paint(summary.entryPoints.join(', '), fg(C.cyan)));
  }
  if (summary.truncated) {
    lines.push(paint('⚠ обход упёрся в предел файлов — цифры неполные', fg(C.warn)));
  }
  return lines;
}

/** Таблица «из чего состоит»: типы файлов, строки, вес и полоса доли. */
export function kindsTable(summary: ArchSummary): string {
  const maxLines = Math.max(1, ...summary.byKind.map((k) => k.stat.lines || k.stat.files));
  const rows = summary.byKind.map(({ kind, stat }) => [
    `${KIND_ICON[kind]} ${KIND_LABEL[kind]}`,
    paint(num(stat.files), fg(C.text)),
    paint(num(stat.lines), fg(C.info)),
    paint(formatBytes(stat.bytes), fg(C.accent)),
    bar(stat.lines || stat.files, maxLines, 18, C.primary),
  ]);
  return table(['ЧТО', 'ФАЙЛОВ', 'СТРОК', 'РАЗМЕР', ''], rows, { align: ['left', 'right', 'right', 'right', 'left'] });
}

/* --------------------------------- дерево --------------------------------- */

export interface TreeRow {
  entry: ArchDir | ArchFile;
  isDir: boolean;
  /** Уровень вложенности: 0 — верхний. */
  depth: number;
  /** Направляющие линии: «│  ├─ ». */
  prefix: string;
}

/**
 * Разложить дерево в строки: одна запись — одна строка со своими направляющими.
 * Этим пользуются и статичный вид, и вкладки: структура везде выглядит одинаково.
 */
export function treeRows(node: ArchDir, maxPerDir = Number.POSITIVE_INFINITY): TreeRow[] {
  const rows: TreeRow[] = [];

  const walk = (dir: ArchDir, prefix: string, depth: number): void => {
    const entries: (ArchDir | ArchFile)[] = [...dir.dirs, ...dir.files];
    const shown = entries.slice(0, maxPerDir);
    shown.forEach((entry, index) => {
      const last = index === shown.length - 1;
      rows.push({
        entry,
        isDir: 'dirs' in entry,
        depth,
        prefix: prefix + (last ? '└─ ' : '├─ '),
      });
      if ('dirs' in entry) walk(entry, prefix + (last ? '   ' : '│  '), depth + 1);
    });
    if (entries.length > shown.length) {
      const hidden = entries.length - shown.length;
      rows.push({
        // Псевдо-запись: показывает, что часть содержимого скрыта лимитом.
        entry: { name: `… ещё ${hidden}`, rel: dir.rel, kind: 'other', bytes: 0, lines: null, depth: depth + 1 },
        isDir: false,
        depth,
        prefix: prefix + '└─ ',
      });
    }
  };

  walk(node, '', 0);
  return rows;
}

export interface TreeOptions {
  maxPerDir?: number;
  /** Показывать строки и размер у файлов. */
  sizes?: boolean;
}

/** Дерево проекта с иконками, строками и размерами. */
export function renderTree(node: ArchDir, opts: TreeOptions = {}): string[] {
  const maxPerDir = opts.maxPerDir ?? 14;
  const sizes = opts.sizes !== false;

  const label = (entry: ArchDir | ArchFile, isDir: boolean): string => {
    if (isDir) {
      const dir = entry as ArchDir;
      const bits = [countOf(dir.fileCount, FILES_FORMS)];
      if (dir.lines) bits.push(linesLabel(dir.lines));
      return paint(`📁 ${dir.name}/`, bold(), fg(C.primary)) + paint('   ' + bits.join(' · '), fg(C.faint));
    }
    const file = entry as ArchFile;
    const bits: string[] = [];
    if (sizes) {
      if (file.lines !== null) bits.push(linesLabel(file.lines));
      bits.push(formatBytes(file.bytes));
    }
    return paint(`${KIND_ICON[file.kind]} ${file.name}`, fg(C.soft)) + paint('   ' + bits.join(' · '), fg(C.faint));
  };

  return treeRows(node, maxPerDir).map((row) => paint(row.prefix, fg(C.faint)) + label(row.entry, row.isDir));
}

/* ------------------------------- статичный вид ---------------------------- */

export function renderStatic(summary: ArchSummary, opts: TreeOptions = {}): string {
  const out: string[] = [];
  out.push('');
  out.push(neonBanner({ subtitle: 'Architecture', reflection: false }));
  out.push('');
  out.push('  ' + paint(`🏗  ${summary.name}`, bold(), fg(C.accent)));
  for (const line of summaryHeader(summary)) out.push('  ' + line);

  out.push('');
  out.push('  ' + paint('ИЗ ЧЕГО СОСТОИТ', bold(), fg(C.accent)));
  out.push(kindsTable(summary).split('\n').map((l) => '  ' + l).join('\n'));

  out.push('');
  out.push('  ' + paint('СТРУКТУРА', bold(), fg(C.accent)));
  const tree = renderTree(summary.tree, opts);
  out.push(tree.length ? tree.map((l) => '  ' + l).join('\n') : paint('  пусто', fg(C.faint)));

  if (summary.top.length) {
    out.push('');
    out.push('  ' + paint('САМЫЕ ТЯЖЁЛЫЕ ФАЙЛЫ', bold(), fg(C.accent)));
    out.push(
      table(
        ['ФАЙЛ', 'РАЗМЕР', 'СТРОК'],
        summary.top.map((file) => [
          paint(truncate(file.rel, 56), fg(C.soft)),
          paint(formatBytes(file.bytes), fg(C.accent)),
          paint(file.lines === null ? '—' : num(file.lines), fg(C.info)),
        ]),
        { align: ['left', 'right', 'right'] },
      )
        .split('\n')
        .map((l) => '  ' + l)
        .join('\n'),
    );
  }

  out.push('');
  out.push(paint('  подробнее в интерактиве: jd arch --tabs   ·   машинный вид: jd arch --json\n', fg(C.faint)));
  return out.join('\n');
}

/* --------------------------------- вкладки -------------------------------- */

type ArchAction =
  | { kind: 'file'; file: ArchFile }
  | { kind: 'dir'; dir: ArchDir }
  | { kind: 'kind'; kind: FileKind }
  | { kind: 'top' }
  | { kind: 'entry'; file: ArchFile };

function fileItem(file: ArchFile): DashItem {
  return {
    label: `${KIND_ICON[file.kind]} ${file.name}`,
    hint: `${file.lines === null ? '—' : linesLabel(file.lines)} · ${formatBytes(file.bytes)}`,
    detail: [
      { k: 'путь', v: file.rel },
      { k: 'тип', v: `${KIND_LABEL[file.kind]} · ${file.name.split('.').pop() ?? '—'}` },
      { k: 'размер', v: `${formatBytes(file.bytes)}${file.lines === null ? '' : ` · ${linesLabel(file.lines)}`}` },
      { v: describeFile(file) },
    ],
  };
}

function dirItem(dir: ArchDir): DashItem {
  const children = [...dir.dirs.map((d) => `📁 ${d.name}/`), ...dir.files.slice(0, 10).map((f) => `${KIND_ICON[f.kind]} ${f.name}`)];
  return {
    label: `📁 ${dir.name}/`,
    hint: `${countOf(dir.fileCount, FILES_FORMS)} · ${linesLabel(dir.lines)} · ${formatBytes(dir.bytes)}`,
    detail: [
      { k: 'путь', v: dir.rel || '.' },
      { k: 'внутри', v: countOf(dir.dirs.length, DIRS_FORMS) },
      ...(children.length ? [{ k: 'файлы', v: children.join('\n') }] : []),
      ...(dir.dirs.length ? [{ k: 'папки', v: dir.dirs.map((d) => `${d.name}/`).join('\n') }] : []),
    ],
  };
}

/**
 * Строка дерева как пункт меню: направляющие и отступы остаются,
 * поэтому вложенность видно прямо в списке, а не только в деталях.
 */
function rowItem(row: TreeRow): DashItem {
  const base = row.isDir ? dirItem(row.entry as ArchDir) : fileItem(row.entry as ArchFile);
  const name = row.isDir ? `${(row.entry as ArchDir).name}/` : (row.entry as ArchFile).name;
  const icon = row.isDir ? '📁' : KIND_ICON[(row.entry as ArchFile).kind];
  return { ...base, label: `${row.prefix}${icon} ${name}` };
}

function rowAction(row: TreeRow): ArchAction {
  return row.isDir ? { kind: 'dir', dir: row.entry as ArchDir } : { kind: 'file', file: row.entry as ArchFile };
}

export function buildTabs(summary: ArchSummary): { tabs: DashTab[]; actions: ArchAction[][] } {
  const tabs: DashTab[] = [];
  const actions: ArchAction[][] = [];

  // Вкладка «Обзор»: из чего состоит проект и что в нём самое главное.
  const overviewItems: DashItem[] = [];
  const overviewActions: ArchAction[] = [];

  for (const { kind, stat } of summary.byKind) {
    const files = flattenFiles(summary.tree).filter((f) => f.kind === kind);
    overviewItems.push({
      label: `${KIND_ICON[kind]} ${KIND_LABEL[kind]}`,
      hint: `${countOf(stat.files, FILES_FORMS)} · ${linesLabel(stat.lines)} · ${formatBytes(stat.bytes)}`,
      detail: [
        { k: 'файлов', v: num(stat.files) },
        { k: 'строк', v: num(stat.lines) },
        { k: 'размер', v: formatBytes(stat.bytes) },
        { k: 'где лежат', v: [...new Set(files.map((f) => path.posix.dirname(f.rel)))].slice(0, 6).join('\n') },
        { v: files.slice(0, 12).map((f) => f.rel).join('\n') || '—' },
      ],
    });
    overviewActions.push({ kind: 'kind', kind });
  }

  if (summary.entryPoints.length) {
    const files = summary.entryPoints
      .map((rel) => flattenFiles(summary.tree).find((f) => f.rel === rel))
      .filter((f): f is ArchFile => Boolean(f));
    overviewItems.push({
      label: '🚪 Точки входа',
      hint: summary.entryPoints.slice(0, 3).join(', '),
      detail: [
        { k: 'что это', v: 'с этих файлов начинается запуск проекта' },
        { v: summary.entryPoints.join('\n') },
      ],
    });
    overviewActions.push(files[0] ? { kind: 'entry', file: files[0] } : { kind: 'top' });
  }

  if (summary.top.length) {
    overviewItems.push({
      label: '🐘 Самые тяжёлые файлы',
      hint: summary.top.slice(0, 2).map((f) => `${f.name} ${formatBytes(f.bytes)}`).join(' · '),
      detail: summary.top.slice(0, 10).map((f) => ({ k: formatBytes(f.bytes), v: f.rel })),
    });
    overviewActions.push({ kind: 'top' });
  }

  tabs.push({ label: `📊 Обзор`, items: overviewItems, accent: true });
  actions.push(overviewActions);

  // Всё дерево целиком: одна запись — одна строка со своими направляющими.
  const allRows = treeRows(summary.tree);
  tabs.push({ label: '🌳 Дерево', items: allRows.map(rowItem), accent: true });
  actions.push(allRows.map(rowAction));

  // И по вкладке на каждую папку верхнего уровня — чтобы можно было сосредоточиться.
  for (const dir of summary.tree.dirs) {
    const rows = treeRows(dir);
    tabs.push({ label: `📁 ${dir.name}`, items: rows.map(rowItem), accent: true });
    actions.push(rows.map(rowAction));
  }

  if (summary.tree.files.length) {
    tabs.push({ label: '📄 В корне', items: summary.tree.files.map(fileItem) });
    actions.push(summary.tree.files.map((f): ArchAction => ({ kind: 'file', file: f })));
  }

  return { tabs, actions };
}

/** Первые строки файла — чтобы понять, что это, не открывая редактор. */
export async function peekFile(file: ArchFile, root: string, maxLines = 22, width = 100): Promise<string[]> {
  const full = path.join(root, file.rel.split('/').join(path.sep));
  try {
    const raw = await readFile(full, 'utf8');
    if (raw.includes('\u0000')) return ['(бинарный файл — показывать нечего)'];
    return raw
      .replace(/^\uFEFF/, '')
      .replace(/\r\n/g, '\n')
      .split('\n')
      .slice(0, maxLines)
      .map((line) => truncate(line.replace(/\s+$/, ''), width));
  } catch {
    return ['(не удалось прочитать файл)'];
  }
}

function fileCard(file: ArchFile, summary: ArchSummary, lines: string[]): string {
  const body: string[] = [];
  body.push(paint(file.rel, bold(), fg(C.text)));
  body.push('');
  body.push(
    paint('тип      ', fg(C.muted)) + paint(`${KIND_ICON[file.kind]} ${KIND_LABEL[file.kind]}`, fg(C.accent)) +
      paint(`   ${describeFile(file)}`, fg(C.faint)),
  );
  body.push(
    paint('размер   ', fg(C.muted)) + paint(formatBytes(file.bytes), fg(C.accent)) +
      (file.lines === null ? '' : paint(`   ${linesLabel(file.lines)}`, fg(C.info))),
  );
  if (summary.entryPoints.includes(file.rel)) body.push(paint('роль     ', fg(C.muted)) + paint('точка входа проекта', bold(), fg(C.ok)));
  body.push('');
  for (const line of lines) body.push(paint(line, fg(C.soft)));
  return box(body, { title: paint(`${KIND_ICON[file.kind]} ${file.name}`, bold(), fg(C.accent)) });
}

async function browse(summary: ArchSummary): Promise<void> {
  const { tabs, actions } = buildTabs(summary);
  for (;;) {
    const selection = await runDashboard(tabs, {
      title: `🏗  ${summary.name} · ${summary.projectType}`,
      right: `${countOf(summary.files, FILES_FORMS)} · ${linesLabel(summary.lines)}`,
    });
    if (!selection) return;

    const action = actions[selection.tab]?.[selection.item];
    if (!action) continue;

    if (action.kind === 'dir') {
      const lines: string[] = [paint(action.dir.rel || '.', bold(), fg(C.text)), ''];
      lines.push(paint('внутри   ', fg(C.muted)) + paint(`${countOf(action.dir.fileCount, FILES_FORMS)} · ${linesLabel(action.dir.lines)} · ${formatBytes(action.dir.bytes)}`, fg(C.soft)));
      const tree = renderTree(action.dir, { maxPerDir: 20 });
      lines.push('');
      lines.push(...tree);
      process.stdout.write('\n' + box(lines, { title: paint(`📁 ${action.dir.name}/`, bold(), fg(C.accent)) }) + '\n');
    } else if (action.kind === 'file' || action.kind === 'entry') {
      const peek = await peekFile(action.file, summary.root);
      process.stdout.write('\n' + fileCard(action.file, summary, peek) + '\n');
    } else if (action.kind === 'kind') {
      const kind = action.kind;
      const files = flattenFiles(summary.tree)
        .filter((f) => f.kind === kind)
        .sort((a, b) => b.bytes - a.bytes);
      process.stdout.write(
        '\n' +
          table(
            ['ФАЙЛ', 'РАЗМЕР', 'СТРОК'],
            files.slice(0, 40).map((f) => [
              paint(f.rel, fg(C.soft)),
              paint(formatBytes(f.bytes), fg(C.accent)),
              paint(f.lines === null ? '—' : num(f.lines), fg(C.info)),
            ]),
            { align: ['left', 'right', 'right'] },
          ) +
          '\n',
      );
      if (files.length > 40) info(`… ещё ${files.length - 40}`);
    } else {
      process.stdout.write('\n' + renderTree(summary.tree, { maxPerDir: 40 }) + '\n');
    }

    await pause('Enter — назад к вкладкам');
  }
}

/* --------------------------------- команда -------------------------------- */

export default {
  name: 'arch',
  aliases: ['structure', 'layout'],
  group: 'Разработка',
  title: 'Архитектура проекта',
  desc: 'Дерево папок с типами файлов, строками и вкладками по папкам',
  usage: 'jd arch [путь] [--tabs] [--tree] [--depth=4] [--no-lines] [--json]',
  examples: [
    'jd arch',
    'jd arch --tabs',
    'jd arch src --depth=2',
    'jd arch --json | jd json --query=byKind',
    'jd arch --diff          (что изменилось с прошлого снимка)',
  ],

  async run({ argv, cwd }) {
    const args = parseArgs(
      argv,
      { tabs: 'boolean', tree: 'boolean', depth: 'number', lines: 'boolean', json: 'boolean', all: 'boolean', per: 'number', diff: 'boolean', snapshot: 'boolean' },
    );

    const target = path.resolve(cwd, args._[0] ?? '.');
    const depth = Math.max(1, Math.min(flagNum(args, 'depth', 4), 12));
    const withLines = flagBool(args, 'lines', true);

    const summary = await scanTree(target, {
      depth,
      lines: withLines,
      all: flagBool(args, 'all'),
    }).catch((err: Error) => {
      fail(`Не удалось прочитать ${target}: ${err.message}`);
      return null;
    });
    if (!summary) return;

    // Снимок: сохранить или сравнить с прошлым.
    if (flagBool(args, 'snapshot') || flagBool(args, 'diff')) {
      const current = snapshotOf(summary);
      const key = snapshotKey(summary.root);
      const previous = loadSnapshot(key);

      if (flagBool(args, 'snapshot')) {
        kv.set(key, JSON.stringify(current));
        ok(`Снимок сохранён: ${countOf(current.files, ['файл', 'файла', 'файлов'])} · ${linesLabel(current.lines)}.`);
        process.stdout.write(paint(`  сравнить потом: jd arch --diff\n\n`, fg(C.faint)));
        return;
      }

      if (!previous) {
        kv.set(key, JSON.stringify(current));
        info('Снимка ещё не было — сохранил текущее состояние как точку отсчёта.');
        process.stdout.write(paint('  теперь меняй код и смотри: jd arch --diff\n\n', fg(C.faint)));
        return;
      }

      const diff = diffSnapshots(previous, current);
      const delta = (value: number, unit: string, format: (n: number) => string = (n) => num(n)): string =>
        (value > 0 ? paint(`+${format(value)}`, fg(C.ok)) : value < 0 ? paint(`−${format(-value)}`, fg(C.err)) : paint('0', fg(C.faint))) +
        paint(` ${unit}`, fg(C.faint));

      const body: string[] = [
        paint(`снимок: ${new Date(previous.at).toLocaleString('ru-RU')}`, fg(C.faint)),
        '',
        paint('файлов  ', fg(C.muted)) + delta(diff.filesDelta, '') + paint(`   всего ${num(current.files)}`, fg(C.faint)),
        paint('строк   ', fg(C.muted)) + delta(diff.linesDelta, '') + paint(`   всего ${num(current.lines)}`, fg(C.faint)),
        paint('размер  ', fg(C.muted)) +
          delta(diff.bytesDelta, '', (n) => formatBytes(n)) +
          paint(`   всего ${formatBytes(current.bytes)}`, fg(C.faint)),
      ];

      if (diff.added.length) {
        body.push('', paint(`НОВЫЕ ФАЙЛЫ (${diff.added.length})`, bold(), fg(C.ok)));
        for (const file of diff.added.slice(0, 15)) body.push(paint(' + ', fg(C.ok)) + paint(file.rel, fg(C.text)) + paint(file.lines === null ? '' : `   ${linesLabel(file.lines)}`, fg(C.faint)));
        if (diff.added.length > 15) body.push(paint(`   … ещё ${diff.added.length - 15}`, fg(C.faint)));
      }
      if (diff.removed.length) {
        body.push('', paint(`УДАЛЁННЫЕ ФАЙЛЫ (${diff.removed.length})`, bold(), fg(C.err)));
        for (const file of diff.removed.slice(0, 15)) body.push(paint(' − ', fg(C.err)) + paint(file.rel, fg(C.text)));
        if (diff.removed.length > 15) body.push(paint(`   … ещё ${diff.removed.length - 15}`, fg(C.faint)));
      }
      if (diff.changed.length) {
        body.push('', paint(`ИЗМЕНИЛИСЬ (${diff.changed.length})`, bold(), fg(C.warn)));
        for (const file of diff.changed.slice(0, 15)) {
          const linesChanged = (file.linesTo ?? 0) - (file.linesFrom ?? 0);
          body.push(
            paint(' ~ ', fg(C.warn)) +
              paint(file.rel, fg(C.text)) +
              paint(`   ${file.linesFrom ?? '—'} → ${file.linesTo ?? '—'}`, fg(C.faint)) +
              (linesChanged ? paint(`  ${linesChanged > 0 ? '+' : '−'}${Math.abs(linesChanged)}`, fg(linesChanged > 0 ? C.ok : C.err)) : ''),
          );
        }
        if (diff.changed.length > 15) body.push(paint(`   … ещё ${diff.changed.length - 15}`, fg(C.faint)));
      }
      if (!diff.added.length && !diff.removed.length && !diff.changed.length) {
        body.push('', paint('✔', fg(C.ok)) + paint(' архитектура не изменилась с прошлого снимка', fg(C.text)));
      }

      if (flagBool(args, 'json')) {
        process.stdout.write(JSON.stringify({ previous: previous.at, current: current.at, ...diff }, null, 2) + '\n');
        return;
      }
      process.stdout.write('\n' + box(body, { title: paint(`🏗  Изменения в ${summary.name}`, bold(), fg(C.accent)) }) + '\n');
      process.stdout.write(paint('  обновить снимок: jd arch --snapshot\n\n', fg(C.faint)));
      return;
    }

    if (flagBool(args, 'json')) {
      process.stdout.write(
        JSON.stringify(
          {
            root: summary.root,
            name: summary.name,
            projectType: summary.projectType,
            files: summary.files,
            dirs: summary.dirs,
            lines: summary.lines,
            bytes: summary.bytes,
            entryPoints: summary.entryPoints,
            byKind: Object.fromEntries(summary.byKind.map((k) => [k.kind, k.stat])),
            top: summary.top.map((f) => ({ path: f.rel, bytes: f.bytes, lines: f.lines })),
            truncated: summary.truncated,
          },
          null,
          2,
        ) + '\n',
      );
      return;
    }

    const treeOptions: TreeOptions = { maxPerDir: Math.max(4, flagNum(args, 'per', 14)), sizes: withLines };

    // В терминале — обзор со вкладками по папкам; в пайпе или с --tree — текст.
    if (flagBool(args, 'tree') || !isInteractive()) {
      process.stdout.write(renderStatic(summary, treeOptions) + '\n');
      return;
    }

    await browse(summary);
    process.stdout.write(paint('  статичное дерево: jd arch --tree\n\n', fg(C.faint)));
  },
} satisfies Command;
