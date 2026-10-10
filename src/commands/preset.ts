// jd preset — пресеты: наборы пакетов, скриптов и заготовок под задачу.
//
// Пресет ставится в текущий проект: пакеты, npm-скрипты, переменные окружения
// из .env.example/.env и файлы-шаблоны. Всё, что уже есть, не перезаписывается.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { flagBool, flagStr, parseArgs } from '../core/args.ts';
import { fail, info, ok } from '../core/help.ts';
import { confirm, isInteractive, multiSelect, promptText, selectList } from '../core/input.ts';
import {
  allPkgs,
  allPresets,
  applyPresetPlan,
  bumpPresetUses,
  ensurePackageJson,
  getPreset,
  planPreset,
  presetFromProject,
  readProjectPackage,
  removePreset,
  savePreset,
  type PresetPlan,
} from '../core/market.ts';
import { neonSpinner } from '../core/neon.ts';
import type { Preset } from '../core/presets.ts';
import { C, bold, fg, paint } from '../core/theme.ts';
import { box, table, truncate } from '../core/ui.ts';
import { stripBom } from '../core/util.ts';
import type { Command } from '../core/registry.ts';

type FullPreset = Preset & { custom: boolean; uses: number };

function presetCard(preset: Preset, opts: { installed?: Map<string, { range: string; dev: boolean }> } = {}): string {
  const lines: string[] = [];
  lines.push(paint(preset.desc || 'без описания', fg(C.soft)));
  lines.push('');

  const deps = preset.items.filter((i) => !i.dev);
  const dev = preset.items.filter((i) => i.dev);
  const describe = (names: string[]): string =>
    names
      .map((n) => {
        const installed = opts.installed?.get(n);
        return installed ? paint(n, fg(C.ok)) : n;
      })
      .join(', ');

  if (deps.length) lines.push(paint('зависимости  ', fg(C.muted)) + paint(describe(deps.map((i) => i.name)), fg(C.text)));
  if (dev.length) lines.push(paint('для разработки ', fg(C.muted)) + paint(describe(dev.map((i) => i.name)), fg(C.soft)));

  const scripts = Object.entries(preset.scripts);
  if (scripts.length) {
    lines.push(paint('скрипты      ', fg(C.muted)) + paint(scripts.map(([k]) => k).join(', '), fg(C.accent)));
  }
  const envKeys = Object.keys(preset.env);
  if (envKeys.length) lines.push(paint('переменные   ', fg(C.muted)) + paint(envKeys.join(', '), fg(C.info)));
  if (preset.files.length) {
    lines.push(paint('файлы        ', fg(C.muted)) + paint(preset.files.map((f) => f.path).join(', '), fg(C.cyan)));
  }
  if (preset.note) {
    lines.push('');
    lines.push(paint('дальше: ', fg(C.warn)) + paint(preset.note, fg(C.muted)));
  }
  lines.push('');
  lines.push(paint('применить: ', fg(C.faint)) + paint(`jd preset apply ${preset.name}`, fg(C.cyan)));
  return box(lines, { title: paint(`${preset.icon} ${preset.title}`, bold(), fg(C.accent)) });
}

function planCard(plan: PresetPlan): string {
  const lines: string[] = [];
  lines.push(paint(`папка: ${plan.dir}`, fg(C.faint)));
  lines.push(paint(`менеджер: ${plan.manager}`, fg(C.faint)));
  lines.push('');

  lines.push(paint(`ПАКЕТЫ (${plan.items.length})`, bold(), fg(C.accent)));
  for (const item of plan.items) {
    const mark = item.installedRange ? paint('✔', fg(C.ok)) : paint('+', bold(), fg(C.warn));
    const tail = item.installedRange
      ? paint(`уже стоит ${item.installedRange}`, fg(C.ok))
      : paint(item.dev ? 'devDependencies' : 'dependencies', fg(C.faint));
    lines.push(` ${mark} ${paint(item.name, fg(C.text))}  ${paint(truncate(item.desc, 46), fg(C.muted))}  ${tail}`);
  }

  if (plan.scripts.length) {
    lines.push('');
    lines.push(paint('СКРИПТЫ В package.json', bold(), fg(C.accent)));
    for (const s of plan.scripts) lines.push(` + ${paint(s.name, fg(C.text))} → ${paint(s.value, fg(C.muted))}`);
  }
  if (plan.scriptsSkipped.length) {
    lines.push(paint(`   пропущу (уже есть): ${plan.scriptsSkipped.map((s) => s.name).join(', ')}`, fg(C.faint)));
  }
  if (plan.envAdded.length) {
    lines.push('');
    lines.push(paint('ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ (.env.example и .env)', bold(), fg(C.accent)));
    for (const e of plan.envAdded) lines.push(` + ${paint(e.key, fg(C.text))}${e.value ? paint(`=${e.value}`, fg(C.muted)) : paint('  (пустое — заполни сам)', fg(C.faint))}`);
  }
  if (plan.envSkipped.length) {
    lines.push(paint(`   уже есть, не трону: ${plan.envSkipped.join(', ')}`, fg(C.faint)));
  }
  if (plan.filesNew.length) {
    lines.push('');
    lines.push(paint('ФАЙЛЫ', bold(), fg(C.accent)));
    for (const f of plan.filesNew) lines.push(` + ${paint(f.path, fg(C.cyan))}${f.desc ? paint(`  ${f.desc}`, fg(C.muted)) : ''}`);
  }
  if (plan.filesSkipped.length) {
    lines.push(paint(`   пропущу существующие: ${plan.filesSkipped.map((f) => f.path).join(', ')}`, fg(C.faint)));
  }
  if (plan.typeModule) {
    lines.push('');
    lines.push(paint(' + ', fg(C.warn)) + paint('"type": "module"', fg(C.text)) + paint(' в package.json (нужно для импортов в шаблонах)', fg(C.muted)));
  }
  return box(lines, { title: paint(`План: ${plan.preset.icon} ${plan.preset.title}`, bold(), fg(C.accent)) });
}

function printList(): void {
  const presets = allPresets();
  const installed = new Map<string, { range: string; dev: boolean }>();
  const pkg = readProjectPackage(process.cwd());
  for (const [name, range] of Object.entries(pkg.deps)) installed.set(name, { range, dev: false });
  for (const [name, range] of Object.entries(pkg.devDeps)) installed.set(name, { range, dev: true });

  process.stdout.write(
    '\n' +
      table(
        ['ПРЕСЕТ', 'ЧТО ВНУТРИ', 'ПАКЕТЫ', 'ИСТОЧНИК'],
        presets.map((preset) => {
          const have = preset.items.filter((i) => installed.has(i.name)).length;
          return [
            paint(`${preset.icon} ${preset.name}`, bold(), fg(C.text)),
            paint(truncate(preset.desc, 52), fg(C.muted)),
            paint(`${have}/${preset.items.length}`, fg(have === preset.items.length ? C.ok : C.faint)),
            preset.custom ? paint('свой', fg(C.warn)) : paint('встроенный', fg(C.faint)),
          ];
        }),
      ) +
      '\n',
  );
  process.stdout.write(
    paint('  посмотреть: jd preset show <имя>   ·   применить: jd preset apply <имя>   ·   свой: jd preset new\n', fg(C.faint)) +
      paint('  собрать из текущего проекта: jd preset from-project\n\n', fg(C.faint)),
  );
}

async function apply(preset: FullPreset, args: ReturnType<typeof parseArgs>): Promise<void> {
  const dir = path.resolve(process.cwd());
  const manager = (flagStr(args, 'manager', '') || undefined) as 'npm' | 'pnpm' | 'yarn' | 'bun' | undefined;

  if (!readProjectPackage(dir).exists) {
    if (flagBool(args, 'dry')) {
      info('package.json нет — при применении он будет создан.');
    } else if (isInteractive() && (await confirm('В папке нет package.json. Создать?', true))) {
      const made = ensurePackageJson(dir, manager ?? 'npm');
      if (made === 'created') ok('package.json создан (name, version, type: module).');
    } else {
      fail('Некуда устанавливать.', 'Создай package.json (npm init -y) или запусти из папки проекта.');
      return;
    }
  }

  const plan = planPreset(preset, dir, { manager });
  process.stdout.write('\n' + planCard(plan) + '\n\n');

  if (flagBool(args, 'dry')) {
    info(`--dry: выполнил бы  ${plan.installText}`);
    return;
  }

  if (!flagBool(args, 'yes')) {
    if (!isInteractive()) {
      fail('Нужно подтверждение, а терминал неинтерактивный.', 'Добавь --yes.');
      return;
    }
    const go = await confirm(`Применить пресет «${preset.title}»?`, true);
    if (!go) {
      info('Отменено.');
      return;
    }
  }

  const skipInstall = !flagBool(args, 'install', true);
  process.stdout.write('\n');
  const spin = neonSpinner(
    skipInstall ? 'пропускаю установку (--no-install)' : `ставлю ${plan.items.length} пакет(ов) через ${plan.manager}…`,
  );
  const result = await applyPresetPlan(plan, {
    install: !skipInstall,
    // --no-files / --no-env / --no-scripts разбираются как flags.files = false.
    scripts: flagBool(args, 'scripts', true),
    env: flagBool(args, 'env', true),
    files: flagBool(args, 'files', true),
  });

  if (result.error) {
    spin.fail(`установка не удалась — ${result.error}`);
    process.stdout.write(paint('  Часть шагов не выполнена. Поправь причину и повтори — уже сделанное не сломается.\n\n', fg(C.muted)));
    return;
  }
  spin.succeed(skipInstall ? 'установку пакетов пропустил (--no-install)' : `пакеты установлены (${result.installText})`);
  if (result.typeModule) info('добавил "type": "module" в package.json');
  if (result.scripts.length) info(`скрипты: ${result.scripts.join(', ')}`);
  if (result.env.length) info(`переменные в ${result.envFiles.join(' и ')}: ${result.env.join(', ')}`);
  if (result.gitignore) info('.env добавлен в .gitignore — секреты не уедут в репозиторий');
  for (const file of result.files) info(`создан ${file}`);
  for (const file of result.skippedFiles) info(`${file} уже был — не тронул`);

  bumpPresetUses(preset.name);
  if (preset.note) {
    process.stdout.write('\n  ' + paint('дальше: ', fg(C.warn)) + paint(preset.note, fg(C.text)) + '\n');
  }
  process.stdout.write('\n' + paint('  что получилось: jd doctor · что установилось: jd store installed\n\n', fg(C.faint)));
}

/** Сборка пресета вручную: пакеты выбираются из магазина. */
async function buildForm(): Promise<void> {
  info('Соберу пресет по шагам. Esc на любом выборе — отмена.');

  const title = await promptText('Название пресета', '');
  if (!title.trim()) return;
  const name = (await promptText('Короткое имя (латиницей, для команды)', title.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '')))
    .trim()
    .toLowerCase();
  if (!name) return;
  const desc = await promptText('Одной строкой: для чего этот набор', '');
  const icon = await promptText('Иконка', '📦');

  const catalog = allPkgs();
  const picked = await multiSelect(
    catalog.map((pkg) => ({
      label: pkg.name,
      hint: `${pkg.title} — ${truncate(pkg.desc, 46)}`,
      group: `${categoryIcon(pkg.category)} ${pkg.category}`,
    })),
    { title: 'Какие пакеты включить?', subtitle: 'печатай для поиска по названию и описанию' },
  );
  if (picked === null) return;
  if (!picked.length) {
    fail('Ни одного пакета не выбрано.');
    return;
  }

  const scripts: Record<string, string> = {};
  for (;;) {
    const scriptName = await promptText('Скрипт в package.json (пусто — закончить)', '');
    if (!scriptName.trim()) break;
    const value = await promptText(`Команда для "${scriptName}"`, '');
    scripts[scriptName.trim()] = value.trim();
  }

  const envRaw = await promptText('Переменные окружения через запятую (необязательно)', '');
  const env = Object.fromEntries(
    envRaw
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean)
      .map((k) => [k, '']),
  );
  const note = await promptText('Что делать после установки (необязательно)', '');

  const preset: Preset = {
    name,
    title: title.trim(),
    desc: desc.trim(),
    icon: icon.trim() || '📦',
    items: picked.map((index) => ({ name: catalog[index].name, dev: catalog[index].dev })),
    scripts,
    env,
    files: [],
    note: note.trim() || undefined,
  };

  process.stdout.write('\n' + presetCard(preset) + '\n\n');
  const keep = await confirm(`Сохранить пресет «${name}»?`, true);
  if (!keep) {
    info('Отменено.');
    return;
  }
  savePreset(preset);
  ok(`Пресет «${name}» сохранён.`);
  process.stdout.write(
    paint(`  применить: jd preset apply ${name}\n`, fg(C.faint)) +
      paint(`  файлы-заготовки можно дописать вручную: jd preset export ${name} --out=preset.json, потом jd preset import\n\n`, fg(C.faint)),
  );
}

function exportPreset(preset: Preset, out: string): void {
  const payload: Preset = {
    name: preset.name,
    title: preset.title,
    desc: preset.desc,
    icon: preset.icon,
    items: preset.items,
    scripts: preset.scripts,
    env: preset.env,
    files: preset.files,
    note: preset.note,
  };
  const text = JSON.stringify(payload, null, 2) + '\n';
  if (!out) {
    process.stdout.write(text);
    return;
  }
  const target = path.resolve(out);
  if (existsSync(target)) {
    fail(`Файл ${target} уже существует.`, 'Укажи другое имя: --out=другой.json');
    return;
  }
  writeFileSync(target, text, 'utf8');
  ok(`Пресет выгружен в ${target}`);
  process.stdout.write(paint('  можно править руками: файлы в поле files лежат содержимым (content)\n\n', fg(C.faint)));
}

function importPreset(file: string): void {
  const target = path.resolve(file);
  if (!existsSync(target)) {
    fail(`Файл ${file} не найден.`);
    return;
  }
  let parsed: Preset;
  try {
    parsed = JSON.parse(stripBom(readFileSync(target, 'utf8'))) as Preset;
  } catch (err) {
    fail(`Не разобрался JSON: ${(err as Error).message}`);
    return;
  }
  if (!parsed?.name || !Array.isArray(parsed.items)) {
    fail('Это не похоже на пресет.', 'Нужны поля name и items.');
    return;
  }
  savePreset({
    name: parsed.name,
    title: parsed.title ?? parsed.name,
    desc: parsed.desc ?? '',
    icon: parsed.icon ?? '📦',
    items: parsed.items,
    scripts: parsed.scripts ?? {},
    env: parsed.env ?? {},
    files: parsed.files ?? [],
    note: parsed.note,
  });
  ok(`Пресет «${parsed.name}» импортирован.`);
}

async function browse(): Promise<void> {
  for (;;) {
    const presets = allPresets();
    const pick = await selectList(
      presets.map((preset) => ({
        label: `${preset.icon} ${preset.title}`,
        hint: `${preset.desc}${preset.custom ? '   · свой' : ''}`,
      })),
      { title: '📦 Пресеты', subtitle: 'Enter — посмотреть и применить · Esc — выйти' },
    );
    if (pick === null) return;

    const preset = presets[pick];
    process.stdout.write('\n' + presetCard(preset) + '\n\n');
    const go = await confirm(`Применить «${preset.title}» в текущей папке?`, true);
    if (!go) continue;
    await apply(preset, parseArgs([]));
    return;
  }
}

export default {
  name: 'preset',
  aliases: ['presets', 'scaffold'],
  group: 'Магазин',
  title: 'Пресеты',
  desc: 'Готовые наборы: Telegram-бот, REST API, Prisma, очереди задач — в один шаг',
  usage: 'jd preset [list|show|apply|new|from-project|remove|export|import] [аргументы]',
  examples: [
    'jd preset',
    'jd preset list',
    'jd preset show telegram-bot',
    'jd preset apply telegram-bot',
    'jd preset from-project my-stack',
    'jd preset apply api-rest --no-install   (только скрипты, .env и файлы)',
  ],

  async run({ argv }) {
    const args = parseArgs(argv, {
      json: 'boolean', yes: 'boolean', dry: 'boolean', manager: 'string', out: 'string',
      files: 'boolean', env: 'boolean', scripts: 'boolean', install: 'boolean',
    });
    const known = new Set(['list', 'ls', 'show', 'apply', 'use', 'new', 'create', 'from-project', 'remove', 'rm', 'export', 'import']);
    const sub = (args._[0] ?? '').toLowerCase();
    const rest = known.has(sub) ? args._.slice(1) : args._;

    switch (sub) {
      case 'list':
      case 'ls':
        printList();
        return;

      case 'show': {
        const preset = getPreset(rest[0] ?? '');
        if (!preset) {
          fail(`Пресет «${rest[0] ?? ''}» не найден.`, `Есть: ${allPresets().map((p) => p.name).join(', ')}`);
          return;
        }
        const installed = new Map<string, { range: string; dev: boolean }>();
        const pkg = readProjectPackage(process.cwd());
        for (const [name, range] of Object.entries(pkg.deps)) installed.set(name, { range, dev: false });
        for (const [name, range] of Object.entries(pkg.devDeps)) installed.set(name, { range, dev: true });
        process.stdout.write('\n' + presetCard(preset, { installed }) + '\n\n');
        if (flagBool(args, 'files')) {
          const dir = path.resolve(process.cwd());
          process.stdout.write(planCard(planPreset(preset, dir)) + '\n\n');
        }
        return;
      }

      case 'apply':
      case 'use': {
        const name = rest[0] ?? '';
        if (!name) {
          if (isInteractive()) return browse();
          fail('Какой пресет применить?', `jd preset apply <имя>. Есть: ${allPresets().map((p) => p.name).join(', ')}`);
          return;
        }
        const preset = getPreset(name);
        if (!preset) {
          fail(`Пресет «${name}» не найден.`, `Есть: ${allPresets().map((p) => p.name).join(', ')}`);
          return;
        }
        await apply(preset, args);
        return;
      }

      case 'new':
      case 'create':
        if (!isInteractive()) {
          fail('Сборка пресета — интерактивная.', 'Собери его в терминале или импортируй: jd preset import preset.json');
          return;
        }
        await buildForm();
        return;

      case 'from-project': {
        const dir = path.resolve(process.cwd());
        const pkg = readProjectPackage(dir);
        const name = (rest[0] ?? String(pkg.json?.name ?? path.basename(dir))).trim().toLowerCase();
        const preset = presetFromProject(dir, name);
        if (!preset) {
          fail('В этом проекте нечего сохранять.', 'Нужен package.json с зависимостями.');
          return;
        }
        process.stdout.write('\n' + presetCard(preset) + '\n\n');
        if (isInteractive()) {
          const keep = await confirm(`Сохранить пресет «${name}» из этого проекта?`, true);
          if (!keep) {
            info('Отменено.');
            return;
          }
        }
        savePreset(preset);
        ok(`Пресет «${name}» сохранён: ${preset.items.length} пакетов, ${Object.keys(preset.scripts).length} скриптов.`);
        process.stdout.write(
          paint('  значения переменных в пресет не попали — только имена\n', fg(C.faint)) +
            paint(`  применить в другом проекте: jd preset apply ${name}\n\n`, fg(C.faint)),
        );
        return;
      }

      case 'remove':
      case 'rm': {
        const name = rest[0] ?? '';
        const preset = getPreset(name);
        if (!preset) {
          fail(`Пресет «${name}» не найден.`);
          return;
        }
        if (!preset.custom) {
          fail(`«${name}» встроенный — его удалить нельзя.`, 'Можешь сделать свой с тем же именем: jd preset new');
          return;
        }
        if (!flagBool(args, 'yes') && isInteractive() && !(await confirm(`Удалить пресет «${name}»?`, false))) {
          info('Отменено.');
          return;
        }
        ok(removePreset(name) ? `Пресет «${name}» удалён.` : `Пресет «${name}» не найден.`);
        return;
      }

      case 'export': {
        const name = rest[0] ?? '';
        const preset = getPreset(name);
        if (!preset) {
          fail(`Пресет «${name}» не найден.`, `Есть: ${allPresets().map((p) => p.name).join(', ')}`);
          return;
        }
        exportPreset(preset, flagStr(args, 'out', ''));
        return;
      }

      case 'import': {
        const file = rest[0] ?? '';
        if (!file) {
          fail('Какой файл импортировать?', 'jd preset import preset.json');
          return;
        }
        importPreset(file);
        return;
      }

      default: {
        if (sub && !known.has(sub)) {
          const preset = getPreset(sub);
          if (preset) return apply(preset, args);
        }
        if (flagBool(args, 'json')) {
          process.stdout.write(JSON.stringify(allPresets(), null, 2) + '\n');
          return;
        }
        if (!isInteractive()) {
          printList();
          return;
        }
        await browse();
        return;
      }
    }
  },
} satisfies Command;
