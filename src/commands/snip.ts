// jd snip — личная база сниппетов: команды, куски кода, ответы на грабли.

import { writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs, flagStr } from '../core/args.ts';
import { fail, info, ok } from '../core/help.ts';
import { confirm, isInteractive, promptText } from '../core/input.ts';
import { copyToClipboard, run } from '../core/shell.ts';
import { snippets, type Snippet } from '../core/store.ts';
import { C, bold, fg, paint } from '../core/theme.ts';
import { box, table, truncate } from '../core/ui.ts';
import { fuzzyMatch, readStdin, timeAgo, valueOrStdin } from '../core/util.ts';
import type { Command } from '../core/registry.ts';

async function bodyFromInput(rest: string[]): Promise<string | null> {
  if (rest.length) return rest.join(' ');
  const piped = await readStdin();
  if (piped !== null) return piped.replace(/\r?\n$/, '');
  if (!isInteractive()) return null;

  info('Введи тело сниппета. Пустая строка — закончить.');
  const lines: string[] = [];
  for (;;) {
    const line = await promptText(lines.length === 0 ? 'строка' : '…', '');
    if (line === '') break;
    lines.push(line);
  }
  return lines.length ? lines.join('\n') : null;
}

async function editInEditor(name: string, current: string): Promise<string | null> {
  const file = path.join(os.tmpdir(), `jd-snip-${name.replace(/[^\w.-]/g, '_')}.txt`);
  writeFileSync(file, current, 'utf8');
  const editor = process.env.EDITOR ?? process.env.VISUAL ?? '';
  const command = process.platform === 'win32'
    ? ['cmd', ['/c', 'start', '/wait', editor || 'notepad.exe', file]]
    : [editor || 'nano', [file]];
  const res = await run(command[0] as string, command[1] as string[], { timeout: 1000 * 60 * 30 });
  if (!res.ok && !editor) {
    fail('Не удалось открыть редактор.');
    return null;
  }
  const next = readFileSync(file, 'utf8');
  try {
    unlinkSync(file);
  } catch {
    /* не критично */
  }
  return next;
}

function renderList(items: Snippet[], query: string): string {
  const filtered = query
    ? items
        .map((s) => ({ s, m: fuzzyMatch(query, `${s.name} ${s.tags} ${s.lang}`) }))
        .filter((x): x is { s: Snippet; m: { score: number; positions: number[] } } => x.m !== null)
        .sort((a, b) => b.m.score - a.m.score)
        .map((x) => x.s)
    : items;

  if (!filtered.length) return paint('  пусто — добавь первый: jd snip add имя "тело"', fg(C.muted));

  return table(
    ['ИМЯ', 'ЯЗЫК', 'ТЕГИ', 'ИСП.', 'ОБНОВЛЁН', 'НАЧАЛО'],
    filtered.map((s) => [
      paint(s.name, bold(), fg(C.text)),
      paint(s.lang, fg(C.accent)),
      paint(s.tags || '—', fg(C.muted)),
      paint(String(s.uses), fg(C.faint)),
      paint(timeAgo(s.updated_at), fg(C.faint)),
      paint(truncate(s.body.split('\n')[0] ?? '', 44), fg(C.soft)),
    ]),
    { align: ['left', 'left', 'left', 'right', 'left', 'left'] },
  );
}

export default {
  name: 'snip',
  aliases: ['sn', 'snippet'],
  group: 'Разработка',
  title: 'Сниппеты и команды',
  desc: 'Личная база команд, кусков кода и грабельных ответов',
  usage: 'jd snip <add|ls|show|copy|edit|rm> [имя] [тело] [--tag=a,b] [--lang=js]',
  examples: [
    'jd snip add deploy "npm run build && pm2 restart app"',
    'echo "docker ps" | jd snip add ps',
    'jd snip ls docker',
    'jd snip copy deploy',
    'jd snip edit deploy',
  ],

  async run({ argv }) {
    const args = parseArgs(
      argv,
      { tag: 'string', tags: 'string', lang: 'string', body: 'string' },
      { tags: 'tag' },
    );
    const sub = args._[0] ?? 'ls';
    const name = args._[1];

    if (sub === 'add' || sub === 'set') {
      if (!name) {
        fail('Укажи имя: jd snip add <имя> [тело]');
        return;
      }
      const inline = flagStr(args, 'body', '');
      const body = inline || (await bodyFromInput(args._.slice(2)));
      if (!body) {
        fail('Пустое тело сниппета.');
        return;
      }
      const existing = snippets.get(name);
      snippets.upsert({
        name,
        body,
        lang: flagStr(args, 'lang', existing?.lang ?? 'text'),
        tags: flagStr(args, 'tag', existing?.tags ?? ''),
      });
      ok(`${existing ? 'Обновлён' : 'Сохранён'} сниппет ${paint(name, bold(), fg(C.accent))}`);
      return;
    }

    if (sub === 'ls' || sub === 'list' || sub === 'search') {
      const query = args._.slice(1).join(' ') || flagStr(args, 'q', '');
      process.stdout.write('\n' + renderList(snippets.all(), query) + '\n\n');
      return;
    }

    if (sub === 'show' || sub === 'cat') {
      if (!name) {
        fail('Укажи имя: jd snip show <имя>');
        return;
      }
      const snip = snippets.get(name);
      if (!snip) {
        fail(`Сниппет "${name}" не найден.`);
        return;
      }
      const head = [
        paint(`язык: `, fg(C.muted)) + paint(snip.lang, fg(C.accent)),
        paint(`теги: `, fg(C.muted)) + paint(snip.tags || '—', fg(C.soft)),
        paint(`использований: `, fg(C.muted)) + paint(String(snip.uses), fg(C.ok)),
      ];
      const body = box(snip.body.split('\n'), {
        title: paint(snip.name, bold(), fg(C.primary)),
        color: C.faint,
      });
      process.stdout.write('\n  ' + head.join(paint('   ·   ', fg(C.faint))) + '\n\n' + body + '\n\n');
      return;
    }

    if (sub === 'copy' || sub === 'cp' || sub === 'yank') {
      if (!name) {
        fail('Укажи имя: jd snip copy <имя>');
        return;
      }
      const snip = snippets.get(name);
      if (!snip) {
        fail(`Сниппет "${name}" не найден.`);
        return;
      }
      const copied = await copyToClipboard(snip.body);
      snippets.touch(name);
      if (copied) ok(`Скопирован ${paint(name, bold(), fg(C.accent))} в буфер обмена`);
      else {
        fail('Не удалось обратиться к буферу обмена — вот тело:');
        process.stdout.write(snip.body + '\n');
      }
      return;
    }

    if (sub === 'edit') {
      if (!name) {
        fail('Укажи имя: jd snip edit <имя>');
        return;
      }
      const snip = snippets.get(name);
      const next = await editInEditor(name, snip?.body ?? '');
      if (next === null) return;
      const trimmed = next.replace(/\r?\n$/, '');
      if (!trimmed.trim()) {
        fail('Пустой текст — не сохраняю.');
        return;
      }
      snippets.upsert({ name, body: trimmed, lang: snip?.lang ?? 'text', tags: snip?.tags ?? '' });
      ok(`Сохранён ${paint(name, bold(), fg(C.accent))}`);
      return;
    }

    if (sub === 'rm' || sub === 'remove' || sub === 'del') {
      if (!name) {
        fail('Укажи имя: jd snip rm <имя>');
        return;
      }
      if (!snippets.get(name)) {
        fail(`Сниппет "${name}" не найден.`);
        return;
      }
      if (isInteractive() && !(await confirm(`Удалить сниппет "${name}"?`, false))) {
        info('Отменено.');
        return;
      }
      snippets.remove(name);
      ok(`Удалён ${name}`);
      return;
    }

    fail(`Неизвестное действие "${sub}".`, 'Доступно: add, ls, show, copy, edit, rm');
  },
} satisfies Command;
