// jd note / jd todo — быстрые заметки и задачи, чтобы не терять мысли.

import { parseArgs } from '../core/args.ts';
import { fail, info, ok } from '../core/help.ts';
import { confirm, isInteractive } from '../core/input.ts';
import { copyToClipboard } from '../core/shell.ts';
import { notes, todos } from '../core/store.ts';
import { C, bold, fg, paint } from '../core/theme.ts';
import { table, truncate } from '../core/ui.ts';
import { timeAgo } from '../core/util.ts';
import type { Command } from '../core/registry.ts';

export const note: Command = {
  name: 'note',
  aliases: ['n'],
  group: 'Заметки',
  title: 'Заметки',
  desc: 'Записать мысль, найти её, скопировать',
  usage: 'jd note [текст] | jd note ls [фильтр] | jd note rm <id>',
  examples: ['jd note "спросить у Димы про доступы"', 'jd note ls доступы', 'jd note rm 4'],

  async run({ argv }) {
    const args = parseArgs(argv);
    const sub = args._[0];

    if (!sub || sub === 'ls' || sub === 'list' || sub === 'search') {
      const query = args._.slice(1).join(' ') || '';
      const items = query ? notes.search(query) : notes.all();
      if (!items.length) {
        info('Заметок пока нет. Добавь: jd note "текст"');
        return;
      }
      process.stdout.write(
        '\n' +
          table(
            ['ID', 'КОГДА', 'ЗАМЕТКА'],
            items.map((n) => [
              paint(String(n.id), fg(C.faint)),
              paint(timeAgo(n.created_at), fg(C.muted)),
              paint(truncate(n.body, 100), fg(C.text)),
            ]),
            { align: ['right', 'left', 'left'] },
          ) +
          '\n\n',
      );
      return;
    }

    if (sub === 'rm' || sub === 'del' || sub === 'remove') {
      const id = Number(args._[1]);
      if (!Number.isFinite(id)) {
        fail('Укажи номер заметки: jd note rm <id>');
        return;
      }
      if (isInteractive() && !(await confirm(`Удалить заметку ${id}?`, false))) {
        info('Отменено.');
        return;
      }
      if (notes.remove(id)) ok(`Удалена заметка ${id}`);
      else fail(`Заметка ${id} не найдена.`);
      return;
    }

    if (sub === 'copy') {
      const id = Number(args._[1]);
      const found = notes.all(500).find((n) => n.id === id);
      if (!found) {
        fail(`Заметка ${id} не найдена.`);
        return;
      }
      ok((await copyToClipboard(found.body)) ? 'Скопировано в буфер обмена' : 'Не удалось скопировать');
      return;
    }

    const body = args._.join(' ');
    if (!body.trim()) {
      fail('Пустая заметка.', 'Например: jd note "позвонить в банк"');
      return;
    }
    const id = notes.add(body);
    ok(`Заметка ${id} сохранена`);
  },
};

export const todo: Command = {
  name: 'todo',
  aliases: ['t', 'tasks'],
  group: 'Заметки',
  title: 'Задачи',
  desc: 'Список дел на сегодня',
  usage: 'jd todo [текст] | jd todo done <id> | jd todo rm <id> | jd todo clear',
  examples: ['jd todo "починить вебхук"', 'jd todo', 'jd todo done 2', 'jd todo clear'],

  async run({ argv }) {
    const args = parseArgs(argv, { all: 'boolean', a: 'boolean' }, { a: 'all' });
    const sub = args._[0];

    if (sub === 'done' || sub === 'undone' || sub === 'toggle') {
      const id = Number(args._[1]);
      if (!Number.isFinite(id)) {
        fail('Укажи номер задачи: jd todo done <id>');
        return;
      }
      if (todos.toggle(id)) ok(`Задача ${id} переключена`);
      else fail(`Задача ${id} не найдена.`);
      return;
    }

    if (sub === 'rm' || sub === 'del') {
      const id = Number(args._[1]);
      if (!Number.isFinite(id)) {
        fail('Укажи номер задачи: jd todo rm <id>');
        return;
      }
      if (todos.remove(id)) ok(`Задача ${id} удалена`);
      else fail(`Задача ${id} не найдена.`);
      return;
    }

    if (sub === 'clear') {
      const doneItems = todos.all(true).filter((t) => t.done);
      if (!doneItems.length) {
        info('Выполненных задач нет.');
        return;
      }
      for (const item of doneItems) todos.remove(item.id);
      ok(`Убрано выполненных: ${doneItems.length}`);
      return;
    }

    const isList = !sub || sub === 'ls' || sub === 'list';
    if (!isList) {
      const body = args._.join(' ');
      const id = todos.add(body);
      ok(`Задача ${id} добавлена`);
      return;
    }

    const items = todos.all(args.flags.all === true);
    if (!items.length) {
      info('Список пуст. Добавь: jd todo "текст"');
      return;
    }

    const open = items.filter((t) => !t.done).length;
    process.stdout.write(
      '\n' +
        table(
          ['', 'ID', 'ЗАДАЧА', 'ДОБАВЛЕНА'],
          items.map((t) => [
            t.done ? paint('✔', fg(C.ok)) : paint('○', fg(C.warn)),
            paint(String(t.id), fg(C.faint)),
            t.done ? paint(truncate(t.body, 90), fg(C.muted)) : paint(truncate(t.body, 90), fg(C.text)),
            paint(timeAgo(t.created_at), fg(C.faint)),
          ]),
          { align: ['left', 'right', 'left', 'left'], showHeader: false },
        ) +
        '\n',
    );
    process.stdout.write(
      '\n  ' + paint(`открытых: ${open}`, bold(), fg(C.text)) + paint(`   выполнено: ${items.length - open}`, fg(C.muted)) + '\n\n',
    );
  },
};

export default [note, todo];
