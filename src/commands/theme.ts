// jd theme — темы оформления: посмотреть, примерить, выбрать.

import { flagBool, flagStr, parseArgs } from '../core/args.ts';
import { fail, info, ok } from '../core/help.ts';
import { confirm, isInteractive, selectList } from '../core/input.ts';
import { neonBanner } from '../core/neon.ts';
import { kv as dbKv } from '../core/store.ts';
import { C, bold, fg, paint } from '../core/theme.ts';
import { applyTheme, currentTheme, currentThemeId, findTheme, THEMES, withTheme, DEFAULT_THEME, type Theme } from '../core/themes.ts';
import { badge, bar, box, dot, kv, sparkline, table } from '../core/ui.ts';
import type { Command } from '../core/registry.ts';

export const THEME_KEY = 'theme';

/** Цветовая полоса темы — рисуется её собственными цветами, даже если активна другая. */
export function strip(theme: Theme, size = 10): string {
  const stops = [
    theme.colors.primary,
    theme.colors.accent,
    theme.colors.ok,
    theme.colors.warn,
    theme.colors.err,
    theme.colors.info,
    theme.neon.pink,
    theme.neon.violet,
    theme.neon.cyan,
    theme.neon.lime,
  ].slice(0, size);
  return stops.map((hex) => paint('▇', fg(hex))).join('');
}

/** Компактный образец: как тема выглядит в бою. */
export function themeSample(): string {
  const out: string[] = [];
  const line = (s = ''): void => void out.push('  ' + s);

  line(strip(currentTheme(), 10) + paint('  ' + currentTheme().icon + ' ' + currentTheme().title, bold(), fg(C.text)));
  line();

  line(
    kv([
      ['текст', paint('обычный текст интерфейса', fg(C.text))],
      ['мягкий', paint('второстепенный текст', fg(C.soft))],
      ['тихий', paint('подсказки и единицы измерения', fg(C.muted))],
      ['контур', paint('рамки, разделители, пустые ячейки', fg(C.faint))],
    ]),
  );
  line();

  line(
    paint('состояния  ', fg(C.muted)) +
      badge('OK', C.ok) + ' ' + badge('WARN', C.warn) + ' ' + badge('ERR', C.err) + '  ' +
      dot(C.ok) + ' ' + paint('работает', fg(C.ok)) +
      paint('   ') + dot(C.warn) + ' ' + paint('занято', fg(C.warn)) +
      paint('   ') + dot(C.err) + ' ' + paint('упало', fg(C.err)),
  );
  line();

  line(paint('шум генератора ', fg(C.muted)) + sparkline([2, 5, 3, 8, 6, 9, 4, 7, 5, 8, 3, 6, 9, 2], C.info));
  line(paint('заполнение     ', fg(C.muted)) + bar(62, 100, 22, C.primary) + paint('  62%', fg(C.muted)));
  line();

  line(
    box(
      [
        paint('Сборка прошла ', fg(C.text)) + paint('успешно', bold(), fg(C.ok)) + paint(' за 1.4 с', fg(C.muted)),
        paint('→ ', fg(C.accent)) + paint('jd store install grammy', fg(C.info)),
      ],
      { title: paint('пример блока', bold(), fg(C.accent)) },
    ).split('\n').join('\n  '),
  );
  line();

  line(
    table(
      ['ЧТО', 'ЗНАЧЕНИЕ'],
      [
        [paint('Node', fg(C.text)), paint(process.version, fg(C.info))],
        [paint('Тема', fg(C.text)), paint(currentTheme().title, fg(C.accent))],
        [paint('Портов занято', fg(C.text)), paint('2', bold(), fg(C.warn))],
      ],
    ).split('\n').join('\n  '),
  );
  return out.join('\n');
}

function printList(): void {
  const rows = THEMES.map((theme) => {
    const active = currentThemeId() === theme.id;
    return [
      paint(active ? '●' : '·', fg(active ? C.ok : C.faint)),
      strip(theme) + ' ' + theme.icon,
      paint(theme.id, active ? bold() : '', fg(active ? C.text : C.soft)),
      paint(theme.title, active ? bold() : '', fg(active ? C.accent : C.text)),
      paint(theme.desc, fg(C.muted)),
    ];
  });
  process.stdout.write('\n' + table(['', 'ЦВЕТА', 'ID', 'ТЕМА', 'ОПИСАНИЕ'], rows) + '\n');
  process.stdout.write(
    paint(`\n  активна: `, fg(C.muted)) +
      paint(currentTheme().icon + ' ' + currentTheme().title, bold(), fg(C.accent)) +
      paint(`   JD_THEME=${currentThemeId()} переопределит тему на один запуск\n`, fg(C.faint)),
  );
  process.stdout.write(paint(`  сменить: jd theme set <id>   либо просто jd theme\n\n`, fg(C.faint)));
}

async function runPicker(): Promise<void> {
  const items = THEMES.map((theme) => ({
    label: theme.icon + ' ' + theme.title,
    hint: theme.desc,
    // Полоса рисуется цветами самой темы — видно до применения.
    group: '',
    theme,
  })).map((item) => ({ ...item, label: item.label + '  ' + strip(item.theme, 6) }));

  const picked = await selectList(
    items.map((i) => ({ label: i.label, hint: i.hint })),
    { title: '🎨 Тема оформления', subtitle: 'примерь и оставь ту, что радует глаз' },
  );
  if (picked === null) return;

  const theme = THEMES[picked];
  const was = currentThemeId();
  applyTheme(theme.id);
  process.stdout.write('\n' + neonBanner({ subtitle: 'Just Developer Kit', version: undefined, reflection: false }) + '\n\n');
  process.stdout.write(themeSample() + '\n\n');

  if (theme.id === was) {
    ok(`Тема «${theme.title}» уже активна.`);
    return;
  }
  const keep = await confirm(`Оставить тему «${theme.title}»?`, true);
  if (!keep) {
    applyTheme(was);
    process.stdout.write(paint(`  вернул прежнюю тему\n\n`, fg(C.muted)));
    return;
  }
  dbKv.set(THEME_KEY, theme.id);
  ok(`Тема «${theme.title}» сохранена.`);
}

export default {
  name: 'theme',
  aliases: ['themes', 'тема'],
  group: 'Система',
  title: 'Тема оформления',
  desc: '7 палитр интерфейса с живым предпросмотром',
  usage: 'jd theme [list|set <id>|reset|show] [--preview=<id>]',
  examples: ['jd theme', 'jd theme list', 'jd theme set matrix', 'jd theme set neon', 'jd theme reset'],

  async run({ argv }) {
    const args = parseArgs(argv, { preview: 'string', json: 'boolean', all: 'boolean' });
    const known = new Set(['list', 'ls', 'show', 'current', 'set', 'use', 'reset', 'default']);
    const sub = (args._[0] ?? '').toLowerCase();
    // Голая тема аргументом ("jd theme matrix") — это предпросмотр, а не подкоманда.
    const bare = known.has(sub) ? '' : args._[0] ?? '';
    // "jd theme show sunset" — тема приходит вторым словом.
    const named = sub === 'show' || sub === 'current' ? args._[1] ?? '' : '';
    const requested = flagStr(args, 'preview', '') || bare || named;

    // jd theme set <id>
    if (sub === 'set' || sub === 'use') {
      const id = args._[1] ?? '';
      const theme = findTheme(id);
      if (!theme) {
        fail(`Тема "${id}" не найдена.`, `Есть такие: ${THEMES.map((t) => t.id).join(', ')}`);
        return;
      }
      applyTheme(theme.id);
      dbKv.set(THEME_KEY, theme.id);
      process.stdout.write('\n');
      ok(`Тема «${theme.title}» ${theme.icon} активна и сохранена.`);
      process.stdout.write(paint('  посмотреть образец: jd theme show\n\n', fg(C.faint)));
      return;
    }

    if (sub === 'reset' || sub === 'default') {
      applyTheme(DEFAULT_THEME);
      dbKv.set(THEME_KEY, DEFAULT_THEME);
      ok(`Вернул тему по умолчанию — «${currentTheme().title}».`);
      return;
    }

    if (sub === 'show' || sub === 'current' || requested) {
      const theme = requested ? findTheme(requested) : currentTheme();
      if (!theme) {
        fail(`Тема "${requested}" не найдена.`, `Есть такие: ${THEMES.map((t) => t.id).join(', ')}`);
        return;
      }
      withTheme(theme.id, () => {
        process.stdout.write('\n' + neonBanner({ subtitle: 'Just Developer Kit', reflection: false }) + '\n\n');
        process.stdout.write(themeSample() + '\n');
      });
      if (!requested) info(`активная тема: ${theme.id} · сменить: jd theme`);
      process.stdout.write('\n');
      return;
    }

    if (sub === 'list' || sub === 'ls' || flagBool(args, 'all') || !isInteractive()) {
      printList();
      return;
    }

    await runPicker();
  },
} satisfies Command;
