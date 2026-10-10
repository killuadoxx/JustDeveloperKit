// jd env — что не так с переменными окружения и как это починить.
//
// Смысл: приложение падает на старте из-за пустой переменной, а понять это
// можно только сравнив .env с .env.example. Секреты при показе маскируются.

import { flagBool, parseArgs } from '../core/args.ts';
import {
  ENV_EXAMPLE,
  ENV_FILE,
  envDiff,
  fillEnvFromExample,
  fillExampleFromEnv,
  maskValue,
  type EnvDiff,
} from '../core/env.ts';
import { fail, info, ok } from '../core/help.ts';
import { confirm, isInteractive } from '../core/input.ts';
import { ensureGitignored } from '../core/market.ts';
import { C, bold, fg, paint } from '../core/theme.ts';
import { box, table, truncate } from '../core/ui.ts';
import { countOf } from '../core/util.ts';
import type { Command } from '../core/registry.ts';

const KEYS_FORMS = ['переменная', 'переменные', 'переменных'] as const;

function levelLine(okFlag: boolean, text: string, hint = ''): string {
  const mark = okFlag ? paint('✔', bold(), fg(C.ok)) : paint('✖', bold(), fg(C.err));
  return `${mark} ${text}${hint ? paint('   ' + hint, fg(C.faint)) : ''}`;
}

/** Карточка состояния: что есть, чего нет. */
export function stateCard(diff: EnvDiff): string {
  const lines: string[] = [];
  lines.push(
    levelLine(
      diff.hasEnv,
      paint(`${ENV_FILE}: `, fg(C.muted)) + paint(diff.hasEnv ? countOf(diff.env.length, KEYS_FORMS) : 'файла нет', fg(diff.hasEnv ? C.text : C.err)),
    ),
  );
  lines.push(
    levelLine(
      diff.hasExample,
      paint(`${ENV_EXAMPLE}: `, fg(C.muted)) +
        paint(diff.hasExample ? countOf(diff.example.length, KEYS_FORMS) : 'файла нет', fg(diff.hasExample ? C.text : C.warn)),
      diff.hasExample ? '' : 'создать шаблон: jd env --example',
    ),
  );
  if (diff.hasEnv && diff.empty.length) {
    lines.push(
      levelLine(false, paint('без значения: ', fg(C.muted)) + paint(diff.empty.join(', '), fg(C.warn)), 'приложение может упасть на старте'),
    );
  }
  return box(lines, { title: paint('🔐 Переменные окружения', bold(), fg(C.accent)) });
}

function namesTable(title: string, keys: string[], color: string, hint: string): string {
  if (!keys.length) return '';
  const rows = keys.map((key) => [
    paint(key, bold(), fg(color)),
    paint(hint, fg(C.faint)),
  ]);
  return (
    '\n  ' + paint(title, bold(), fg(C.accent)) + '\n' +
    table(['ПЕРЕМЕННАЯ', ''], rows).split('\n').map((l) => '  ' + l).join('\n') + '\n'
  );
}

export default {
  name: 'env',
  aliases: ['dotenv', 'environ'],
  group: 'Разработка',
  title: 'Переменные окружения',
  desc: '.env против .env.example: чего не хватает, что лишнее, как починить',
  usage: 'jd env [--init] [--example] [--show] [--json]',
  examples: [
    'jd env',
    'jd env --init        (дописать в .env недостающее из .env.example)',
    'jd env --example     (наоборот: ключи из .env добавить в пример)',
    'jd env --show        (значения, секреты замаскированы)',
  ],

  async run({ argv, cwd }) {
    const args = parseArgs(argv, { init: 'boolean', example: 'boolean', show: 'boolean', json: 'boolean', yes: 'boolean' });
    const diff = envDiff(cwd);

    if (flagBool(args, 'json')) {
      process.stdout.write(
        JSON.stringify(
          {
            dir: diff.dir,
            hasEnv: diff.hasEnv,
            hasExample: diff.hasExample,
            missing: diff.missing,
            extra: diff.extra,
            empty: diff.empty,
            keys: diff.env.map((p) => ({ key: p.key, masked: maskValue(p.key, p.value), empty: !p.value })),
          },
          null,
          2,
        ) + '\n',
      );
      return;
    }

    if (!diff.hasEnv && !diff.hasExample) {
      fail('Нет ни .env, ни .env.example.', 'Создать пример: jd preset apply api-rest — или вручную: .env.example с ключами.');
      return;
    }

    if (flagBool(args, 'init')) {
      if (!diff.hasExample) {
        fail(`Нет ${ENV_EXAMPLE} — не из чего собирать.`, `Создай ${ENV_EXAMPLE} с нужными ключами и повтори.`);
        return;
      }
      if (!diff.missing.length && diff.hasEnv) {
        info(`${ENV_FILE} уже содержит все переменные из примера.`);
        return;
      }
      if (!diff.hasEnv && isInteractive() && !flagBool(args, 'yes')) {
        const go = await confirm(`Создать ${ENV_FILE} из ${ENV_EXAMPLE}? Значения из примера — обычно пустые.`, true);
        if (!go) {
          info('Отменено.');
          return;
        }
      }
      const result = fillEnvFromExample(cwd, diff);
      ok(result.created ? `${ENV_FILE} создан: ${countOf(result.added.length, KEYS_FORMS)}.` : `В ${ENV_FILE} добавлено: ${countOf(result.added.length, KEYS_FORMS)}.`);
      for (const key of result.added) process.stdout.write('   ' + paint('+ ', fg(C.ok)) + paint(key, fg(C.text)) + '\n');
      if (ensureGitignored(cwd)) info(`${ENV_FILE} добавлен в .gitignore — секреты не уедут в репозиторий`);
      process.stdout.write(paint('  заполни значения: jd env --show\n\n', fg(C.faint)));
      return;
    }

    if (flagBool(args, 'example')) {
      if (!diff.extra.length) {
        info(`В ${ENV_EXAMPLE} уже есть всё, что используется в ${ENV_FILE}.`);
        return;
      }
      const result = fillExampleFromEnv(cwd, diff);
      ok(`В ${ENV_EXAMPLE} добавлено: ${countOf(result.added.length, KEYS_FORMS)} (значения пустые — это шаблон).`);
      for (const key of result.added) process.stdout.write('   ' + paint('+ ', fg(C.ok)) + paint(key, fg(C.text)) + '\n');
      return;
    }

    process.stdout.write('\n' + stateCard(diff) + '\n');

    if (!diff.hasEnv) {
      process.stdout.write(paint(`\n  создать ${ENV_FILE} из примера: jd env --init\n\n`, fg(C.faint)));
      return;
    }

    if (diff.missing.length) {
      process.stdout.write(namesTable(`НЕ ХВАТАЕТ В ${ENV_FILE}`, diff.missing, C.err, 'есть в примере, нет у тебя — частая причина падения на старте'));
      process.stdout.write(paint('  дописать одной командой: jd env --init\n', fg(C.faint)));
    } else if (diff.hasExample) {
      process.stdout.write('\n  ' + paint('✔ ', fg(C.ok)) + paint(`${ENV_FILE} покрывает все ключи из примера`, fg(C.text)) + '\n');
    }

    if (diff.extra.length) {
      process.stdout.write(namesTable(`ЕСТЬ ТОЛЬКО В ${ENV_FILE}`, diff.extra, C.warn, `стоит добавить в ${ENV_EXAMPLE}, чтобы не забыть при новом клоне`));
      process.stdout.write(paint('  добавить в пример: jd env --example\n', fg(C.faint)));
    }

    if (flagBool(args, 'show') || !diff.missing.length) {
      process.stdout.write(
        '\n  ' +
          paint(`ЗНАЧЕНИЯ (${ENV_FILE})`, bold(), fg(C.accent)) +
          paint('   секреты замаскированы', fg(C.faint)) +
          '\n' +
          table(
            ['ПЕРЕМЕННАЯ', 'ЗНАЧЕНИЕ'],
            diff.env.map((pair) => [
              paint(pair.key, fg(C.text)),
              pair.value ? paint(truncate(maskValue(pair.key, pair.value), 52), fg(C.soft)) : paint('(пусто)', fg(C.warn)),
            ]),
          )
            .split('\n')
            .map((l) => '  ' + l)
            .join('\n') +
          '\n',
      );
    } else {
      process.stdout.write(paint('  показать значения: jd env --show\n', fg(C.faint)));
    }

    process.stdout.write('\n');
  },
} satisfies Command;
