// jd init и jd run — работа с локальным контекстом проекта (.me.json).

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { flagBool, parseArgs, type FlagSpec } from '../core/args.ts';
import { fail, info } from '../core/help.ts';
import { confirm, isInteractive, promptText, selectList } from '../core/input.ts';
import { ch, N } from '../core/neon.ts';
import {
  commandBadges,
  commandInputs,
  DEFAULT_ME,
  loadProject,
  matchCommandRef,
  ME_FILE,
  projectGroupLabel,
  runProjectCommand,
  writeMeFile,
  type MeCommand,
  type MeConfig,
  type MeInput,
  type ProjectContext,
} from '../core/project.ts';
import { openInEditor } from '../core/shell.ts';
import { C, bold, fg, paint } from '../core/theme.ts';
import { box, table, width } from '../core/ui.ts';
import { stripBom } from '../core/util.ts';
import type { Command } from '../core/registry.ts';

/** Подобрать эмодзи по имени npm-скрипта — чтобы меню выглядело живым. */
function emojiFor(script: string): string {
  const s = script.toLowerCase();
  if (/^(dev|serve|watch|start:dev)/.test(s)) return '🚀';
  if (/^(build|compile|bundle)/.test(s)) return '📦';
  if (/^(test|spec|e2e|vitest|jest)/.test(s)) return '🧪';
  if (/^(lint|eslint|check)/.test(s)) return '🧹';
  if (/^(format|prettier|fmt)/.test(s)) return '💅';
  if (/(prisma|migrate|db|seed|drizzle)/.test(s)) return '⚗️';
  if (/^(typecheck|tsc|types)/.test(s)) return '🔍';
  if (/^(deploy|release|publish)/.test(s)) return '🚢';
  if (/^(doc|storybook)/.test(s)) return '📚';
  if (/^(start|serve:prod)/.test(s)) return '▶️';
  return '⚙️';
}

function prettify(script: string): string {
  return script
    .replace(/[:_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\w/, (c) => c.toUpperCase());
}

/** Собрать конфиг из scripts в package.json — чтобы не набивать руками. */
async function configFromPackage(dir: string): Promise<MeConfig | null> {
  const pkgFile = path.join(dir, 'package.json');
  if (!existsSync(pkgFile)) return null;
  try {
    const pkg = JSON.parse(stripBom(await readFile(pkgFile, 'utf8'))) as {
      name?: string;
      scripts?: Record<string, string>;
    };
    const scripts = pkg.scripts ?? {};
    const names = Object.keys(scripts);
    if (!names.length) return null;

    const commands: MeCommand[] = names.map((name) => ({
      name: `${emojiFor(name)} ${prettify(name)}`,
      cmd: `npm run ${name}`,
      desc: scripts[name],
    }));

    // Опасные скрипты помечаем подтверждением: их легко нажать случайно.
    for (const entry of commands) {
      if (/(deploy|release|publish|db push|migrate|reset|drop)/i.test(`${entry.name} ${entry.cmd}`)) {
        entry.confirm = true;
      }
    }

    return {
      projectName: pkg.name || path.basename(dir),
      commands,
      ports: guessPorts(scripts),
    };
  } catch {
    return null;
  }
}

/** Вытащить из скриптов номера портов, если они там явно написаны. */
function guessPorts(scripts: Record<string, string>): number[] | undefined {
  const found = new Set<number>();
  for (const body of Object.values(scripts)) {
    for (const match of body.matchAll(/(?:--port[=\s]+|-p\s+|\bPORT=)(\d{2,5})\b/g)) {
      const n = Number(match[1]);
      if (n >= 1 && n <= 65535) found.add(n);
    }
  }
  // Плюс классика, если она упомянута в тексте скрипта.
  const defaults: [RegExp, number][] = [
    [/vite/i, 5173],
    [/next/i, 3000],
    [/nest/i, 3000],
  ];
  const joined = Object.values(scripts).join(' ');
  for (const [re, port] of defaults) if (re.test(joined)) found.add(port);

  return found.size ? [...found].sort((a, b) => a - b) : undefined;
}

function printConfig(config: MeConfig): void {
  const lines: string[] = [];
  lines.push(paint('  projectName: ', fg(C.muted)) + paint(JSON.stringify(config.projectName), fg(C.text)));
  lines.push(paint('  commands: ', fg(C.muted)) + paint(String(config.commands.length), fg(C.text)));
  if (config.ports?.length) {
    lines.push(paint('  ports: ', fg(C.muted)) + paint(config.ports.join(', '), fg(C.text)));
  }
  if (config.env) {
    lines.push(paint('  env: ', fg(C.muted)) + paint(Object.keys(config.env).join(', '), fg(C.text)));
  }
  lines.push('');
  // Стрелки выравниваем по самому длинному имени — иначе вёрстка «плывёт».
  const nameWidth = Math.max(0, ...config.commands.map((c) => width(c.name)));
  for (const cmd of config.commands) {
    const pad = ' '.repeat(Math.max(1, nameWidth - width(cmd.name)));
    const flags = commandBadges(cmd);
    lines.push(
      '  ' +
        paint(cmd.name, bold(), fg(C.text)) +
        pad +
        paint(' → ', fg(C.faint)) +
        paint(cmd.cmd, fg(C.cyan)) +
        (flags.length ? paint('   ⚑ ' + flags.join(' · '), fg(C.faint)) : ''),
    );
  }
  process.stdout.write('\n' + box(lines, { title: paint('Содержимое .me.json', bold(), fg(C.accent)) }) + '\n');
}

/** Короткая шпаргалка по расширенным полям — чтобы о них узнали. */
function printSchemaHint(): void {
  const lines = [
    paint('  у команды можно указать:', fg(C.muted)),
    '  ' + paint('cmd', fg(C.info)) + paint('        что выполнить (обязательно)', fg(C.muted)),
    '  ' + paint('cwd', fg(C.info)) + paint('        своя рабочая папка', fg(C.muted)),
    '  ' + paint('env', fg(C.info)) + paint('        свои переменные окружения', fg(C.muted)),
    '  ' + paint('confirm', fg(C.info)) + paint('    спросить перед запуском', fg(C.muted)),
    '  ' + paint('dependsOn', fg(C.info)) + paint('  что выполнить перед ней', fg(C.muted)),
    '  ' + paint('inputs', fg(C.info)) + paint('     параметры: в cmd пиши {{имя}}', fg(C.muted)),
    '',
    paint('  у проекта: ', fg(C.muted)) + paint('env', fg(C.info)) + paint(', ', fg(C.muted)) + paint('ports', fg(C.info)) + paint(' (их проверяет jd scan --project)', fg(C.muted)),
  ];
  process.stdout.write(box(lines, { title: paint('Доступные поля', bold(), fg(C.accent)) }) + '\n');
}

/** Собрать значения параметров из флагов вида --имя=значение. */
function valuesFromFlags(entry: MeCommand, flags: Record<string, string | number | boolean | string[]>): Record<string, string> {
  const values: Record<string, string> = {};
  for (const spec of commandInputs(entry)) {
    const raw = flags[spec.name];
    if (raw === undefined) continue;
    if (Array.isArray(raw)) values[spec.name] = String(raw[raw.length - 1] ?? '');
    else if (typeof raw === 'boolean') values[spec.name] = raw ? 'true' : 'false';
    else values[spec.name] = String(raw);
  }
  return values;
}

/** Интерактивно добрать недостающие параметры. */
async function askInputs(specs: MeInput[]): Promise<Record<string, string> | null> {
  const answers: Record<string, string> = {};
  for (const spec of specs) {
    const answer = await promptText(spec.prompt ?? `Значение для ${spec.name}`, spec.default ?? '');
    if (!answer) return null;
    answers[spec.name] = answer;
  }
  return answers;
}

const initCommand: Command = {
  name: 'init',
  aliases: ['me', 'meinit', 'initconfig'],
  group: 'Разработка',
  title: '🛠️ Init Project Config',
  desc: 'Создаёт .me.json — команды текущего проекта в меню jd',
  usage: 'jd init [--force] [--from-package] [--open]',
  examples: ['jd init', 'jd init --from-package', 'jd init --force --open'],

  async run({ argv, cwd }) {
    const args = parseArgs(
      argv,
      { force: 'boolean', f: 'boolean', open: 'boolean', o: 'boolean', 'from-package': 'boolean', p: 'boolean' },
      { f: 'force', o: 'open', p: 'from-package' },
    );

    const dir = path.resolve(cwd);
    const file = path.join(dir, ME_FILE);
    const force = flagBool(args, 'force');

    if (existsSync(file) && !force) {
      process.stdout.write(
        '\n  ' + paint('⚠ ', fg(C.warn)) + paint(`Файл ${ME_FILE} уже существует!`, bold(), fg(C.warn)) + '\n',
      );
      process.stdout.write('    ' + paint(file, fg(C.faint)) + '\n');
      process.stdout.write(
        '\n  ' +
          paint('что можно сделать: ', fg(C.muted)) +
          paint('jd run', fg(C.info)) +
          paint(' — запускать команды, ', fg(C.muted)) +
          paint('jd init --force', fg(C.info)) +
          paint(' — перезаписать', fg(C.muted)) +
          '\n\n',
      );
      return;
    }

    // Собираем конфиг: либо шаблон, либо из scripts в package.json.
    const fromPackage = flagBool(args, 'from-package');
    let config: MeConfig = DEFAULT_ME;
    let source = 'шаблон';

    if (fromPackage) {
      const generated = await configFromPackage(dir);
      if (!generated) {
        fail(
          'Не нашёл package.json со scripts.',
          'Запусти jd init без флага, чтобы получить шаблон, и отредактируй его руками.',
        );
        return;
      }
      config = generated;
      source = `scripts из package.json (${config.commands.length})`;
    }

    if (existsSync(file) && force) {
      const sure = !isInteractive() || (await confirm(`${ME_FILE} будет перезаписан. Продолжить?`, false));
      if (!sure) {
        process.stdout.write(paint('  отменено\n\n', fg(C.muted)));
        return;
      }
    }

    const parentDir = path.dirname(dir);
    const written = await writeMeFile(dir, config);

    process.stdout.write(
      '\n  ' + ch.hex(N.lime).bold('✔ ') +
        ch.hex(N.lime)('Файл .me.json успешно создан! ') +
        paint('Вы можете отредактировать его под свои нужды.', fg(C.soft)) + '\n',
    );
    process.stdout.write('  ' + paint('источник: ', fg(C.faint)) + paint(source, fg(C.muted)) + '\n');
    process.stdout.write('  ' + paint('путь:     ', fg(C.faint)) + paint(written, fg(C.muted)) + '\n');

    printConfig(config);
    printSchemaHint();

    if (existsSync(path.join(parentDir, ME_FILE))) {
      info(`Выше по дереву тоже есть ${ME_FILE} — этот файл его перекроет.`);
    }

    process.stdout.write(
      '\n  ' +
        paint('дальше: ', fg(C.muted)) +
        paint('jd run', fg(C.info)) +
        paint(' — выполнить команду, ', fg(C.muted)) +
        paint('jd', fg(C.info)) +
        paint(' — увидеть их в меню', fg(C.muted)) +
        '\n\n',
    );

    if (flagBool(args, 'open')) {
      await openInEditor(written);
    }
  },
};

const runCommand: Command = {
  name: 'run',
  aliases: ['r'],
  group: 'Разработка',
  title: 'Команды проекта',
  desc: 'Запускает команду из .me.json текущего проекта',
  usage: 'jd run [имя|номер] [--list] [--print] [--yes] [--параметр=значение]',
  examples: ['jd run', 'jd run dev', 'jd run 2', 'jd run --list', 'jd run deploy --env=prod'],

  async run({ argv, cwd }) {
    const loaded = await loadProject(cwd);
    if (loaded.status === 'missing') {
      fail(
        `В этой папке нет ${ME_FILE} — проектных команд нет.`,
        'Создать: jd init (или jd init --from-package — соберёт команды из scripts в package.json)',
      );
      return;
    }
    if (loaded.status === 'broken') {
      fail(`${ME_FILE} не разобрался: ${loaded.error}`, `Проверь ${loaded.file}`);
      return;
    }

    const { project } = loaded;
    const list = project.config.commands;

    for (const warning of project.warnings) {
      process.stdout.write('  ' + paint('⚠ ' + warning, fg(C.warn)) + '\n');
    }

    if (!list.length) {
      fail(`В ${ME_FILE} нет ни одной команды.`, `Открой и добавь массив commands: ${project.file}`);
      return;
    }

    // Имена параметров объявляем строковыми, чтобы работало и --env prod, и --env=prod.
    const inputFlags: FlagSpec = {};
    for (const entry of list) {
      for (const spec of commandInputs(entry)) inputFlags[spec.name] = 'string';
    }
    const args = parseArgs(argv, {
      ...inputFlags,
      list: 'boolean',
      l: 'boolean',
      print: 'boolean',
      p: 'boolean',
      yes: 'boolean',
      y: 'boolean',
    }, { l: 'list', p: 'print', y: 'yes' });

    if (flagBool(args, 'list')) {
      renderList(project);
      return;
    }

    const query = args._.join(' ').trim();
    const assumeYes = flagBool(args, 'yes');

    const interactive = isInteractive();
    // Подтверждение: в терминале спрашиваем, в скрипте полагаемся на --yes.
    let askConfirm: ((cmd: MeCommand) => Promise<boolean>) | undefined;
    if (interactive) {
      askConfirm = (cmd) => confirm(`Выполнить "${cmd.name}"?  ${cmd.cmd}`, false);
    } else if (assumeYes) {
      askConfirm = async () => true;
    }

    const runner = (entry: MeCommand) =>
      runProjectCommand(entry, project, {
        values: valuesFromFlags(entry, args.flags),
        askInputs: interactive ? askInputs : undefined,
        askConfirm,
      });

    if (!query) {
      if (!interactive) {
        fail('Укажи команду или запусти в терминале, чтобы выбрать из списка.', 'Список: jd run --list');
        return;
      }
      const picked = await selectList(
        list.map((entry) => {
          const badges = commandBadges(entry);
          return {
            label: entry.name,
            hint: entry.cmd + (badges.length ? `   ⚑ ${badges.join(' · ')}` : ''),
            group: projectGroupLabel(project.config),
          };
        }),
        {
          title: paint(`Проект ${project.config.projectName}`, bold(), fg(C.primary)),
          subtitle: 'Enter — запустить · Esc — отмена',
          emphasizeGroups: [projectGroupLabel(project.config)],
        },
      );
      if (picked === null) {
        process.stdout.write('\n');
        return;
      }
      if (flagBool(args, 'print')) {
        process.stdout.write(paint('  ' + list[picked].cmd + '\n\n', fg(C.cyan)));
        return;
      }
      const ok = await runner(list[picked]);
      if (!ok) process.exitCode = 1;
      process.stdout.write('\n');
      return;
    }

    const entry = resolveEntry(project, query);
    if (!entry) {
      fail(`В проекте нет команды "${query}".`, `Есть такие: ${list.map((c) => c.name).join(', ')}`);
      return;
    }

    if (flagBool(args, 'print')) {
      process.stdout.write(paint('  ' + entry.cmd + '\n\n', fg(C.cyan)));
      return;
    }

    const ok = await runner(entry);
    if (!ok) process.exitCode = 1;
    process.stdout.write('\n');
  },
};

function resolveEntry(project: ProjectContext, query: string): MeCommand | null {
  const list = project.config.commands;
  if (!list.length) return null;

  // Номер из списка — самый быстрый способ.
  if (/^\d+$/.test(query.trim())) {
    return list[Number(query.trim()) - 1] ?? null;
  }
  return matchCommandRef(list, query);
}

function renderList(project: ProjectContext): void {
  const list = project.config.commands;
  const hasInputs = list.some((c) => commandInputs(c).length);

  const headers = ['№', 'КОМАНДА', 'ЗАПУСКАЕТ'];
  if (hasInputs) headers.push('ПАРАМЕТРЫ');

  const rows = list.map((entry, i) => {
    const row = [
      paint(String(i + 1), fg(C.faint)),
      paint(entry.name, bold(), fg(C.text)),
      paint(entry.cmd, fg(C.cyan)),
    ];
    if (hasInputs) {
      const specs = commandInputs(entry);
      row.push(specs.length ? paint(specs.map((s) => `{{${s.name}}}`).join(' '), fg(C.warn)) : paint('—', fg(C.faint)));
    }
    return row;
  });

  process.stdout.write(
    '\n' + table(headers, rows, { align: ['right', 'left', 'left', 'left'] }) + '\n',
  );

  const ports = project.config.ports;
  process.stdout.write(
    '\n  ' +
      paint(projectGroupLabel(project.config), fg(C.accent)) +
      (ports?.length ? paint(`   порты: ${ports.join(', ')}`, fg(C.cyan)) : '') +
      paint(`   ${project.file}`, fg(C.faint)) +
      '\n',
  );

  const flagged = list.filter((c) => c.confirm || c.dependsOn?.length);
  if (flagged.length) {
    process.stdout.write('\n');
    for (const entry of flagged) {
      process.stdout.write('  ' + paint('⚑ ', fg(C.warn)) + paint(entry.name, fg(C.text)) + paint('  ' + commandBadges(entry).join(' · '), fg(C.faint)) + '\n');
    }
  }
  process.stdout.write('\n');
}

export default [initCommand, runCommand];
