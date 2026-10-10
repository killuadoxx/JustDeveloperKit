// jd cron — что означает расписание и когда оно сработает в следующий раз.

import { flagBool, flagNum, parseArgs } from '../core/args.ts';
import { CronError, describeCron, nextRuns, parseCron } from '../core/cron.ts';
import { fail, info } from '../core/help.ts';
import { C, bold, fg, paint } from '../core/theme.ts';
import { box, table } from '../core/ui.ts';
import { formatDuration, formatMs, num } from '../core/util.ts';
import type { Command } from '../core/registry.ts';

const PRESETS: [string, string][] = [
  ['*/5 * * * *', 'каждые 5 минут'],
  ['0 * * * *', 'каждый час'],
  ['0 3 * * *', 'каждую ночь в 03:00'],
  ['0 9 * * 1-5', 'по будням в 09:00'],
  ['0 0 1 * *', 'первое число месяца'],
  ['@daily', 'то же, что 0 0 * * *'],
];

function formatWhen(date: Date): string {
  return date.toLocaleString('ru-RU', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default {
  name: 'cron',
  aliases: ['crontab', 'schedule'],
  group: 'Разработка',
  title: 'Cron-расписание',
  desc: 'Объясняет выражение словами и показывает следующие запуски',
  usage: 'jd cron "<выражение>" [--count=5] [--json]',
  examples: ['jd cron "*/15 * * * *"', 'jd cron "0 3 * * 1-5"', 'jd cron "@daily" --count=3', 'jd cron'],

  async run({ argv }) {
    const args = parseArgs(argv, { count: 'number', json: 'boolean' });
    const count = Math.max(1, Math.min(flagNum(args, 'count', 5), 50));
    const source = args._.join(' ').trim();

    if (!source) {
      process.stdout.write('\n  ' + paint('Что такое cron', bold(), fg(C.accent)) + '\n');
      process.stdout.write(
        paint('  пять полей: минута час день-месяца месяц день-недели\n', fg(C.muted)) +
          paint('  пример: ', fg(C.faint)) + paint('jd cron "0 9 * * 1-5"', fg(C.cyan)) +
          paint('   — по будням в 09:00\n\n', fg(C.muted)),
      );
      process.stdout.write(
        table(
          ['ВЫРАЖЕНИЕ', 'СМЫСЛ'],
          PRESETS.map(([expr, meaning]) => [paint(expr, bold(), fg(C.text)), paint(meaning, fg(C.muted))]),
        ) + '\n\n',
      );
      return;
    }

    let expr;
    try {
      expr = parseCron(source);
    } catch (err) {
      const message = err instanceof CronError ? err.message : (err as Error).message;
      fail(`Не понял выражение: ${message}`, 'Пример: jd cron "*/15 9-18 * * 1-5" или jd cron "@daily"');
      return;
    }

    const runs = nextRuns(expr, count);

    if (flagBool(args, 'json')) {
      process.stdout.write(
        JSON.stringify(
          {
            expression: expr.source,
            meaning: describeCron(expr),
            fields: {
              minute: [...expr.minute.values].sort((a, b) => a - b),
              hour: [...expr.hour.values].sort((a, b) => a - b),
              dayOfMonth: [...expr.dayOfMonth.values].sort((a, b) => a - b),
              month: [...expr.month.values].sort((a, b) => a - b),
              dayOfWeek: [...expr.dayOfWeek.values].sort((a, b) => a - b),
            },
            next: runs.map((run) => ({ at: run.date.toISOString(), inMs: run.msFromNow })),
          },
          null,
          2,
        ) + '\n',
      );
      return;
    }

    process.stdout.write(
      '\n' +
        box(
          [
            paint(source, bold(), fg(C.accent)),
            '',
            ...describeCron(expr).map((line) => paint('• ', fg(C.warn)) + paint(line, fg(C.text))),
          ],
          { title: paint('⏰ Расписание', bold(), fg(C.accent)) },
        ) +
        '\n',
    );

    if (!runs.length) {
      info('За год вперёд срабатываний не нашлось — проверь выражение (например, 30 февраля не существует).');
      return;
    }

    process.stdout.write(
      '\n' +
        table(
          ['КОГДА', 'ЧЕРЕЗ', ''],
          runs.map((run, index) => [
            paint(formatWhen(run.date), fg(index === 0 ? C.text : C.soft)),
            paint(run.msFromNow < 60_000 ? formatMs(run.msFromNow) : formatDuration(run.msFromNow), fg(C.muted)),
            index === 0 ? paint('← следующий', fg(C.ok)) : '',
          ]),
        ) +
        '\n',
    );
    process.stdout.write(paint(`  всего показано: ${num(runs.length)}   больше: jd cron "${source}" --count=20\n\n`, fg(C.faint)));
  },
} satisfies Command;
