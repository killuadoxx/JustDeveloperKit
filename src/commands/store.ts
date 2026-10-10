// jd store — магазин расширений: базовый каталог пакетов плюс свои записи.
//
// Смысл: не вспоминать, как называется нужный пакет, и ставить его в проект
// одной командой. Своё добавляется формулировкой вида "npm install grammy" —
// имя, команда и описание остаются в локальной базе.

import path from 'node:path';
import { flagBool, flagStr, parseArgs } from '../core/args.ts';
import { categoryIcon, prettifyPackageName } from '../core/catalog.ts';
import { fail, info, ok } from '../core/help.ts';
import { confirm, isInteractive, promptText, selectList } from '../core/input.ts';
import {
  allPkgs,
  categoriesInUse,
  extractSpecName,
  getPkg,
  installHistory,
  installText,
  installToProject,
  listPkgs,
  outdatedPackages,
  parseInstallCommand,
  readProjectPackage,
  removePkg,
  restorePkg,
  savePkg,
  seedCatalog,
  storeStats,
  suggestPackages,
  type Manager,
  type Pkg,
} from '../core/market.ts';
import { neonSpinner } from '../core/neon.ts';
import { openExternal } from '../core/shell.ts';
import { C, bold, fg, paint } from '../core/theme.ts';
import { box, table, truncate, width } from '../core/ui.ts';
import type { Command } from '../core/registry.ts';

/* -------------------------------- вывод ---------------------------------- */

function installedMap(): Map<string, { range: string; dev: boolean }> {
  const pkg = readProjectPackage(process.cwd());
  const out = new Map<string, { range: string; dev: boolean }>();
  for (const [name, range] of Object.entries(pkg.deps)) out.set(name, { range, dev: false });
  for (const [name, range] of Object.entries(pkg.devDeps)) out.set(name, { range, dev: true });
  return out;
}

function nameColumnWidth(pkgs: Pkg[]): number {
  return Math.min(26, Math.max(10, ...pkgs.map((p) => width(p.name))));
}

function printPkgTable(pkgs: Pkg[], opts: { group?: boolean } = {}): void {
  if (!pkgs.length) {
    info('Ничего не нашлось. Пустой каталог? Проверь: jd store list --all');
    return;
  }
  const here = installedMap();
  const nameW = nameColumnWidth(pkgs);
  const cols = Math.max(70, Math.min(process.stdout.columns ?? 110, 140));
  const descW = Math.max(24, cols - nameW - 26);

  const rowsOf = (list: Pkg[]): string[][] =>
    list.map((pkg) => {
      const installed = here.get(pkg.name);
      return [
        installed ? paint('✔', bold(), fg(C.ok)) : paint('·', fg(C.faint)),
        paint(pkg.name, installed ? bold() : '', fg(installed ? C.text : C.soft)),
        paint(truncate(pkg.desc, descW), fg(C.muted)),
        [
          pkg.dev ? paint(' dev', fg(C.accent)) : '',
          installed ? paint(installed.range, fg(C.info)) : '',
          !pkg.builtin ? paint(' своё', fg(C.warn)) : '',
        ].join(''),
      ];
    });

  const headers = ['', 'ПАКЕТ', 'ЧТО ДЕЛАЕТ', ''];
  const out: string[] = [];
  if (opts.group === false) {
    out.push(table(headers, rowsOf(pkgs)));
  } else {
    const byCategory = new Map<string, Pkg[]>();
    for (const pkg of pkgs) {
      const list = byCategory.get(pkg.category) ?? [];
      list.push(pkg);
      byCategory.set(pkg.category, list);
    }
    let first = true;
    for (const [category, list] of byCategory) {
      if (!first) out.push('');
      first = false;
      out.push(
        '  ' +
          paint(`${categoryIcon(category)} ${category}`, bold(), fg(C.accent)) +
          paint(`   ${list.length}`, fg(C.faint)),
      );
      out.push(table(first ? headers : ['', '', '', ''], rowsOf(list), { showHeader: first }));
    }
  }
  process.stdout.write('\n' + out.join('\n') + '\n');
}

function pkgCard(pkg: Pkg, opts: { installed?: { range: string; dev: boolean } | null } = {}): string {
  const lines: string[] = [];
  lines.push(paint(pkg.title, bold(), fg(C.text)));
  lines.push('');
  lines.push(paint(pkg.desc || 'без описания', fg(C.soft)));
  lines.push('');
  lines.push(
    paint('пакет     ', fg(C.muted)) + paint(pkg.name, fg(C.info)) +
      (pkg.spec !== pkg.name ? paint(`   ставится как ${pkg.spec}`, fg(C.faint)) : ''),
  );
  lines.push(paint('раздел    ', fg(C.muted)) + paint(`${categoryIcon(pkg.category)} ${pkg.category}`, fg(C.soft)));
  if (pkg.tags.length) lines.push(paint('теги      ', fg(C.muted)) + paint(pkg.tags.join(', '), fg(C.soft)));
  lines.push(
    paint('тип       ', fg(C.muted)) +
      (pkg.dev ? paint('devDependencies', fg(C.accent)) : paint('dependencies', fg(C.primary))),
  );
  lines.push(paint('источник  ', fg(C.muted)) + (pkg.builtin ? paint('базовый каталог', fg(C.faint)) : paint('добавлено тобой', fg(C.warn))));
  if (pkg.installs) lines.push(paint('ставил    ', fg(C.muted)) + paint(`${pkg.installs} раз(а)`, fg(C.faint)));
  if (opts.installed) {
    lines.push(
      paint('в проекте ', fg(C.muted)) +
        paint(`уже стоит ${opts.installed.range}`, fg(C.ok)) +
        paint(opts.installed.dev ? ' (dev)' : '', fg(C.faint)),
    );
  }
  lines.push('');
  lines.push(paint('установка ', fg(C.muted)) + paint(`jd store install ${pkg.name}${pkg.dev ? ' --dev' : ''}`, fg(C.cyan)));
  if (pkg.url) lines.push(paint('документация ', fg(C.muted)) + paint(pkg.url, fg(C.info)));
  return box(lines, { title: paint('📦 ' + pkg.name, bold(), fg(C.accent)) });
}

function printStats(): void {
  const stats = storeStats();
  const here = installedMap().size;
  process.stdout.write(
    paint(`\n  всего ${stats.total}`, fg(C.muted)) +
      paint(` · базовых ${stats.builtin}`, fg(C.faint)) +
      paint(` · своих ${stats.custom}`, fg(C.accent)) +
      (stats.hidden ? paint(` · скрытых ${stats.hidden}`, fg(C.faint)) : '') +
      paint(` · установлено в этом проекте ${here}\n`, fg(C.info)),
  );
}

/* ------------------------------ установка -------------------------------- */

async function installOne(pkg: Pkg, opts: { dev?: boolean; dry?: boolean } = {}): Promise<boolean> {
  const dir = process.cwd();
  const dev = opts.dev ?? pkg.dev;
  const spec = { name: pkg.name, spec: pkg.spec, dev };

  if (opts.dry) {
    info(`--dry: выполнил бы  ${installText('npm', [spec])}`);
    return true;
  }

  const pkgJson = path.join(dir, 'package.json');
  const hadPackage = readProjectPackage(dir).exists;
  if (!hadPackage) {
    const create = isInteractive() && (await confirm('В папке нет package.json. Создать?', true));
    if (!create) {
      fail('Нечего устанавливать.', 'Создай package.json (npm init -y) или запусти из папки проекта.');
      return false;
    }
  }

  const spin = neonSpinner(`устанавливаю ${pkg.name}…`);
  const result = await installToProject(dir, [spec], { create: true });
  if (!result.ok) {
    spin.fail(`${pkg.name} — ${result.error}`);
    return false;
  }
  const resolved = result.resolved[0];
  spin.succeed(
    `${pkg.name} ${paint(resolved.range, fg(C.info))} → ${dev ? 'devDependencies' : 'dependencies'}` +
      (result.created ? paint('   (package.json создан)', fg(C.faint)) : ''),
  );
  void pkgJson;
  return true;
}

/* --------------------------- интерактивный режим -------------------------- */

async function browse(): Promise<void> {
  for (;;) {
    const stats = storeStats();
    const categories = categoriesInUse();
    const here = installedMap();

    const sections = [
      { label: '⭐ Установлено в этом проекте', hint: `${here.size} пакет(ов)`, key: 'installed' },
      { label: '🔍 Все пакеты', hint: `${stats.total} в каталоге`, key: 'all' },
      { label: '👤 Только мои записи', hint: `${stats.custom} добавлено тобой`, key: 'custom' },
      ...categories.map((c) => ({
        label: `${categoryIcon(c)} ${c}`,
        hint: `${allPkgs().filter((p) => p.category === c).length}`,
        key: c,
      })),
      { label: '🕘 История установок', hint: 'что и когда ставилось', key: 'history' },
    ];

    const section = await selectList(sections, {
      title: '🛒 Магазин расширений',
      subtitle: 'Enter — выбрать раздел · печатай для поиска · Esc — выйти',
    });
    if (section === null) return;

    const chosen = sections[section];

    if (chosen.key === 'history') {
      printHistory();
      continue;
    }

    const all = allPkgs();
    const list =
      chosen.key === 'installed'
        ? all.filter((p) => here.has(p.name))
        : chosen.key === 'custom'
          ? all.filter((p) => !p.builtin)
          : chosen.key === 'all'
            ? all
            : all.filter((p) => p.category === chosen.key);

    if (!list.length) {
      info('В этом разделе пока пусто.');
      continue;
    }

    const sorted = [...list].sort((a, b) => Number(here.has(b.name)) - Number(here.has(a.name)) || a.name.localeCompare(b.name));
    const pick = await selectList(
      sorted.map((pkg) => ({
        label: pkg.name,
        hint: `${pkg.title} — ${truncate(pkg.desc, 60)}${here.has(pkg.name) ? '  ✔ ' + here.get(pkg.name)?.range : ''}`,
      })),
      { title: `🛒 ${chosen.label}`, subtitle: 'печатай для поиска по названию и описанию' },
    );
    if (pick === null) continue;

    await actOnPkg(sorted[pick]);
  }
}

async function actOnPkg(pkg: Pkg): Promise<void> {
  for (;;) {
    const fresh = getPkg(pkg.name) ?? pkg;
    const installed = installedMap().get(fresh.name) ?? null;
    process.stdout.write('\n' + pkgCard(fresh, { installed }) + '\n\n');

    const actions = [
      { label: '📥 Установить', hint: installText('npm', [{ spec: fresh.spec, dev: fresh.dev }]) },
      { label: '📥 Установить в devDependencies', hint: 'npm install --save-dev' },
      { label: '🌐 Открыть страницу на npm', hint: fresh.url },
      { label: '✏️  Изменить название или описание', hint: 'правка записи в каталоге' },
      { label: '🗑️  Убрать из каталога', hint: fresh.builtin ? 'базовая запись просто скроется' : 'запись удалится' },
      { label: '← Назад к списку', hint: '' },
    ];
    const chosen = await selectList(actions, { title: 'Что сделать?', subtitle: fresh.name });
    if (chosen === null || chosen === actions.length - 1) return;

    if (chosen === 0) {
      if (await installOne(fresh)) return;
      continue;
    }
    if (chosen === 1) {
      if (await installOne(fresh, { dev: true })) return;
      continue;
    }
    if (chosen === 2) {
      const opened = await openExternal(fresh.url);
      if (!opened) info(fresh.url);
      continue;
    }
    if (chosen === 3) {
      await editForm(fresh);
      continue;
    }
    if (chosen === 4) {
      const go = await confirm(`Убрать «${fresh.name}» из каталога?`, false);
      if (!go) continue;
      const result = removePkg(fresh.name);
      if (result === 'hidden') {
        ok(`«${fresh.name}» скрыт из каталога. Вернуть: jd store restore ${fresh.name}`);
      } else if (result === 'deleted') {
        ok(`«${fresh.name}» удалён из каталога.`);
      }
      return;
    }
  }
}

/* ------------------------------ добавление ------------------------------- */

function describeCommand(input: string): { name: string; spec: string; dev: boolean } | null {
  const parsed = parseInstallCommand(input);
  if (parsed.global) {
    fail('Глобальная установка не поддерживается.', 'jd store ставит пакеты в проект — для глобальных есть npm install -g.');
    return null;
  }
  if (!parsed.specs.length) return null;
  const first = parsed.specs[0];
  return { name: first.name, spec: first.spec, dev: first.dev };
}

/**
 * Форма добавления пакета. Пользователь вводит команду установки как в терминале,
 * а дальше отвечает на пару вопросов — описание обязательно: без него запись бесполезна.
 */
async function addForm(prefill?: { name?: string; spec?: string; dev?: boolean; command?: string }): Promise<boolean> {
  process.stdout.write(
    '\n' +
      box(
        [
          paint('Вставь команду так, как написал бы её в терминале:', fg(C.soft)),
          '',
          paint('  npm install grammy', fg(C.cyan)),
          paint('  pnpm add -D prisma@6', fg(C.cyan)),
          paint('  yarn add zod', fg(C.cyan)),
          '',
          paint('Разберу её сам: имя пакета, версия и признак dev.', fg(C.muted)),
        ],
        { title: paint('🛒 Новый пакет', bold(), fg(C.accent)) },
      ) +
      '\n',
  );

  const command = prefill?.command ?? (await promptText('Команда установки', prefill?.spec ? `npm install ${prefill.spec}` : ''));
  if (!command.trim()) {
    info('Отменено.');
    return false;
  }

  const parsed = describeCommand(command);
  if (!parsed) {
    fail(`Не понял команду "${command}".`, 'Пример: npm install grammy  или просто grammy');
    return false;
  }

  let { name, spec, dev } = parsed;
  if (prefill?.dev) dev = true;

  // Опечатка в имени — частая история ("grammyjs"), поэтому предлагаем близкое.
  const guesses = suggestPackages(name).filter((g) => g !== name);
  if (guesses.length) {
    const useGuess = await confirm(`«${name}» не из каталога. Возможно, ты имел в виду ${guesses.join(' или ')}?`, false);
    if (useGuess) {
      const fixed = guesses[0];
      spec = spec.replace(name, fixed);
      name = fixed;
      ok(`Беру ${name}`);
    }
  }

  const existing = getPkg(name);
  const title = await promptText('Короткое название', existing?.title ?? prettifyPackageName(name));
  let desc = '';
  while (!desc.trim()) {
    desc = await promptText('Что делает пакет (одна строка)');
    if (!desc.trim()) {
      if (!isInteractive()) break;
      info('Описание обязательно — без него запись ничего не скажет через месяц.');
    }
  }
  if (!desc.trim()) {
    fail('Нужно описание.', 'Флаг --desc="..." или ответь на вопрос в интерактивном режиме.');
    return false;
  }

  const categories = categoriesInUse();
  let category = existing?.category ?? '';
  const pick = await selectList(
    [...categories.map((c) => ({ label: `${categoryIcon(c)} ${c}` })), { label: '➕ Свой раздел' }],
    { title: 'Раздел каталога' },
  );
  if (pick === null) return false;
  category = pick === categories.length ? (await promptText('Название раздела', 'Моё')) : categories[pick];

  const tags = (await promptText('Теги через запятую (необязательно)', existing?.tags.join(', ') ?? '')).trim();
  const url = await promptText('Ссылка на документацию', `https://www.npmjs.com/package/${name}`);

  const draft: Pkg = {
    name,
    spec,
    title: title.trim() || prettifyPackageName(name),
    desc: desc.trim(),
    category: category.trim() || 'Моё',
    tags: tags ? tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
    url: url.trim(),
    dev,
    builtin: false,
    hidden: false,
    installs: existing?.installs ?? 0,
    created_at: existing?.created_at ?? new Date().toISOString(),
  };

  process.stdout.write('\n' + pkgCard(draft) + '\n\n');
  const keep = await confirm(existing ? `Обновить запись «${name}»?` : `Сохранить «${name}» в каталоге?`, true);
  if (!keep) {
    info('Ничего не менял.');
    return false;
  }

  const result = savePkg({
    name,
    spec,
    title: draft.title,
    desc: draft.desc,
    category: draft.category,
    tags: draft.tags.join(','),
    url: draft.url,
    dev,
  });
  ok(result === 'created' ? `«${name}» добавлен в каталог.` : `Запись «${name}» обновлена.`);
  process.stdout.write(paint(`  установить: jd store install ${name}${dev ? ' --dev' : ''}\n\n`, fg(C.faint)));
  return true;
}

/** Правка существующей записи: значения по умолчанию — текущие. */
async function editForm(pkg: Pkg): Promise<void> {
  const desc = await promptText('Что делает пакет', pkg.desc);
  const title = await promptText('Короткое название', pkg.title);
  const categories = categoriesInUse();
  const pick = await selectList(
    [...categories.map((c) => ({ label: `${categoryIcon(c)} ${c}` })), { label: '➕ Свой раздел' }],
    { title: 'Раздел каталога', subtitle: `сейчас: ${pkg.category}` },
  );
  let category = pkg.category;
  if (pick !== null) {
    category = pick === categories.length ? await promptText('Название раздела', pkg.category) : categories[pick];
  }
  const tags = await promptText('Теги через запятую', pkg.tags.join(', '));
  const url = await promptText('Ссылка', pkg.url);
  const dev = await confirm('Ставить в devDependencies?', pkg.dev);

  savePkg({
    name: pkg.name,
    spec: pkg.spec,
    title,
    desc,
    category,
    tags,
    url,
    dev,
  });
  ok(`Запись «${pkg.name}» обновлена (теперь это твоя запись, каталог её не перезапишет).`);
}

/* -------------------------------- история -------------------------------- */

function printHistory(): void {
  const rows = installHistory(undefined, 30);
  if (!rows.length) {
    info('История пуста — установок через jd store ещё не было.');
    return;
  }
  const here = path.resolve(process.cwd());
  process.stdout.write(
    '\n' +
      table(
        ['КОГДА', 'ПАКЕТ', 'КУДА', 'ПРОЕКТ', ''],
        rows.map((row) => [
          paint(new Date(row.created_at).toLocaleString('ru-RU'), fg(C.muted)),
          paint(row.spec, fg(row.ok ? C.text : C.err)),
          paint(row.dev ? 'dev' : 'deps', fg(C.faint)),
          paint(truncate(row.project === here ? '.' : row.project, 40), fg(row.project === here ? C.info : C.faint)),
          row.ok ? paint('✔', fg(C.ok)) : paint('✖', fg(C.err)),
        ]),
      ) +
      '\n',
  );
}

/* --------------------------------- команда -------------------------------- */

const SUBCOMMANDS = new Set(['list', 'ls', 'show', 'install', 'add', 'new', 'edit', 'remove', 'rm', 'restore', 'search', 'find', 'installed', 'history', 'log', 'outdated', 'updates', 'help']);

export default {
  name: 'store',
  aliases: ['pkg', 'packages', 'shop'],
  group: 'Магазин',
  title: 'Магазин расширений',
  desc: 'Каталог пакетов, установка в проект и свои записи',
  usage: 'jd store [list|show|add|install|remove|restore|installed|history|outdated] [аргументы]',
  examples: [
    'jd store',
    'jd store list --category="Telegram и боты"',
    'jd store add "npm install grammy"',
    'jd store install grammy zod --dev',
    'jd store installed',
    'jd store outdated',
  ],

  async run({ argv }) {
    const args = parseArgs(
      argv,
      {
        category: 'string', c: 'string', query: 'string', q: 'string', installed: 'boolean', all: 'boolean',
        hidden: 'boolean', json: 'boolean', desc: 'string', title: 'string', tags: 'string', url: 'string',
        dev: 'boolean', spec: 'string', cmd: 'string', manager: 'string', dry: 'boolean', yes: 'boolean',
      },
      { c: 'category', q: 'query' },
    );

    seedCatalog();

    const first = args._[0] ?? '';
    const known = SUBCOMMANDS.has(first.toLowerCase()) ? first.toLowerCase() : '';
    const rest = known ? args._.slice(1) : args._;

    // jd store grammy — короткий путь к установке.
    if (!known && first) {
      return installMany(rest, args);
    }

    switch (known) {
      case 'help':
        fail('Смотри список команд:', 'jd help store');
        return;

      case 'list':
      case 'ls': {
        const items = listPkgs({
          category: flagStr(args, 'category', ''),
          query: flagStr(args, 'query', ''),
          installedOnly: flagBool(args, 'installed'),
          includeHidden: flagBool(args, 'hidden'),
        });
        if (flagBool(args, 'json')) {
          process.stdout.write(JSON.stringify(items, null, 2) + '\n');
          return;
        }
        printPkgTable(items);
        printStats();
        process.stdout.write(paint('  подробнее: jd store show <пакет>   ·   установить: jd store install <пакет>\n\n', fg(C.faint)));
        return;
      }

      case 'search':
      case 'find': {
        const query = rest.join(' ') || flagStr(args, 'query', '');
        if (!query) {
          fail('Что искать?', 'jd store search grammy');
          return;
        }
        const items = listPkgs({ query });
        printPkgTable(items, { group: false });
        if (!items.length) {
          const guesses = suggestPackages(query);
          if (guesses.length) info(`Похожие: ${guesses.join(', ')}`);
        }
        return;
      }

      case 'show': {
        const name = rest[0] ?? '';
        const pkg = getPkg(name);
        if (!pkg) {
          fail(`«${name}» нет в каталоге.`, `Добавить: jd store add "npm install ${name}"`);
          const guesses = suggestPackages(name);
          if (guesses.length) info(`Похожие: ${guesses.join(', ')}`);
          return;
        }
        process.stdout.write('\n' + pkgCard(pkg, { installed: installedMap().get(pkg.name) ?? null }) + '\n\n');
        return;
      }

      case 'install': {
        const names = rest;
        if (!names.length) {
          if (isInteractive()) return installFlowAssistant();
          fail('Не указаны пакеты.', 'jd store install grammy zod --dev');
          return;
        }
        return installMany(names, args);
      }

      case 'add':
      case 'new': {
        const command = rest.join(' ').trim() || flagStr(args, 'cmd', '');
        const spec = flagStr(args, 'spec', '');
        const desc = flagStr(args, 'desc', '');

        // Неинтерактивный путь: всё нужное передали флагами.
        if (desc && (command || spec)) {
          return addNonInteractive(command, spec, args);
        }
        if (!isInteractive()) {
          fail('Нужны данные для записи.', 'jd store add "npm install grammy" --desc="Телеграм-боты" [--category=...] [--dev]');
          return;
        }
        await addForm({
          command: command || undefined,
          spec: spec || undefined,
          dev: flagBool(args, 'dev'),
        });
        return;
      }

      case 'edit': {
        const pkg = getPkg(rest[0] ?? '');
        if (!pkg) {
          fail(`«${rest[0] ?? ''}» нет в каталоге.`);
          return;
        }
        const desc = flagStr(args, 'desc', '');
        if (desc) {
          savePkg({
            name: pkg.name,
            spec: flagStr(args, 'spec', pkg.spec),
            title: flagStr(args, 'title', pkg.title),
            desc,
            category: flagStr(args, 'category', pkg.category),
            tags: flagStr(args, 'tags', pkg.tags.join(',')),
            url: flagStr(args, 'url', pkg.url),
            dev: flagBool(args, 'dev', pkg.dev),
          });
          ok(`Запись «${pkg.name}» обновлена.`);
          return;
        }
        if (!isInteractive()) {
          fail('Нужен --desc="..." для правки.', 'jd store edit grammy --desc="..."');
          return;
        }
        await editForm(pkg);
        return;
      }

      case 'remove':
      case 'rm': {
        const name = rest[0] ?? '';
        const pkg = getPkg(name);
        if (!pkg) {
          fail(`«${name}» нет в каталоге.`);
          return;
        }
        if (!flagBool(args, 'yes') && isInteractive()) {
          const go = await confirm(
            pkg.builtin ? `Скрыть базовую запись «${name}»?` : `Удалить запись «${name}»?`,
            false,
          );
          if (!go) {
            info('Отменено.');
            return;
          }
        }
        const result = removePkg(name);
        if (result === 'hidden') ok(`«${name}» скрыт. Вернуть: jd store restore ${name}`);
        else if (result === 'deleted') ok(`«${name}» удалён.`);
        return;
      }

      case 'restore': {
        const name = rest[0] ?? '';
        ok(restorePkg(name) ? `«${name}» снова в каталоге.` : `«${name}» не был скрыт.`);
        return;
      }

      case 'installed': {
        const pkg = readProjectPackage(process.cwd());
        const entries = [
          ...Object.entries(pkg.deps).map(([name, range]) => ({ name, range, dev: false })),
          ...Object.entries(pkg.devDeps).map(([name, range]) => ({ name, range, dev: true })),
        ];
        if (!entries.length) {
          fail('В этом проекте нет зависимостей.', 'Это не Node-проект или package.json пуст.');
          return;
        }
        const history = installHistory(process.cwd(), 200);
        process.stdout.write(
          '\n' +
            table(
              ['', 'ПАКЕТ', 'ВЕРСИЯ', 'ТИП', 'ИСТОЧНИК', 'ЧЕРЕЗ JD'],
              entries.map((entry) => {
                const known = getPkg(entry.name);
                const record = history.find((h) => h.name === entry.name);
                return [
                  known ? paint('★', fg(C.warn)) : paint('·', fg(C.faint)),
                  paint(entry.name, fg(C.text)),
                  paint(entry.range, fg(C.info)),
                  paint(entry.dev ? 'dev' : 'deps', fg(C.faint)),
                  known
                    ? paint(known.builtin ? `каталог: ${known.title}` : 'своя запись', fg(C.muted))
                    : paint('нет в каталоге', fg(C.faint)),
                  record ? paint(new Date(record.created_at).toLocaleDateString('ru-RU'), fg(C.ok)) : paint('—', fg(C.faint)),
                ];
              }),
            ) +
            '\n',
        );
        const missing = entries.filter((e) => !getPkg(e.name));
        process.stdout.write(
          paint(`  ★ — есть в каталоге (${entries.length - missing.length})`, fg(C.warn)) +
            paint(`   · — нет (${missing.length})`, fg(C.faint)) +
            (missing.length
              ? paint(`\n  добавить недостающие в каталог: jd store add "npm install ${missing[0].name}" --desc="..."\n`, fg(C.faint))
              : paint('\n', fg(C.faint))),
        );
        return;
      }

      case 'history':
      case 'log':
        printHistory();
        return;

      case 'outdated':
      case 'updates': {
        const spin = neonSpinner('спрашиваю у пакетного менеджера, что устарело…');
        const result = await outdatedPackages(process.cwd(), (flagStr(args, 'manager', '') as Manager) || undefined);
        spin.stop();

        if (!result.ok && !result.items.length) {
          fail(result.error ?? 'не получилось проверить версии.', 'Проверь вручную: npm outdated');
          return;
        }
        if (flagBool(args, 'json')) {
          process.stdout.write(JSON.stringify(result, null, 2) + '\n');
          return;
        }
        if (!result.items.length) {
          process.stdout.write('\n');
          ok('Всё актуально: обновлять нечего.');
          process.stdout.write(paint('  проверить всю пачку: jd store outdated --json\n\n', fg(C.faint)));
          return;
        }
        process.stdout.write(
          '\n' +
            table(
              ['ПАКЕТ', 'СЕЙЧАС', 'ХОЧЕТ', 'ПОСЛЕДНЯЯ', 'ТИП', 'В МАГАЗИНЕ'],
              result.items.map((item) => [
                paint(item.name, bold(), fg(C.text)),
                paint(item.current, fg(C.muted)),
                paint(item.wanted, fg(C.soft)),
                paint(item.latest, bold(), fg(C.warn)),
                paint(item.dev ? 'dev' : 'deps', fg(C.faint)),
                item.known ? paint('★', fg(C.accent)) : paint('·', fg(C.faint)),
              ]),
            ) +
            '\n',
        );
        process.stdout.write(
          paint(`  устарело: ${result.items.length}`, fg(C.warn)) +
            paint(`   обновить один: jd store install ${result.items[0].name}@latest`, fg(C.faint)) +
            paint(`\n  обновить всё: ${result.manager} update\n\n`, fg(C.faint)),
        );
        return;
      }

      default: {
        if (!isInteractive()) {
          printPkgTable(listPkgs({}), {});
          printStats();
          return;
        }
        await browse();
        return;
      }
    }
  },
} satisfies Command;

/* --------------------------- вспомогательные пути ------------------------- */

function installMany(names: string[], args: ReturnType<typeof parseArgs>): Promise<void> | void {
  const explicitDev = flagBool(args, 'dev');
  const specs = names.map((raw) => {
    const name = extractSpecName(raw);
    const known = getPkg(name);
    return {
      name,
      // Имя без версии заменяем на spec из каталога: там может быть закреплённая версия.
      spec: known && raw === name ? known.spec : raw,
      dev: explicitDev || Boolean(known?.dev),
    };
  });

  return (async () => {
    const dir = process.cwd();
    if (flagBool(args, 'dry')) {
      info(`--dry: ${installText((flagStr(args, 'manager', '') as Manager) || 'npm', specs)}`);
      return;
    }
    const spin = neonSpinner(`устанавливаю ${specs.map((s) => s.name).join(', ')}…`);
    const result = await installToProject(dir, specs, {
      manager: (flagStr(args, 'manager', '') as Manager) || undefined,
      create: true,
    });
    if (!result.ok) {
      spin.fail(result.error ?? 'не получилось');
      return;
    }
    spin.succeed(`установлено: ${result.resolved.length} пакет(ов)`);
    for (const item of result.resolved) {
      process.stdout.write(
        '   ' + paint(item.name, bold(), fg(C.text)) + paint(` ${item.range}`, fg(C.info)) + paint(item.dev ? '  dev' : '', fg(C.faint)) + '\n',
      );
    }
    if (result.created) info('package.json создан — проверь поля name и version.');
    const unknown = specs.filter((s) => !getPkg(s.name)).map((s) => s.name);
    if (unknown.length) {
      process.stdout.write(
        paint(`\n  нет в каталоге: ${unknown.join(', ')} — добавить: jd store add "npm install ${unknown[0]}" --desc="..."\n`, fg(C.faint)),
      );
    }
    process.stdout.write('\n');
  })();
}

/** Установка без аргументов: собрать имена из формы-помощника. */
async function installFlowAssistant(): Promise<void> {
  const catalog = allPkgs();
  const here = installedMap();
  const picks = await selectList(
    catalog.map((pkg) => ({
      label: pkg.name,
      hint: `${pkg.title} — ${truncate(pkg.desc, 50)}${here.has(pkg.name) ? '  ✔' : ''}`,
      group: `${categoryIcon(pkg.category)} ${pkg.category}`,
    })),
    { title: '📥 Что установить?', subtitle: 'печатай для поиска · Enter — поставить', emphasizeGroups: [] },
  );
  if (picks === null) return;
  await installMany([catalog[picks].name], parseArgs([]));
}

/** Добавление записи без вопросов: команда и описание пришли флагами. */
function addNonInteractive(command: string, specFlag: string, args: ReturnType<typeof parseArgs>): void {
  const parsed = command ? parseInstallCommand(command) : { specs: [], dev: false, global: false, manager: null, unknown: [] };
  const spec = specFlag || parsed.specs[0]?.spec || '';
  const name = extractSpecName(spec);
  if (!name) {
    fail('Не понял, какой пакет добавить.', 'jd store add "npm install grammy" --desc="Telegram-боты"');
    return;
  }
  const dev = flagBool(args, 'dev') || Boolean(parsed.specs[0]?.dev);
  const known = getPkg(name);
  const result = savePkg({
    name,
    spec: spec || name,
    title: flagStr(args, 'title', '') || prettifyPackageName(name),
    desc: flagStr(args, 'desc', ''),
    category: flagStr(args, 'category', 'Моё'),
    tags: flagStr(args, 'tags', ''),
    url: flagStr(args, 'url', `https://www.npmjs.com/package/${name}`),
    dev,
  });
  ok(result === 'created' ? `«${name}» добавлен в каталог.` : `Запись «${name}» обновлена.`);

  // Опечатку видно и без интерактива: "grammyjs" вместо "grammy".
  if (!known) {
    const guesses = suggestPackages(name).filter((g) => g !== name);
    if (guesses.length) info(`Похоже на: ${guesses.join(', ')} — если опечатка, удали: jd store remove ${name}`);
  }
}
