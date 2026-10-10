// jd doctor — проверка окружения проекта: версии, порты, конфиги, git.
//
// Смысл команды: за один запуск увидеть всё, что обычно выясняется методом тыка —
// «почему не стартует», «почему не тот Node», «чей порт занят», «чего не хватает в .env».

import { existsSync, readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs, flagBool } from '../core/args.ts';
import { envDiff } from '../core/env.ts';
import { ch, N, neonSpinner } from '../core/neon.ts';
import { POPULAR_PORTS, scanPorts, shortProcess } from '../core/ports.ts';
import { loadProject, ME_FILE, type ProjectLoad } from '../core/project.ts';
import { run } from '../core/shell.ts';
import { C, bold, fg, paint } from '../core/theme.ts';
import { table, truncate } from '../core/ui.ts';
import { stripBom } from '../core/util.ts';
import type { Command } from '../core/registry.ts';

type Level = 'ok' | 'warn' | 'err' | 'skip';

interface Check {
  level: Level;
  what: string;
  detail: string;
  hint?: string;
}

const ICON: Record<Level, string> = { ok: '✓', warn: '!', err: '✖', skip: '·' };
const COLOR: Record<Level, string> = { ok: C.ok, warn: C.warn, err: C.err, skip: C.faint };

type Version = [number, number, number];

function parseVersion(text: string): Version | null {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(text.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

function cmp(a: Version, b: Version): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/**
 * Проверить версию против диапазона из engines. Поддерживаем то, что реально
 * пишут в package.json: >=, >, <=, <, ^, ~ и точную версию в виде "22.18".
 * Возвращает null, если диапазон не разобран — тогда проверку пропускаем.
 */
export function satisfies(version: string, range: string): boolean | null {
  const current = parseVersion(version);
  const raw = range.trim();
  if (!current || !raw) return null;

  const m = /^(>=|<=|>|<|\^|~|=)?\s*v?(.+)$/.exec(raw);
  if (!m) return null;
  const op = m[1] ?? '=';
  const target = parseVersion(m[2]);
  if (!target) return null;

  switch (op) {
    case '>=':
      return cmp(current, target) >= 0;
    case '>':
      return cmp(current, target) > 0;
    case '<=':
      return cmp(current, target) <= 0;
    case '<':
      return cmp(current, target) < 0;
    case '^':
      return cmp(current, target) >= 0 && current[0] === target[0];
    case '~':
      return cmp(current, target) >= 0 && current[0] === target[0] && current[1] === target[1];
    default:
      // Точная версия: "22.18" без патча означает любую 22.18.x.
      if (cmp(current, target) < 0) return false;
      if (version.split('.').length < 3 && m[2].split('.').length < 3) {
        return current[0] === target[0] && (m[2].split('.').length < 2 || current[1] === target[1]);
      }
      return cmp(current, target) === 0;
  }
}

interface PackageJson {
  name?: string;
  version?: string;
  engines?: { node?: string };
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(stripBom(readFileSync(file, 'utf8'))) as T;
  } catch {
    return null;
  }
}

/** Ключи из .env-файла: только имена, без значений — секреты нам не нужны. */
function checkEnvFiles(dir: string): Check {
  const diff = envDiff(dir);
  const list = (keys: string[], max = 6): string =>
    `${keys.slice(0, max).join(', ')}${keys.length > max ? ` и ещё ${keys.length - max}` : ''}`;

  if (!diff.hasExample && !diff.hasEnv) {
    return { level: 'skip', what: 'Переменные окружения', detail: 'нет ни .env, ни .env.example' };
  }
  if (!diff.hasEnv) {
    return {
      level: 'warn',
      what: 'Переменные окружения',
      detail: 'есть .env.example, но нет .env',
      hint: 'Создать и заполнить: jd env --init',
    };
  }
  if (!diff.hasExample) {
    return {
      level: 'ok',
      what: 'Переменные окружения',
      detail: `.env найден, ${diff.env.length} переменных`,
      hint: 'Зафиксировать список для команды: jd env --example',
    };
  }
  if (diff.missing.length) {
    return {
      level: 'warn',
      what: 'Переменные окружения',
      detail: `в .env не хватает: ${list(diff.missing)}`,
      hint: 'Скорее всего приложение упадёт на старте — дописать: jd env --init',
    };
  }
  if (diff.extra.length) {
    return {
      level: 'ok',
      what: 'Переменные окружения',
      detail: `.env покрывает .env.example и содержит ещё ${diff.extra.length}: ${list(diff.extra, 4)}`,
      hint: diff.extra.length ? 'Добавить в пример: jd env --example' : undefined,
    };
  }
  return { level: 'ok', what: 'Переменные окружения', detail: `.env и .env.example совпадают (${diff.env.length})` };
}

function checkNode(pkg: PackageJson | null): Check {
  const want = pkg?.engines?.node;
  if (!want) {
    return { level: 'skip', what: 'Версия Node', detail: `${process.version} · в package.json нет engines.node` };
  }
  const fits = satisfies(process.version, want);
  if (fits === null) {
    return { level: 'skip', what: 'Версия Node', detail: `${process.version} · диапазон "${want}" не разобран` };
  }
  return fits
    ? { level: 'ok', what: 'Версия Node', detail: `${process.version} подходит под "${want}"` }
    : {
        level: 'err',
        what: 'Версия Node',
        detail: `${process.version} не подходит под "${want}"`,
        hint: 'Поставь нужную версию Node (nvm use, fnm use) или поправь engines.node',
      };
}

function checkProject(local: ProjectLoad): Check {
  if (local.status === 'missing') {
    return { level: 'skip', what: ME_FILE, detail: 'нет — команд проекта не будет', hint: 'Создать: jd init' };
  }
  if (local.status === 'broken') {
    return { level: 'err', what: ME_FILE, detail: `не разобрался: ${local.error}`, hint: `Проверь ${local.file}` };
  }
  const clean = local.project.warnings.length === 0;
  return {
    level: clean ? 'ok' : 'warn',
    what: ME_FILE,
    detail: clean
      ? `${local.project.config.commands.length} команд(ы) · ${local.project.config.projectName}`
      : `разобран с замечаниями: ${local.project.warnings.join('; ')}`,
    hint: clean ? undefined : `Открой ${local.project.file} и поправь поля`,
  };
}

async function checkDependencies(dir: string, pkg: PackageJson | null): Promise<Check> {
  const declared = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  const names = Object.keys(declared);
  if (!names.length) {
    return { level: 'skip', what: 'Зависимости', detail: 'в package.json нет зависимостей' };
  }
  const modulesDir = path.join(dir, 'node_modules');
  if (!existsSync(modulesDir)) {
    return {
      level: 'err',
      what: 'Зависимости',
      detail: `объявлено ${names.length}, но node_modules нет`,
      hint: 'Выполни npm install (или запусти jd run, если команда это делает)',
    };
  }

  let present: Awaited<ReturnType<typeof readdir>>;
  try {
    present = await readdir(modulesDir, { withFileTypes: true });
  } catch {
    return { level: 'warn', what: 'Зависимости', detail: 'node_modules не читается' };
  }
  const installed = new Set(present.map((e) => e.name));
  const missing = names.filter((n) => !installed.has(n) && !installed.has(n.split('/')[0]));

  if (!missing.length) {
    return { level: 'ok', what: 'Зависимости', detail: `все ${names.length} на месте в node_modules` };
  }
  return {
    level: 'warn',
    what: 'Зависимости',
    detail: `нет в node_modules: ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ` и ещё ${missing.length - 6}` : ''}`,
    hint: 'Выполни npm install',
  };
}

function checkLock(dir: string, pkg: PackageJson | null): Check {
  if (!pkg) return { level: 'skip', what: 'Lock-файл', detail: 'нет package.json' };
  const lockFile = path.join(dir, 'package-lock.json');
  if (!existsSync(lockFile)) {
    return {
      level: 'warn',
      what: 'Lock-файл',
      detail: 'package-lock.json отсутствует',
      hint: 'Без него версии зависимостей у тебя и в CI разойдутся',
    };
  }
  const lock = readJson<{ name?: string; version?: string; lockfileVersion?: number }>(lockFile);
  if (!lock) return { level: 'warn', what: 'Lock-файл', detail: 'package-lock.json не разобрался' };

  const mismatches: string[] = [];
  if (pkg.name && lock.name && pkg.name !== lock.name) mismatches.push(`имя: ${lock.name} → ${pkg.name}`);
  if (pkg.version && lock.version && pkg.version !== lock.version) {
    mismatches.push(`версия: ${lock.version} → ${pkg.version}`);
  }

  if (mismatches.length) {
    return {
      level: 'warn',
      what: 'Lock-файл',
      detail: `расходится с package.json (${mismatches.join('; ')})`,
      hint: 'Выполни npm install, чтобы синхронизировать lock-файл',
    };
  }
  return { level: 'ok', what: 'Lock-файл', detail: `lockfileVersion ${lock.lockfileVersion ?? '—'}, совпадает с package.json` };
}

async function checkGit(dir: string): Promise<Check> {
  const inside = await run('git', ['rev-parse', '--is-inside-work-tree'], { cwd: dir, timeout: 10000 });
  if (!inside.ok) {
    return { level: 'warn', what: 'Git', detail: 'папка не под git', hint: 'Инициализировать и выложить: jd push' };
  }
  const [status, log] = await Promise.all([
    run('git', ['status', '--porcelain'], { cwd: dir, timeout: 15000 }),
    run('git', ['rev-list', '--count', 'HEAD'], { cwd: dir, timeout: 10000 }),
  ]);

  const changed = status.ok ? status.stdout.split(/\r?\n/).filter((l) => l.trim()).length : 0;
  const commits = log.ok ? Number(log.stdout.trim()) : 0;

  if (!commits) {
    return {
      level: 'warn',
      what: 'Git',
      detail: changed ? `нет ни одного коммита, ${changed} файл(ов) не отслеживается` : 'нет ни одного коммита',
      hint: 'Первый коммит и push: jd push',
    };
  }
  if (changed > 30) {
    return { level: 'warn', what: 'Git', detail: `не закоммичено файлов: ${changed}`, hint: 'Многовато — проверь, не попали ли лишние файлы' };
  }
  return {
    level: 'ok',
    what: 'Git',
    detail: changed ? `${commits} коммитов, не закоммичено: ${changed}` : `${commits} коммитов, дерево чистое`,
  };
}

function checkGitignore(dir: string): Check {
  const file = path.join(dir, '.gitignore');
  if (!existsSync(file)) {
    return { level: 'warn', what: '.gitignore', detail: 'файла нет', hint: 'Создать шаблон: jd push (создаёт .gitignore, если его нет)' };
  }
  let body = '';
  try {
    body = stripBom(readFileSync(file, 'utf8'));
  } catch {
    return { level: 'warn', what: '.gitignore', detail: 'не читается' };
  }
  const gaps: string[] = [];
  if (existsSync(path.join(dir, 'node_modules')) && !/^node_modules\/?\s*$/m.test(body)) gaps.push('node_modules');
  if (existsSync(path.join(dir, '.env')) && !/^\.env\b/m.test(body)) gaps.push('.env');

  if (gaps.length) {
    return {
      level: 'warn',
      what: '.gitignore',
      detail: `не игнорируется: ${gaps.join(', ')}`,
      hint: 'Иначе секреты или node_modules уедут в репозиторий — добавь их в .gitignore',
    };
  }
  return { level: 'ok', what: '.gitignore', detail: 'ключевое исключено' };
}

export default {
  name: 'doctor',
  aliases: ['check', 'diagnose'],
  group: 'Разработка',
  title: 'Проверка проекта',
  desc: 'Окружение, порты, зависимости, конфиги и git — в одном отчёте',
  usage: 'jd doctor',
  examples: ['jd doctor'],

  async run({ cwd, argv }) {
    const args = parseArgs(argv, { json: 'boolean' });
    const dir = path.resolve(cwd);
    const pkg = readJson<PackageJson>(path.join(dir, 'package.json'));
    const local = await loadProject(dir);

    const checks: Check[] = [];
    checks.push(pkg ? { level: 'ok', what: 'package.json', detail: `${pkg.name ?? '—'} ${pkg.version ?? ''}`.trim() } : { level: 'skip', what: 'package.json', detail: 'нет — это не Node-проект' });
    checks.push(checkNode(pkg));
    checks.push(checkProject(local));
    checks.push(checkEnvFiles(dir));
    checks.push(await checkDependencies(dir, pkg));
    checks.push(checkLock(dir, pkg));
    checks.push(await checkGit(dir));
    checks.push(checkGitignore(dir));

    // Порты: сначала из .me.json, иначе популярные дев-порты.
    const fromMe = local.status === 'ok' ? local.project.config.ports ?? [] : [];
    const portsToCheck = fromMe.length ? fromMe : POPULAR_PORTS.slice(0, 12);
    const source = fromMe.length ? ME_FILE : 'популярные дев-порты';

    const spin = neonSpinner(`проверяю порты (${source})…`);
    const hits = await scanPorts(portsToCheck);
    spin.stop();

    const busy = hits.filter((h) => h.open);

    if (flagBool(args, 'json')) {
      const errorsCount = checks.filter((c) => c.level === 'err').length;
      const warnsCount = checks.filter((c) => c.level === 'warn').length;
      process.stdout.write(
        JSON.stringify(
          {
            dir,
            project: pkg?.name ?? null,
            node: process.version,
            ok: errorsCount === 0 && warnsCount === 0,
            errors: errorsCount,
            warnings: warnsCount,
            checks: checks.map((c) => ({ level: c.level, what: c.what, detail: c.detail, hint: c.hint ?? null })),
            ports: { source, checked: portsToCheck.length, busy: busy.map((h) => ({ port: h.port, pid: h.pid ?? null, process: h.rows.length ? h.process : null })) },
            hints: checks.filter((c) => c.hint && c.level !== 'ok' && c.level !== 'skip').map((c) => `${c.what}: ${c.hint}`),
          },
          null,
          2,
        ) + '\n',
      );
      if (errorsCount) process.exitCode = 1;
      return;
    }
    checks.push(
      busy.length
        ? {
            level: 'warn',
            what: 'Порты',
            detail: `занято ${busy.length} из ${portsToCheck.length}: ${busy.map((h) => `:${h.port}`).join(', ')}`,
            hint: 'Освободить: jd scan — или посмотреть, кто держит: jd killport <порт>',
          }
        : { level: 'ok', what: 'Порты', detail: `все ${portsToCheck.length} свободны (${source})` },
    );

    // Отчёт.
    const order: Level[] = ['err', 'warn', 'ok', 'skip'];
    const sorted = [...checks].sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level));
    const width = Math.max(0, ...checks.map((c) => c.what.length));

    process.stdout.write('\n');
    process.stdout.write(
      table(
        ['', 'ЧТО', 'РЕЗУЛЬТАТ'],
        sorted.map((c) => [
          paint(ICON[c.level], bold(), fg(COLOR[c.level])),
          paint(c.what + ' '.repeat(width - c.what.length), fg(c.level === 'skip' ? C.muted : C.text)),
          paint(truncate(c.detail, 70), fg(c.level === 'skip' ? C.faint : C.soft)),
        ]),
        { align: ['left', 'left', 'left'] },
      ) + '\n',
    );

    if (busy.length) {
      process.stdout.write('\n' + paint('  занятые порты', bold(), fg(C.accent)) + '\n');
      for (const hit of busy) {
        process.stdout.write(
          '   ' +
            paint(`:${hit.port}`, bold(), fg(C.err)) +
            paint('  ' + (hit.rows.length ? shortProcess(hit.process, 28) : 'владелец не определён'), fg(C.text)) +
            paint(hit.pid ? `  PID ${hit.pid}` : '', fg(C.faint)) +
            '\n',
        );
      }
    }

    const hints = sorted.filter((c) => c.hint && (c.level === 'err' || c.level === 'warn'));
    if (hints.length) {
      process.stdout.write('\n' + paint('  что делать', bold(), fg(C.accent)) + '\n');
      for (const c of hints) {
        process.stdout.write('   ' + paint('→ ', fg(C.warn)) + paint(c.what + ': ', fg(C.text)) + paint(c.hint ?? '', fg(C.muted)) + '\n');
      }
    }

    const errors = checks.filter((c) => c.level === 'err').length;
    const warns = checks.filter((c) => c.level === 'warn').length;

    process.stdout.write('\n');
    if (!errors && !warns) {
      process.stdout.write('  ' + ch.hex(N.lime).bold('✔ ') + ch.hex(N.lime)('Проект в порядке.') + paint(' Можно работать.\n\n', fg(C.muted)));
      return;
    }
    if (!errors) {
      process.stdout.write(
        '  ' + ch.hex(N.amber).bold('! ') + ch.hex(N.amber)('Есть замечания: ') + paint(`${warns}`, bold(), fg(C.warn)) + paint(' — но критичного нет.\n\n', fg(C.muted)),
      );
      return;
    }
    process.stdout.write(
      '  ' + ch.hex(N.red).bold('✖ ') + ch.hex(N.red)('Есть проблемы: ') +
        paint(`${errors}`, bold(), fg(C.err)) +
        paint(warns ? ` и замечаний: ${warns}` : '', fg(C.muted)) +
        '\n\n',
    );
    process.exitCode = 1;
  },
} satisfies Command;
