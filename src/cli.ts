#!/usr/bin/env node
// jd — Just Developer Kit. Точка входа: разбор аргументов, интерфейс меню, диспетчер команд.

import './core/warnings.ts';

import { existsSync } from 'node:fs';
import { expandAlias, tokenize } from './core/alias.ts';
import { parseArgs } from './core/args.ts';
import { runDashboard, type DashItem, type DashTab } from './core/dashboard.ts';
import { fail, printCommandHelp, printHelp, suggest, VERSION } from './core/help.ts';
import { confirm, isInteractive, promptText } from './core/input.ts';
import {
  commandCwd,
  commandInputs,
  loadProject,
  ME_FILE,
  runProjectCommand,
  type MeCommand,
  type MeInput,
  type ProjectContext,
} from './core/project.ts';
import { findCommand, groupsOf, loadCommands, type Command, type CommandContext } from './core/registry.ts';
import { runStatOf } from './core/runs.ts';
import { menuStatus, type MenuStatus } from './core/status.ts';
import { dbPath, kv } from './core/store.ts';
import { C, bold, fg, paint, setColor } from './core/theme.ts';
import { applyTheme, DEFAULT_THEME, resolveStartupTheme } from './core/themes.ts';
import { clearScreen } from './core/ui.ts';
import { countOf, formatMs, timeAgo } from './core/util.ts';

// Флаг цвета понимаем в любой позиции и вырезаем из аргументов, иначе он
// уедет в разбор как имя команды ("Неизвестная команда --no-color").
let rawArgv = process.argv.slice(2);
if (rawArgv.includes('--no-color')) setColor(false);
else if (rawArgv.includes('--color')) setColor(true);
rawArgv = rawArgv.filter((a) => a !== '--no-color' && a !== '--color');

// Тема применяется до первой отрисовки. Базу не создаём на пустом месте:
// у команд вроде `jd json` не должно появляться ~/.jd только из-за темы.
{
  const saved = existsSync(dbPath()) ? kv.get('theme', DEFAULT_THEME) : DEFAULT_THEME;
  applyTheme(resolveStartupTheme(saved));
}

// Пайп закрылся раньше нас ("jd list | head") — это норма, а не ошибка.
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0);
});

let ALL: Command[] = [];

function builtins(): Command[] {
  return [
    {
      name: 'menu',
      aliases: ['m', 'ui'],
      group: 'Разное',
      title: 'Меню',
      desc: 'Интерфейс с вкладками разделов и поиском',
      run: () => openMenu(),
    },
    {
      name: 'list',
      aliases: ['ls'],
      group: 'Разное',
      title: 'Все команды',
      desc: 'Список команд по разделам',
      run: () => printHelp(ALL),
    },
    {
      name: 'help',
      aliases: ['?'],
      group: 'Разное',
      title: 'Справка',
      desc: 'Подробности о команде',
      usage: 'jd help <команда>',
      examples: ['jd help sys', 'jd help snip'],
      run: ({ args }) => printHelp(ALL, args._[0]),
    },
    {
      name: 'version',
      group: 'Разное',
      title: 'Версия',
      desc: 'Показать версию jd',
      hidden: true,
      run: () => process.stdout.write(`jd ${VERSION}\n`),
    },
  ];
}

async function runCommand(cmd: Command, argv: string[]): Promise<void> {
  const ctx: CommandContext = { args: parseArgs(argv), argv, cwd: process.cwd() };
  try {
    await cmd.run(ctx);
  } catch (err) {
    const error = err as Error;
    fail(`Команда "${cmd.name}" упала: ${error.message}`);
    if (process.env.JD_DEBUG) process.stderr.write((error.stack ?? '') + '\n');
  }
}

/** Пауза «нажми Enter» между меню и результатом команды. */
async function waitForEnter(): Promise<void> {
  if (!isInteractive()) return;
  process.stdout.write('\n' + paint('  Enter — назад в меню', fg(C.faint)));
  await new Promise<void>((resolve) => {
    process.stdin.setRawMode?.(false);
    const onData = (): void => {
      process.stdin.off('data', onData);
      resolve();
    };
    process.stdin.once('data', onData);
    process.stdin.resume();
  });
}

type MenuAction =
  | { kind: 'global'; cmd: Command }
  | { kind: 'project'; entry: MeCommand; project: ProjectContext }
  | { kind: 'info'; text: string; hint?: string };

/** Панель деталей для команды проекта. */
function projectDetail(entry: MeCommand, project: ProjectContext): DashItem['detail'] {
  const detail: DashItem['detail'] = [{ k: 'запуск', v: entry.cmd }];
  if (entry.desc) detail.push({ v: entry.desc });
  detail.push({ k: 'папка', v: commandCwd(entry, project) });
  if (project.config.projectName) detail.push({ k: 'проект', v: project.config.projectName });

  // История запусков: видно, падало ли это раньше и сколько длится.
  const stat = runStatOf(project.dir, entry.name);
  if (stat) {
    detail.push({
      k: 'история',
      v:
        `${countOf(stat.runs, ['запуск', 'запуска', 'запусков'])}` +
        (stat.fails ? ` · падений ${stat.fails}` : '') +
        (stat.avgMs ? ` · в среднем ${formatMs(stat.avgMs)}` : '') +
        `\nпоследний: ${timeAgo(stat.lastAt)} ${stat.lastOk ? '✔' : '✖'}`,
    });
  }

  for (const spec of commandInputs(entry)) {
    const bits = [`--${spec.name}`];
    if (spec.default !== undefined) bits.push(`по умолчанию "${spec.default}"`);
    if (spec.required === false) bits.push('необязательный');
    detail.push({ k: 'параметр', v: bits.join(' · ') });
  }
  if (entry.dependsOn?.length) detail.push({ k: 'сначала', v: entry.dependsOn.join(', ') });
  if (entry.confirm) detail.push({ k: 'внимание', v: 'спросит подтверждение перед запуском' });
  const env = { ...project.config.env, ...entry.env };
  if (Object.keys(env).length) {
    detail.push({ k: 'env', v: Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') });
  }
  if (entry.cwd) detail.push({ k: 'cwd', v: entry.cwd });
  return detail;
}

/** Панель деталей для глобальной команды. */
function globalDetail(cmd: Command): DashItem['detail'] {
  const detail: DashItem['detail'] = [
    { k: 'команда', v: `jd ${cmd.name}` },
    { v: cmd.title },
    { v: cmd.desc },
  ];
  if (cmd.aliases?.length) detail.push({ k: 'псевдонимы', v: cmd.aliases.join(', ') });
  detail.push({ k: 'вызов', v: cmd.usage ?? `jd ${cmd.name}` });
  if (cmd.examples?.length) detail.push({ k: 'примеры', v: cmd.examples.join('\n') });
  return detail;
}

/** Собрать вкладки интерфейса: сначала проект, затем глобальные разделы. */
function buildTabs(local: Awaited<ReturnType<typeof loadProject>>, status: MenuStatus | null): { tabs: DashTab[]; actions: MenuAction[][] } {
  const tabs: DashTab[] = [];
  const actions: MenuAction[][] = [];

  if (local.status === 'broken') {
    tabs.push({
      label: '⚠ конфиг',
      accent: true,
      items: [
        {
          label: '⚠ .me.json не разобрался',
          hint: local.error,
          detail: [
            { k: 'файл', v: local.file },
            { k: 'ошибка', v: local.error },
            { v: 'Поправь этот файл — и команды проекта появятся во вкладке рядом с «Система».' },
          ],
        },
      ],
    });
    actions.push([{ kind: 'info', text: `${ME_FILE} не разобрался`, hint: local.error }]);
  }

  if (local.status === 'ok' && local.project.config.commands.length) {
    const items: DashItem[] = local.project.config.commands.map((entry) => ({
      label: entry.name,
      hint: entry.cmd,
      detail: projectDetail(entry, local.project),
    }));
    tabs.push({ label: `📂 ${local.project.config.projectName}`, items, accent: true });
    actions.push(local.project.config.commands.map((entry) => ({ kind: 'project' as const, entry, project: local.project })));
  }

  const visible = ALL.filter((c) => !c.hidden && c.name !== 'version');
  for (const group of groupsOf(visible)) {
    const inGroup = visible.filter((c) => c.group === group);
    tabs.push({
      label: group,
      items: inGroup.map((cmd) => ({
        label: cmd.name,
        hint: `${cmd.title} — ${cmd.desc}`,
        detail: globalDetail(cmd),
      })),
    });
    actions.push(inGroup.map((cmd) => ({ kind: 'global' as const, cmd })));
  }

  // Вкладка состояния — в конце: она справочная, команды важнее.
  if (status && status.summary.length) {
    tabs.push({
      label: '📍 Сейчас',
      items: status.summary.map((line) => ({
        label: line,
        hint: '',
        detail: [{ v: line }, { v: status.attention ? 'Есть на что посмотреть — команды подскажут детали.' : 'Всё в порядке, можно работать.' }],
      })),
    });
    actions.push(status.summary.map(() => ({ kind: 'info' as const, text: 'состояние проекта' })));
  }

  return { tabs, actions };
}

async function openMenu(): Promise<void> {
  if (!isInteractive()) {
    printHelp(ALL);
    return;
  }

  for (;;) {
    const local = await loadProject(process.cwd());
    const projectPorts = local.status === 'ok' ? local.project.config.ports ?? [] : [];
    // Состояние считаем молча и быстро: git, порты проекта, .env.
    const status = await menuStatus({ dir: process.cwd(), ports: projectPorts }).catch(() => null);
    const { tabs, actions } = buildTabs(local, status);

    const selection = await runDashboard(tabs, {
      title: 'jd · Just Developer Kit',
      right: `v${VERSION}${status ? ' · ' + status.right : ''}`,
    });
    if (!selection) {
      process.stdout.write(paint('  до связи 👋\n\n', fg(C.muted)));
      return;
    }

    const action = actions[selection.tab]?.[selection.item];
    if (!action) continue;
    clearScreen();

    if (action.kind === 'project') {
      const project = action.project;
      await runProjectCommand(action.entry, project, {
        askInputs: (missing: MeInput[]) => askProjectInputs(missing),
        askConfirm: (entry: MeCommand) => confirm(`Выполнить "${entry.name}"?  ${entry.cmd}`, false),
      });
    } else if (action.kind === 'global') {
      process.stdout.write(
        '\n  ' +
          paint(`jd ${action.cmd.name}`, bold(), fg(C.primary)) +
          paint(`  ${action.cmd.title}`, fg(C.muted)) +
          '\n',
      );
      await runCommand(action.cmd, []);
    } else {
      fail(action.text, action.hint);
    }

    await waitForEnter();
    clearScreen();
  }
}

/** Добрать недостающие параметры команды проекта вопросами. */
async function askProjectInputs(missing: MeInput[]): Promise<Record<string, string> | null> {
  const answers: Record<string, string> = {};
  for (const spec of missing) {
    const answer = await promptText(spec.prompt ?? `Значение для ${spec.name}`, spec.default ?? '');
    if (!answer) return null;
    answers[spec.name] = answer;
  }
  return answers;
}

async function main(): Promise<void> {
  const loaded = await loadCommands();
  ALL = [...builtins(), ...loaded];

  if (rawArgv.length === 0 || rawArgv[0] === 'menu') {
    if (rawArgv[0] === 'menu' || isInteractive()) await openMenu();
    else printHelp(ALL);
    return;
  }

  let [first, ...rest] = rawArgv;

  if (first === '--version' || first === '-v') {
    process.stdout.write(`jd ${VERSION}\n`);
    return;
  }
  if (first === '--help' || first === '-h') {
    printHelp(ALL);
    return;
  }

  let cmd = findCommand(ALL, first);

  // Алиасы проверяем только там, где команда не нашлась: как в git,
  // настоящая команда всегда важнее псевдонима.
  if (!cmd) {
    const expanded = expandAlias(rawArgv);
    if (expanded) {
      process.stderr.write(
        paint(`  · алиас: jd ${expanded.used.join(' → ')} = ${tokenize(expanded.argv.join(' ')).join(' ')}\n`, fg(C.faint)),
      );
      rawArgv = expanded.argv;
      [first, ...rest] = rawArgv;
      cmd = findCommand(ALL, first);
    }
  }

  if (!cmd) {
    const guesses = suggest(ALL, first);
    fail(
      `Неизвестная команда "${first}".`,
      guesses.length ? `Возможно, ты имел в виду: ${guesses.join(', ')}` : 'Полный список: jd list',
    );
    return;
  }

  if (rest.includes('--help') || rest.includes('-h')) {
    printCommandHelp(ALL, cmd.name);
    return;
  }

  await runCommand(cmd, rest);
}

main().catch((err: unknown) => {
  fail(`Непредвиденная ошибка: ${(err as Error)?.message ?? String(err)}`);
  if (process.env.JD_DEBUG) process.stderr.write(String((err as Error)?.stack ?? '') + '\n');
});
