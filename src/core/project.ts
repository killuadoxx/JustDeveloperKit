// Локальный контекст проекта: файл .me.json рядом с кодом.
//
// Работает так: команды ищут .me.json в текущей папке, а если его нет — поднимаются
// по родителям до корня диска. Поэтому `jd run` работает и из подпапки проекта.
// Битый файл не прячется: о нём сообщается отдельным статусом, а не молчанием.
//
// Конфиг — это не только список команд, но и знание о проекте: свои порты,
// переменные окружения и порядок запуска.

import { exec } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ch, N, neonSpinner } from './neon.ts';
import { killTree } from './shell.ts';
import { C, bold, colorEnabledNow, fg, paint } from './theme.ts';
import { box } from './ui.ts';
import { formatMs, stripBom, textWidth } from './util.ts';

export const ME_FILE = '.me.json';

/** Параметр команды: `jd run deploy --env=prod` или интерактивный вопрос. */
export interface MeInput {
  name: string;
  prompt?: string;
  default?: string;
  required?: boolean;
}

export interface MeCommand {
  /** Как команда называется в меню. Эмодзи приветствуются. */
  name: string;
  /** Что выполнить — строка для shell. Внутри можно писать {{параметр}}. */
  cmd: string;
  /** Необязательное пояснение. */
  desc?: string;
  /** Рабочая папка относительно папки проекта. */
  cwd?: string;
  /** Дополнительные переменные окружения для этой команды. */
  env?: Record<string, string>;
  /** Спросить подтверждение перед запуском — для опасных команд. */
  confirm?: boolean;
  /** Что выполнить перед этой командой: имена других команд проекта. */
  dependsOn?: string[];
  /** Параметры, которые подставляются в cmd вместо {{name}}. */
  inputs?: MeInput[];
}

export interface MeConfig {
  projectName: string;
  commands: MeCommand[];
  /** Общие переменные окружения для всех команд проекта. */
  env?: Record<string, string>;
  /** Порты проекта — их проверяет `jd scan --project`. */
  ports?: number[];
}

/** Шаблон, который создаёт `jd init`. */
export const DEFAULT_ME: MeConfig = {
  projectName: 'Имя вашего проекта',
  commands: [
    { name: '🚀 Dev Server', cmd: 'npm run dev' },
    { name: '⚗️ Prisma Push', cmd: 'npx prisma db push' },
    { name: '📦 Build Project', cmd: 'npm run build' },
  ],
};

export interface ProjectContext {
  /** Абсолютный путь к найденному .me.json. */
  file: string;
  /** Папка проекта — база для рабочих каталогов команд. */
  dir: string;
  config: MeConfig;
  /** Что пришлось поправить или отбросить при разборе. */
  warnings: string[];
}

export type ProjectLoad =
  | { status: 'missing' }
  | { status: 'broken'; file: string; error: string }
  | { status: 'ok'; project: ProjectContext };

/** Найти .me.json: сначала в папке, потом выше по дереву. */
export function findMeFile(start: string): string | null {
  let dir = path.resolve(start);
  for (let depth = 0; depth < 24; depth++) {
    const candidate = path.join(dir, ME_FILE);
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asStringRecord(value: unknown): Record<string, string> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'string') out[key] = raw;
    else if (typeof raw === 'number' || typeof raw === 'boolean') out[key] = String(raw);
  }
  return Object.keys(out).length ? out : undefined;
}

/** Разобрать и провалидировать конфиг. Никогда не бросает. */
export function parseMe(raw: string, file: string): ProjectLoad {
  let data: unknown;
  try {
    // BOM в начале файла — обычное дело после правки в блокноте, JSON.parse на нём падает.
    data = JSON.parse(stripBom(raw));
  } catch (err) {
    return { status: 'broken', file, error: (err as Error).message };
  }

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { status: 'broken', file, error: 'ожидался объект с полями projectName и commands' };
  }

  const source = data as Record<string, unknown>;
  const dir = path.dirname(file);
  const warnings: string[] = [];

  const projectName = asString(source.projectName) || path.basename(dir);
  const projectEnv = asStringRecord(source.env);
  const ports: number[] = [];
  if (source.ports !== undefined) {
    if (!Array.isArray(source.ports)) {
      warnings.push('поле ports должно быть массивом чисел');
    } else {
      for (const item of source.ports) {
        const n = Number(item);
        if (Number.isInteger(n) && n >= 1 && n <= 65535) ports.push(n);
        else warnings.push(`порт "${String(item)}" пропущен: нужно число от 1 до 65535`);
      }
    }
  }

  const rawCommands = source.commands;
  const commands: MeCommand[] = [];

  if (rawCommands === undefined) {
    warnings.push('в файле нет поля commands — добавь массив команд');
  } else if (!Array.isArray(rawCommands)) {
    warnings.push('поле commands должно быть массивом');
  } else {
    rawCommands.forEach((item, i) => {
      const at = `команда №${i + 1}`;
      if (typeof item !== 'object' || item === null) {
        warnings.push(`${at} пропущена: это не объект`);
        return;
      }
      const entry = item as Record<string, unknown>;
      const name = asString(entry.name);
      const cmd = asString(entry.cmd);
      if (!name || !cmd) {
        warnings.push(`${at} пропущена: нужны поля name и cmd`);
        return;
      }

      const parsed: MeCommand = { name, cmd };

      // Имена команд — ключ меню: два одинаковых пункта только путают,
      // а `jd run <имя>` всё равно возьмёт первый.
      if (commands.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
        warnings.push(`${at} «${name}» пропущена: команда с таким именем уже есть`);
        return;
      }

      const desc = asString(entry.desc);
      if (desc) parsed.desc = desc;

      const cwd = asString(entry.cwd);
      if (cwd) parsed.cwd = cwd;

      const env = asStringRecord(entry.env);
      if (env) parsed.env = env;

      if (entry.confirm !== undefined) {
        if (typeof entry.confirm === 'boolean') parsed.confirm = entry.confirm;
        else warnings.push(`${at}: confirm должен быть true или false — проигнорирован`);
      }

      if (entry.dependsOn !== undefined) {
        if (!Array.isArray(entry.dependsOn)) {
          warnings.push(`${at}: dependsOn должен быть массивом имён`);
        } else {
          const deps = entry.dependsOn.map(asString).filter(Boolean);
          if (deps.length) parsed.dependsOn = deps;
        }
      }

      if (entry.inputs !== undefined) {
        if (!Array.isArray(entry.inputs)) {
          warnings.push(`${at}: inputs должен быть массивом`);
        } else {
          const inputs: MeInput[] = [];
          entry.inputs.forEach((rawInput, k) => {
            if (typeof rawInput !== 'object' || rawInput === null) {
              warnings.push(`${at}: параметр №${k + 1} пропущен`);
              return;
            }
            const spec = rawInput as Record<string, unknown>;
            const inputName = asString(spec.name);
            if (!inputName) {
              warnings.push(`${at}: параметр №${k + 1} пропущен — нет name`);
              return;
            }
            const parsedInput: MeInput = { name: inputName };
            const prompt = asString(spec.prompt);
            if (prompt) parsedInput.prompt = prompt;
            if (spec.default !== undefined) parsedInput.default = String(spec.default);
            if (typeof spec.required === 'boolean') parsedInput.required = spec.required;
            inputs.push(parsedInput);
          });
          if (inputs.length) parsed.inputs = inputs;
        }
      }

      commands.push(parsed);
    });
  }

  return {
    status: 'ok',
    project: { file, dir, config: { projectName, commands, env: projectEnv, ports: ports.length ? ports : undefined }, warnings },
  };
}

/** Загрузить контекст проекта. Отсутствие файла — это норма, а не ошибка. */
export async function loadProject(start = process.cwd()): Promise<ProjectLoad> {
  const file = findMeFile(start);
  if (!file) return { status: 'missing' };
  try {
    const raw = await readFile(file, 'utf8');
    return parseMe(raw, file);
  } catch (err) {
    return { status: 'broken', file, error: (err as Error).message };
  }
}

/**
 * То же самое, но синхронно — для отрисовки справки, где нельзя await.
 * Разбор общий, отличается только чтение файла.
 */
export function loadProjectSync(start = process.cwd()): ProjectLoad {
  const file = findMeFile(start);
  if (!file) return { status: 'missing' };
  try {
    return parseMe(readFileSync(file, 'utf8'), file);
  } catch (err) {
    return { status: 'broken', file, error: (err as Error).message };
  }
}

export async function writeMeFile(dir: string, config: MeConfig): Promise<string> {
  const file = path.join(dir, ME_FILE);
  await writeFile(file, JSON.stringify(config, null, 2) + '\n', 'utf8');
  return file;
}

/** Рабочий каталог команды: свой cwd относительно папки проекта. */
export function commandCwd(entry: MeCommand, project: ProjectContext): string {
  if (!entry.cwd) return project.dir;
  return path.resolve(project.dir, entry.cwd);
}

/** Окружение команды: общее проекта + своё, поверх текущего процесса. */
export function commandEnv(entry: MeCommand, project: ProjectContext): NodeJS.ProcessEnv {
  return { ...process.env, ...project.config.env, ...entry.env };
}

/**
 * Найти команду по ссылке из dependsOn или по вводу пользователя.
 * Порядок: точное имя → точная команда → «слаг» имени без эмодзи → нечётко.
 */
export function matchCommandRef(list: MeCommand[], ref: string): MeCommand | null {
  const target = ref.trim();
  if (!target) return null;
  const lower = target.toLowerCase();

  const byName = list.find((c) => c.name.toLowerCase() === lower);
  if (byName) return byName;
  const byCmd = list.find((c) => c.cmd.toLowerCase() === lower);
  if (byCmd) return byCmd;

  const slug = (s: string): string =>
    s
      .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '')
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, '-');
  const bySlug = list.find((c) => slug(c.name) === slug(target));
  if (bySlug) return bySlug;

  let best: { entry: MeCommand; score: number } | null = null;
  for (const entry of list) {
    const haystack = `${entry.name} ${entry.cmd}`.toLowerCase();
    if (!haystack.includes(lower)) continue;
    // Чем раньше нашлось — тем лучше; совпадение в имени важнее.
    const score = (entry.name.toLowerCase().includes(lower) ? 100 : 0) - haystack.indexOf(lower) / 1000;
    if (!best || score > best.score) best = { entry, score };
  }
  return best?.entry ?? null;
}

/** Экранировать значение для подстановки в команду оболочки. */
export function shellQuote(value: string): string {
  if (/^[A-Za-z0-9._:/=\\-]*$/.test(value)) return value;
  if (process.platform === 'win32') return `"${value.replace(/"/g, '""')}"`;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Подставить значения параметров: {{name}} → значение. */
export function applyInputs(cmd: string, values: Record<string, string>): string {
  return cmd.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? shellQuote(values[name]) : whole,
  );
}

/** Параметры, упомянутые в команде, — для подсказки «чего не хватает». */
export function inputPlaceholders(cmd: string): string[] {
  const found: string[] = [];
  for (const match of cmd.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)) found.push(match[1]);
  return [...new Set(found)];
}

export interface ExecOutcome {
  ok: boolean;
  code: number | null;
  ms: number;
  output: string;
  interrupted: boolean;
}

export interface ExecHooks {
  /** Первый байт вывода — момент, когда пора убрать спиннер. */
  onFirstOutput?: () => void;
  onData?: (chunk: string) => void;
}

/**
 * Выполнить команду проекта через child_process.exec.
 * Вывод идёт потоком, Ctrl+C убивает всё дерево процессов, а не только npm.
 */
export function execCommand(
  cmd: string,
  cwd: string,
  hooks: ExecHooks = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<ExecOutcome> {
  return new Promise((resolve) => {
    const started = Date.now();
    const childEnv: NodeJS.ProcessEnv = { ...env };
    // npm/vite/prisma красят вывод только если верят в терминал. Мы их вывод
    // пропускаем через себя, поэтому цвет нужно попросить явно.
    if (colorEnabledNow() && childEnv.FORCE_COLOR === undefined) childEnv.FORCE_COLOR = '1';

    let buffer = '';
    let seenOutput = false;
    let interrupted = false;

    const child = exec(cmd, {
      cwd,
      env: childEnv,
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
      encoding: 'utf8',
    });

    const onChunk = (text: string): void => {
      buffer += text;
      if (!seenOutput) {
        seenOutput = true;
        hooks.onFirstOutput?.();
      }
      hooks.onData?.(text);
    };

    child.stdout?.on('data', (d: string | Buffer) => onChunk(String(d)));
    child.stderr?.on('data', (d: string | Buffer) => onChunk(String(d)));

    // Ctrl+C должен гасить dev-сервер, а не оставлять его висеть в фоне.
    const forward = (): void => {
      interrupted = true;
      if (child.pid) void killTree(child.pid);
    };
    process.once('SIGINT', forward);

    const done = (ok: boolean, code: number | null): void => {
      process.off('SIGINT', forward);
      resolve({ ok, code, ms: Date.now() - started, output: buffer, interrupted });
    };

    child.on('error', (err) => {
      buffer += `\n${err.message}`;
      done(false, null);
    });
    child.on('close', (code) => done(code === 0, code));
  });
}

export interface RunOptions {
  showCommand?: boolean;
  /** Значения параметров, если их уже собрали (например, из флагов CLI). */
  values?: Record<string, string>;
  /** Запросить недостающие параметры у пользователя. */
  askInputs?: (missing: MeInput[]) => Promise<Record<string, string> | null>;
  /** Спросить подтверждение для команды с confirm: true. */
  askConfirm?: (entry: MeCommand) => Promise<boolean>;
  /** Уже выполненные команды — защита от циклов в dependsOn. */
  chain?: string[];
}

function heading(text: string, color: string): string {
  return paint('  ' + text, bold(), fg(color));
}

/** Объединить объявленные параметры с теми, что просто упомянуты в cmd. */
export function commandInputs(entry: MeCommand): MeInput[] {
  const specs: MeInput[] = [...(entry.inputs ?? [])];
  for (const name of inputPlaceholders(entry.cmd)) {
    if (!specs.some((s) => s.name === name)) specs.push({ name, required: true });
  }
  return specs;
}

/**
 * Запустить команду проекта: подтверждение, зависимости, параметры,
 * затем сам запуск со спиннером и живым выводом.
 */
export async function runProjectCommand(
  entry: MeCommand,
  project: ProjectContext,
  opts: RunOptions = {},
): Promise<boolean> {
  const chain = opts.chain ?? [];

  if (chain.includes(entry.name)) {
    process.stdout.write(heading(`⟳ ${entry.name} уже выполняется — цикл в dependsOn, пропускаю`, C.warn) + '\n');
    return true;
  }

  // 1. Подтверждение — до зависимостей, чтобы не делать лишнюю работу.
  if (entry.confirm) {
    if (!opts.askConfirm) {
      process.stdout.write(
        heading(`⚠ ${entry.name} требует подтверждения — в неинтерактивном режиме добавь --yes`, C.warn) + '\n',
      );
      return false;
    }
    const agreed = await opts.askConfirm(entry);
    if (!agreed) {
      process.stdout.write(heading('отменено', C.muted) + '\n');
      return false;
    }
  }

  // 2. Зависимости. Падение любой останавливает цепочку.
  for (const ref of entry.dependsOn ?? []) {
    const dep = matchCommandRef(project.config.commands, ref);
    if (!dep) {
      process.stdout.write(heading(`⚠ не нашёл зависимость "${ref}" — пропускаю`, C.warn) + '\n');
      continue;
    }
    process.stdout.write(heading(`↳ сначала: ${dep.name}`, C.muted) + '\n');
    const depOk = await runProjectCommand(dep, project, { ...opts, chain: [...chain, entry.name] });
    if (!depOk) {
      process.stdout.write(heading(`✖ зависимость ${dep.name} не отработала — ${entry.name} не запускаю`, C.err) + '\n');
      return false;
    }
  }

  // 3. Параметры: значения по умолчанию, затем вопросы, затем проверка.
  const values: Record<string, string> = { ...(opts.values ?? {}) };
  const specs = commandInputs(entry);

  for (const spec of specs) {
    if (values[spec.name] === undefined && spec.default !== undefined) values[spec.name] = spec.default;
    if (values[spec.name] === undefined && spec.required === false) values[spec.name] = '';
  }

  let missing = specs.filter((s) => !values[s.name]);
  if (missing.length && opts.askInputs) {
    const answers = await opts.askInputs(missing);
    if (answers === null) {
      process.stdout.write(heading('отменено', C.muted) + '\n');
      return false;
    }
    Object.assign(values, answers);
  }

  missing = specs.filter((s) => !values[s.name]);
  if (missing.length) {
    process.stdout.write(heading(`✖ не хватает параметров: ${missing.map((m) => m.name).join(', ')}`, C.err) + '\n');
    process.stdout.write('    ' + paint(`укажи их: ${missing.map((m) => `--${m.name}=...`).join(' ')}`, fg(C.muted)) + '\n');
    return false;
  }

  const finalCmd = applyInputs(entry.cmd, values);
  const cwd = commandCwd(entry, project);
  const env = commandEnv(entry, project);
  const showCommand = opts.showCommand !== false;

  const lines: string[] = [paint('  ' + entry.name, bold(), fg(C.text))];
  if (showCommand) lines.push(paint('  $ ', fg(C.faint)) + paint(finalCmd, fg(C.cyan)));
  if (entry.desc) lines.push(paint('  ' + entry.desc, fg(C.muted)));
  lines.push(paint('  в папке ', fg(C.faint)) + paint(cwd, fg(C.muted)));
  const shownEnv = { ...project.config.env, ...entry.env };
  if (Object.keys(shownEnv).length) {
    lines.push(
      paint('  env ', fg(C.faint)) +
        paint(Object.entries(shownEnv).map(([k, v]) => `${k}=${v}`).join('  '), fg(C.muted)),
    );
  }
  process.stdout.write('\n' + box(lines, { title: paint('Команда проекта', bold(), fg(C.accent)) }) + '\n\n');

  const spin = neonSpinner(`выполняю: ${finalCmd}`);
  let announced = false;

  const outcome = await execCommand(
    finalCmd,
    cwd,
    {
      onFirstOutput: () => {
        spin.stop();
        announced = true;
        process.stdout.write(paint('  ── вывод команды ' + '─'.repeat(Math.max(4, 40)), fg(C.faint)) + '\n');
      },
      onData: (chunk) => process.stdout.write(chunk),
    },
    env,
  );

  spin.stop();
  if (announced) process.stdout.write('\n' + paint('  ── конец вывода ' + '─'.repeat(Math.max(4, 42)), fg(C.faint)) + '\n');
  if (!outcome.output.trim()) {
    process.stdout.write(paint('  команда ничего не вывела', fg(C.faint)) + '\n');
  }

  const time = formatMs(outcome.ms);
  process.stdout.write('\n');
  if (outcome.interrupted) {
    process.stdout.write('  ' + ch.hex(N.amber).bold('■') + ' ' + paint('прервано пользователем', fg(C.warn)) + '\n');
    return false;
  }
  if (outcome.ok) {
    process.stdout.write(
      '  ' + ch.hex(N.lime).bold('✔') + ' ' + paint('команда завершилась успешно', fg(C.text)) +
        paint(`   код 0 · ${time}`, fg(C.faint)) + '\n',
    );
    return true;
  }
  process.stdout.write(
    '  ' + ch.hex(N.red).bold('✖') + ' ' + paint('команда упала', fg(C.text)) +
      paint(`   код ${outcome.code ?? '—'} · ${time}`, fg(C.faint)) + '\n',
  );
  return false;
}

/** Заголовок блока проекта в меню и в списке команд. */
export function projectGroupLabel(config: MeConfig): string {
  return `📂 Команды проекта [${config.projectName}]`;
}

/** Короткая сводка возможностей команды — для панели деталей в меню. */
export function commandBadges(entry: MeCommand): string[] {
  const badges: string[] = [];
  if (entry.inputs?.length) badges.push(`параметры: ${entry.inputs.length}`);
  if (entry.dependsOn?.length) badges.push(`зависит от: ${entry.dependsOn.join(', ')}`);
  if (entry.confirm) badges.push('спрашивает подтверждение');
  if (entry.cwd) badges.push(`cwd: ${entry.cwd}`);
  if (entry.env) badges.push(`env: ${Object.keys(entry.env).join(', ')}`);
  return badges;
}

/** Длина самой длинной команды в конфиге — для выравнивания в списках. */
export function widestCommandName(config: MeConfig): number {
  return Math.max(0, ...config.commands.map((c) => textWidth(c.name)));
}
