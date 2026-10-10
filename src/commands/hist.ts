// jd hist — история запусков команд проекта: что падало, сколько длится, что чаще.
//
// Данные пишет сам jd при каждом запуске команды из .me.json (и из меню тоже),
// поэтому история набирается сама, без отдельной «записи в дневник».

import path from 'node:path';
import { flagBool, flagNum, parseArgs } from '../core/args.ts';
import { fail, info, ok } from '../core/help.ts';
import { confirm, isInteractive } from '../core/input.ts';
import { loadProject, ME_FILE } from '../core/project.ts';
import { failingStats, projectRuns, runStats, type RunStat } from '../core/runs.ts';
import { history } from '../core/store.ts';
import { C, bold, fg, paint } from '../core/theme.ts';
import { bar, box, table, truncate } from '../core/ui.ts';
import { formatMs, num, timeAgo } from '../core/util.ts';
import type { Command } from '../core/registry.ts';

function mark(ok: boolean): string {
  return ok ? paint('✔', bold(), fg(C.ok)) : paint('✖', bold(), fg(C.err));
}

function printStats(stats: RunStat[], total: number): void {
  const maxRuns = Math.max(1, ...stats.map((s) => s.runs));
  process.stdout.write(
    '\n' +
      table(
        ['КОМАНДА', 'ЗАПУСКОВ', 'ПАДЕНИЙ', 'СРЕДНЕЕ', 'ПОСЛЕДНИЙ', '', ''],
        stats.map((stat) => [
          paint(truncate(stat.title, 28), bold(), fg(C.text)),
          paint(num(stat.runs), fg(C.info)),
          stat.fails ? paint(num(stat.fails), fg(C.err)) : paint('—', fg(C.faint)),
          paint(stat.avgMs ? formatMs(stat.avgMs) : '—', fg(C.soft)),
          paint(timeAgo(stat.lastAt), fg(C.muted)) + ' ' + mark(stat.lastOk),
          bar(stat.runs, maxRuns, 12, C.primary),
          stat.lastOk ? '' : paint('падает', fg(C.warn)),
        ]),
        { align: ['left', 'right', 'right', 'right', 'left', 'left', 'left'] },
      ) +
      '\n',
  );
  process.stdout.write(
    paint(`  всего запусков: ${num(total)}`, fg(C.muted)) +
      paint(`   команд в истории: ${stats.length}`, fg(C.faint)) +
      paint(`   подробнее: jd hist <команда>\n`, fg(C.faint)),
  );
}

function printRecent(runs: ReturnType<typeof projectRuns>, limit: number): void {
  const shown = runs.slice(0, limit);
  process.stdout.write(
    '\n' +
      table(
        ['КОГДА', 'КОМАНДА', 'ЧТО ЗАПУСКАЛОСЬ', 'ВРЕМЯ', ''],
        shown.map((row) => [
          paint(new Date(row.created_at).toLocaleString('ru-RU'), fg(C.muted)),
          paint(truncate(row.title, 24), fg(C.text)),
          paint(truncate(row.payload, 44), fg(C.faint)),
          paint(formatMs(row.ms), fg(row.ok ? C.soft : C.warn)),
          mark(Boolean(row.ok)),
        ]),
      ) +
      '\n',
  );
}

export default {
  name: 'hist',
  aliases: ['history', 'runs'],
  group: 'Разработка',
  title: 'История запусков',
  desc: 'Что запускалось, что падало и сколько длится — по командам проекта',
  usage: 'jd hist [команда] [--limit=15] [--fails] [--all] [--json] [--clear]',
  examples: [
    'jd hist',
    'jd hist dev',
    'jd hist --fails',
    'jd hist --all --limit=30',
    'jd hist --clear',
  ],

  async run({ argv, cwd }) {
    const args = parseArgs(argv, { limit: 'number', fails: 'boolean', all: 'boolean', json: 'boolean', clear: 'boolean', yes: 'boolean' });
    const limit = Math.max(1, flagNum(args, 'limit', 15));

    const local = await loadProject(cwd);
    const dir = local.status === 'ok' ? local.project.dir : path.resolve(cwd);

    if (flagBool(args, 'clear')) {
      const rows = projectRuns(dir);
      if (!rows.length) {
        info('История этого проекта и так пуста.');
        return;
      }
      if (!flagBool(args, 'yes') && isInteractive()) {
        const go = await confirm(`Удалить историю запусков (${rows.length} записей) для ${dir}?`, false);
        if (!go) {
          info('Отменено.');
          return;
        }
      }
      // Чистим только этот проект: чужая история не наше дело.
      const removed = history.clearContext('project', path.resolve(dir));
      ok(`История очищена: ${removed} записей.`);
      return;
    }

    if (flagBool(args, 'all')) {
      const rows = history.all(Math.max(limit, 1));
      if (flagBool(args, 'json')) {
        process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
        return;
      }
      if (!rows.length) {
        info('История пуста.');
        return;
      }
      process.stdout.write('\n');
      printRecent(
        rows.map((row) => ({ ...row })),
        limit,
      );
      return;
    }

    const runs = projectRuns(dir);
    const stats = runStats(dir, runs);
    const name = args._[0] ?? '';

    if (flagBool(args, 'json')) {
      process.stdout.write(
        JSON.stringify(
          {
            project: local.status === 'ok' ? local.project.config.projectName : path.basename(dir),
            dir,
            stats: name ? stats.filter((s) => s.title === name) : stats,
            recent: (name ? runs.filter((r) => r.title === name) : runs).slice(0, limit),
          },
          null,
          2,
        ) + '\n',
      );
      return;
    }

    if (local.status === 'missing') {
      info(`В этой папке нет ${ME_FILE} — истории команд проекта тоже нет.`);
      process.stdout.write(paint('  создать конфиг: jd init\n', fg(C.faint)));
    }

    if (!runs.length) {
      info('Пока пусто: jd записывает запуски команд проекта, начиная с первого.');
      process.stdout.write(paint('  запусти что-нибудь: jd run\n\n', fg(C.faint)));
      return;
    }

    if (name) {
      const matching = stats.filter((s) => s.title.toLowerCase().includes(name.toLowerCase()));
      if (!matching.length) {
        fail(`В истории нет команды «${name}».`, `Есть: ${stats.map((s) => s.title).join(', ')}`);
        return;
      }
      const stat = matching[0];
      const rows = runs.filter((r) => r.title === stat.title);
      process.stdout.write(
        '\n' +
          box(
            [
              paint(stat.title, bold(), fg(C.text)),
              '',
              paint('запусков   ', fg(C.muted)) + paint(num(stat.runs), fg(C.info)) + paint(`   из них с ошибкой: ${num(stat.fails)}`, fg(stat.fails ? C.err : C.faint)),
              paint('среднее    ', fg(C.muted)) + paint(stat.avgMs ? formatMs(stat.avgMs) : '—', fg(C.soft)),
              paint('последний  ', fg(C.muted)) + paint(`${timeAgo(stat.lastAt)} · ${formatMs(stat.lastMs)} `, fg(C.soft)) + mark(stat.lastOk),
              paint('команда    ', fg(C.muted)) + paint(stat.lastCmd || '—', fg(C.cyan)),
            ],
            { title: paint(`⏱  ${stat.title}`, bold(), fg(C.accent)) },
          ) +
          '\n',
      );
      printRecent(rows, limit);
      return;
    }

    printStats(stats, runs.length);

    const failing = failingStats(stats);
    if (failing.length) {
      process.stdout.write('\n  ' + paint('что болит', bold(), fg(C.accent)) + '\n');
      for (const stat of failing.slice(0, 5)) {
        process.stdout.write(
          '   ' +
            paint('✖ ', fg(C.err)) +
            paint(stat.title, fg(C.text)) +
            paint(`  падений ${stat.fails} из ${stat.runs}`, fg(C.muted)) +
            paint(`  последний ${timeAgo(stat.lastAt)}`, fg(C.faint)) +
            '\n',
        );
      }
    }

    if (flagBool(args, 'fails')) {
      process.stdout.write('\n  ' + paint('только падения', bold(), fg(C.accent)) + '\n');
      printRecent(runs.filter((r) => !r.ok), limit);
      return;
    }

    process.stdout.write('\n  ' + paint('последние запуски', bold(), fg(C.accent)) + '\n');
    printRecent(runs, limit);
  },
} satisfies Command;
