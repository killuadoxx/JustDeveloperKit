// jd alias — свои короткие имена для команд: `jd d` → `jd run dev`.
//
// Правило простое: встроенные команды всегда важнее. Если имя занято командой,
// алиас молчит, и команда честно об этом говорит.

import { parseArgs } from '../core/args.ts';
import { loadAliases, removeAlias, RESERVED, setAlias, tokenize } from '../core/alias.ts';
import { fail, info, ok } from '../core/help.ts';
import { confirm, isInteractive } from '../core/input.ts';
import { findCommand, loadCommands } from '../core/registry.ts';
import { C, bold, fg, paint } from '../core/theme.ts';
import { table } from '../core/ui.ts';
import type { Command } from '../core/registry.ts';

/** Занято ли имя встроенной или обычной командой. */
async function isTaken(name: string): Promise<string | null> {
  if (RESERVED.includes(name)) return `встроенная команда jd ${name}`;
  const commands = await loadCommands();
  const found = findCommand(commands, name);
  return found ? `команда jd ${found.name}` : null;
}

export default {
  name: 'alias',
  aliases: ['aliases', 'abbr'],
  group: 'Система',
  title: 'Короткие имена',
  desc: 'Свои псевдонимы для команд: jd d → jd run dev',
  usage: 'jd alias [list|add <имя> <команда>|remove <имя>]',
  examples: ['jd alias', 'jd alias add d "run dev"', 'jd alias add gs "git status"', 'jd alias remove d'],

  async run({ argv }) {
    const args = parseArgs(argv, { yes: 'boolean' });
    const sub = (args._[0] ?? '').toLowerCase();
    const aliases = loadAliases();

    if (sub === 'add' || sub === 'set') {
      const name = args._[1] ?? '';
      const value = args._.slice(2).join(' ').trim();
      if (!name || !value) {
        fail('Нужно имя и команда.', 'jd alias add d "run dev"');
        return;
      }
      if (!/^[\w.-]+$/.test(name)) {
        fail(`Имя «${name}» не годится.`, 'Только буквы, цифры, точка, дефис и подчёркивание.');
        return;
      }
      const taken = await isTaken(name);
      if (taken) {
        fail(`Имя «${name}» занято: ${taken}.`, 'Алиас срабатывает только вместо неизвестной команды — выбери другое имя.');
        return;
      }
      const words = tokenize(value);
      if (!words.length) {
        fail('Пустая команда.');
        return;
      }
      setAlias(name, value);
      ok(`Алиас сохранён: jd ${name} → ${words.join(' ')}`);
      process.stdout.write(paint(`  проверь: jd ${name}\n\n`, fg(C.faint)));
      return;
    }

    if (sub === 'remove' || sub === 'rm' || sub === 'delete') {
      const name = args._[1] ?? '';
      if (!name) {
        fail('Какое имя убрать?', `Есть: ${Object.keys(aliases).join(', ') || '—'}`);
        return;
      }
      if (!removeAlias(name)) {
        fail(`Алиаса «${name}» нет.`);
        return;
      }
      ok(`Алиас «${name}» удалён.`);
      return;
    }

    if (sub === 'clear') {
      const names = Object.keys(aliases);
      if (!names.length) {
        info('Алиасов нет.');
        return;
      }
      if (!args.flags.yes && isInteractive() && !(await confirm(`Удалить все алиасы (${names.length})?`, false))) {
        info('Отменено.');
        return;
      }
      const { saveAliases } = await import('../core/alias.ts');
      saveAliases({});
      ok(`Удалено алиасов: ${names.length}.`);
      return;
    }

    const names = Object.keys(aliases).sort();
    if (!names.length) {
      process.stdout.write('\n');
      info('Алиасов пока нет.');
      process.stdout.write(
        paint('  пример: ', fg(C.faint)) +
          paint('jd alias add d "run dev"', fg(C.cyan)) +
          paint('   — после этого jd d запускает команду проекта dev\n\n', fg(C.muted)),
      );
      return;
    }

    process.stdout.write(
      '\n' +
        table(
          ['ИМЯ', 'ЧТО ЗАПУСКАЕТ', 'ВЫЗОВ'],
          names.map((name) => {
            const value = aliases[name];
            return [
              paint(name, bold(), fg(C.accent)),
              paint(value, fg(C.text)),
              paint(`jd ${tokenize(value).join(' ')}`, fg(C.faint)),
            ];
          }),
        ) +
        '\n',
    );
    process.stdout.write(
      paint('  добавить: jd alias add <имя> "<команда>"', fg(C.faint)) +
        paint('   удалить: jd alias remove <имя>\n', fg(C.faint)) +
        paint('  встроенные команды всегда важнее алиаса — как в git\n\n', fg(C.faint)),
    );
  },
} satisfies Command;
