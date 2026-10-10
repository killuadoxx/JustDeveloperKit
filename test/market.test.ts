// Магазин: каталог, разбор команд установки, план и применение пресета.
//
// Всё, что пишет на диск, работает во временной папке; база — в песочнице
// из helpers.ts (JD_HOME), поэтому настоящие данные разработчика не трогаются.

import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { CATALOG, CATEGORIES, prettifyPackageName } from '../src/core/catalog.ts';
import { PRESETS, TEMPLATES_DIR } from '../src/core/presets.ts';
import {
  allPkgs,
  allPresets,
  applyPresetPlan,
  detectManager,
  extractSpecName,
  getPkg,
  getPreset,
  installText,
  parseInstallCommand,
  planPreset,
  presetFileContent,
  presetFromProject,
  removePkg,
  removePreset,
  restorePkg,
  savePkg,
  savePreset,
  seedCatalog,
  storeStats,
  suggestPackages,
  upsertEnv,
} from '../src/core/market.ts';
import { makeProject, removeDir } from './helpers.ts';

const preset = getPreset('telegram-bot')!;

/* --------------------------------- данные --------------------------------- */

test('каталог: имена уникальны, описания осмысленные, разделы известны', () => {
  assert.ok(CATALOG.length > 100, `в каталоге должно быть много пакетов, а их ${CATALOG.length}`);

  const names = CATALOG.map((e) => e.name);
  assert.equal(new Set(names).size, names.length, `дубликаты в каталоге: ${names.filter((n, i) => names.indexOf(n) !== i).join(', ')}`);

  for (const entry of CATALOG) {
    assert.ok(entry.name.trim().length > 0, 'имя пакета не должно быть пустым');
    assert.ok(entry.desc.trim().length >= 12, `${entry.name}: описание слишком короткое — «${entry.desc}»`);
    assert.ok(CATEGORIES.includes(entry.category), `${entry.name}: неизвестный раздел «${entry.category}»`);
    assert.match(entry.url ?? '', /^https:\/\/www\.npmjs\.com\/package\//, `${entry.name}: странная ссылка`);
    if (entry.spec) assert.ok(entry.spec.startsWith(entry.name), `${entry.name}: spec «${entry.spec}» не совпадает с именем`);
  }
});

test('пресеты: все пакеты есть в каталоге, шаблоны существуют', () => {
  const known = new Set(CATALOG.map((e) => e.name));

  for (const item of PRESETS) {
    assert.ok(item.name && item.title && item.desc, `пресет ${item.name}: не хватает названия или описания`);
    assert.ok(item.items.length > 0, `пресет ${item.name}: пустой набор пакетов`);
    for (const dep of item.items) {
      assert.ok(known.has(dep.name), `пресет ${item.name}: пакет «${dep.name}» отсутствует в каталоге`);
    }
    for (const [script, command] of Object.entries(item.scripts)) {
      assert.ok(script.trim() && command.trim(), `пресет ${item.name}: пустой скрипт ${script}`);
    }
    for (const file of item.files) {
      assert.ok(file.path.startsWith('src/') || file.path.includes('/'), `пресет ${item.name}: странный путь ${file.path}`);
      if (file.template) {
        assert.ok(existsSync(path.join(TEMPLATES_DIR, file.template)), `пресет ${item.name}: нет шаблона ${file.template}`);
        assert.ok(presetFileContent(file).length > 50, `пресет ${item.name}: шаблон ${file.template} подозрительно пустой`);
      }
    }
  }
});

test('каталог засевается один раз и не дублируется', () => {
  seedCatalog(true);
  const first = allPkgs(true).length;
  assert.equal(first, CATALOG.length, 'в базе должно быть столько же записей, сколько в каталоге');

  const addedAgain = seedCatalog(true);
  assert.equal(addedAgain, 0, 'повторное засевание ничего не добавляет');
  assert.equal(allPkgs(true).length, first);
});

test('правка базовой записи делает её своей, скрытие и возврат работают', () => {
  // Правка: после неё каталог не должен перезаписывать описание.
  assert.equal(getPkg('zod')?.builtin, true);
  savePkg({ name: 'zod', desc: 'Моё описание схем валидации', category: 'Моё', dev: true });
  const edited = getPkg('zod');
  assert.equal(edited?.builtin, false, 'правка снимает признак базовой записи');
  assert.equal(edited?.desc, 'Моё описание схем валидации');
  assert.equal(edited?.dev, true);

  // Скрытие базовой записи и возврат.
  assert.equal(removePkg('koa'), 'hidden');
  assert.equal(getPkg('koa')?.hidden, true);
  assert.ok(!allPkgs().some((p) => p.name === 'koa'), 'скрытая запись не попадает в список');
  assert.equal(restorePkg('koa'), true);
  assert.equal(getPkg('koa')?.hidden, false);
  assert.equal(restorePkg('koa'), false, 'дважды вернуть нельзя');

  // Своя запись удаляется по-настоящему.
  savePkg({ name: 'my-lib', desc: 'Моя личная библиотека' });
  assert.equal(removePkg('my-lib'), 'deleted');
  assert.equal(getPkg('my-lib'), null);

  // И это не ломает каталог: счётчики сходятся.
  const stats = storeStats();
  assert.equal(stats.total, allPkgs().length);
});

/* --------------------------- разбор команды ------------------------------- */

test('parseInstallCommand понимает команды так, как их пишет человек', () => {
  assert.deepEqual(parseInstallCommand('npm install grammy').specs, [{ name: 'grammy', spec: 'grammy', dev: false }]);
  assert.deepEqual(parseInstallCommand('npm i grammy zod').specs.map((s) => s.name), ['grammy', 'zod']);
  assert.deepEqual(parseInstallCommand('npm install --save-dev prisma@6').specs, [
    { name: 'prisma', spec: 'prisma@6', dev: true },
  ]);
  assert.deepEqual(parseInstallCommand('pnpm add -D typescript').specs, [
    { name: 'typescript', spec: 'typescript', dev: true },
  ]);
  assert.deepEqual(parseInstallCommand('yarn add zod').specs.map((s) => s.name), ['zod']);
  assert.deepEqual(parseInstallCommand('bun add -d vitest').specs, [{ name: 'vitest', spec: 'vitest', dev: true }]);
  assert.deepEqual(parseInstallCommand('grammy').specs, [{ name: 'grammy', spec: 'grammy', dev: false }]);
  assert.deepEqual(parseInstallCommand('@scope/pkg@1.2.3').specs, [{ name: '@scope/pkg', spec: '@scope/pkg@1.2.3', dev: false }]);
  assert.deepEqual(parseInstallCommand('npm install @grammyjs/runner').specs.map((s) => s.name), ['@grammyjs/runner']);

  // Флаги, которые нас не касаются, не должны попадать в список имён.
  const noisy = parseInstallCommand('npm install --legacy-peer-deps --save-exact grammy');
  assert.deepEqual(noisy.specs.map((s) => s.name), ['grammy']);
  assert.equal(noisy.unknown.length, 0);

  // Менеджер опознаётся, чтобы установка шла тем же менеджером.
  assert.equal(parseInstallCommand('pnpm add zod').manager, 'pnpm');
  assert.equal(parseInstallCommand('zod').manager, null);

  // Глобальная установка — отдельный случай, о нём предупреждаем.
  assert.equal(parseInstallCommand('npm install -g nodemon').global, true);

  // Мусор не превращается в пакеты.
  assert.deepEqual(parseInstallCommand('npm install').specs, []);
  assert.deepEqual(parseInstallCommand('').specs, []);
});

test('extractSpecName отрезает версию и теги', () => {
  assert.equal(extractSpecName('grammy'), 'grammy');
  assert.equal(extractSpecName('grammy@1.30.0'), 'grammy');
  assert.equal(extractSpecName('grammy@latest'), 'grammy');
  assert.equal(extractSpecName('@scope/name'), '@scope/name');
  assert.equal(extractSpecName('@scope/name@2'), '@scope/name');
  assert.equal(extractSpecName('npm:grammy@1'), 'grammy');
  assert.equal(extractSpecName('  '), '');
});

test('installText собирает понятную команду', () => {
  assert.equal(installText('npm', [{ spec: 'grammy', dev: false }]), 'npm install grammy');
  assert.equal(installText('npm', [{ spec: 'prisma@6', dev: true }]), 'npm install --save-dev prisma@6');
  assert.equal(installText('pnpm', [{ spec: 'zod', dev: true }]), 'pnpm add -D zod');
  assert.equal(
    installText('npm', [{ spec: 'grammy', dev: false }, { spec: 'vitest', dev: true }]),
    'npm install grammy && npm install --save-dev vitest',
  );
});

test('suggestPackages ловит опечатку в имени пакета', () => {
  // Ровно тот случай, ради которого это сделано: "npm install grammyjs".
  assert.equal(suggestPackages('grammyjs')[0], 'grammy', 'grammyjs → grammy');
  assert.ok(suggestPackages('fastifyy').includes('fastify'));
  assert.deepEqual(suggestPackages('x'), [], 'слишком короткий запрос не подсказываем');
});

test('prettifyPackageName даёт человеческое имя', () => {
  assert.equal(prettifyPackageName('better-sqlite3'), 'Better Sqlite3');
  assert.equal(prettifyPackageName('@scope/my-lib'), 'My Lib');
  assert.equal(prettifyPackageName('chalk'), 'Chalk');
});

/* ------------------------------- пресеты ---------------------------------- */

test('planPreset: считает, что будет сделано в чистом проекте', () => {
  const dir = makeProject({
    'package.json': JSON.stringify({ name: 'новый', version: '0.1.0' }),
  });
  try {
    const plan = planPreset(preset, dir);
    assert.equal(plan.manager, 'npm');
    assert.equal(plan.items.length, preset.items.length);
    assert.ok(plan.items.every((i) => i.known), 'все пакеты пресета есть в каталоге');
    assert.deepEqual(plan.scripts.map((s) => s.name).sort(), ['dev', 'start', 'typecheck']);
    assert.deepEqual(plan.envAdded.map((e) => e.key).sort(), ['BOT_TOKEN', 'LOG_LEVEL']);
    assert.deepEqual(plan.filesNew.map((f) => f.path), ['src/bot.ts']);
    assert.deepEqual(plan.filesSkipped, []);
    assert.equal(plan.typeModule, true, 'в package.json без type нужно добавить module');
    assert.ok(plan.installText.startsWith('npm install '));
    assert.ok(plan.items.some((i) => i.dev), 'часть пакетов ставится в devDependencies');
  } finally {
    removeDir(dir);
  }
});

test('planPreset: не трогает то, что уже есть в проекте', () => {
  const dir = makeProject({
    'package.json': JSON.stringify({
      name: 'старый',
      version: '1.0.0',
      type: 'module',
      scripts: { dev: 'свой dev' },
      dependencies: { grammy: '^1.0.0' },
    }),
    '.env': 'BOT_TOKEN=уже-тут\n',
    'src/bot.ts': '// мой бот\n',
  });
  try {
    const plan = planPreset(preset, dir);
    assert.equal(plan.typeModule, false, 'type: module уже есть');
    assert.ok(!plan.scripts.some((s) => s.name === 'dev'), 'скрипт dev не перезаписываем');
    assert.deepEqual(plan.scriptsSkipped.map((s) => s.name), ['dev']);
    assert.deepEqual(plan.envSkipped, ['BOT_TOKEN']);
    assert.deepEqual(plan.envAdded.map((e) => e.key), ['LOG_LEVEL']);
    assert.deepEqual(plan.filesSkipped.map((f) => f.path), ['src/bot.ts']);
    assert.deepEqual(plan.filesNew, []);
    assert.equal(plan.items.find((i) => i.name === 'grammy')?.installedRange, '^1.0.0');
  } finally {
    removeDir(dir);
  }
});

test('applyPresetPlan без установки: файлы, скрипты, .env и .gitignore', async () => {
  const dir = makeProject({
    'package.json': JSON.stringify({ name: 'bot', version: '0.1.0', scripts: { lint: 'eslint .' } }),
    '.gitignore': 'node_modules/\n',
  });
  try {
    const plan = planPreset(preset, dir);
    const result = await applyPresetPlan(plan, { install: false });

    assert.equal(result.error, undefined);
    assert.equal(result.installed, false, 'установку мы отключили');
    assert.equal(result.typeModule, true);
    assert.deepEqual(result.files, ['src/bot.ts']);
    assert.deepEqual(result.scripts.sort(), ['dev', 'start', 'typecheck']);
    assert.deepEqual(result.env.sort(), ['BOT_TOKEN', 'LOG_LEVEL']);
    assert.equal(result.gitignore, true, '.env должен быть добавлен в .gitignore');

    const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as {
      type?: string;
      scripts: Record<string, string>;
    };
    assert.equal(pkg.type, 'module');
    assert.equal(pkg.scripts.lint, 'eslint .', 'чужие скрипты не трогаем');
    assert.equal(pkg.scripts.dev, 'node --watch src/bot.ts');

    assert.ok(existsSync(path.join(dir, '.env')));
    assert.ok(existsSync(path.join(dir, '.env.example')));
    const env = readFileSync(path.join(dir, '.env'), 'utf8');
    assert.ok(env.includes('BOT_TOKEN='), 'переменная попала в .env');
    assert.ok(env.includes('LOG_LEVEL=info'), 'значение по умолчанию сохранилось');
    const gitignore = readFileSync(path.join(dir, '.gitignore'), 'utf8');
    assert.match(gitignore, /^\.env$/m, '.env должен игнорироваться git');
    assert.ok(gitignore.includes('node_modules/'), 'старое содержимое .gitignore на месте');

    const bot = readFileSync(path.join(dir, 'src', 'bot.ts'), 'utf8');
    assert.ok(bot.includes('grammy'), 'файл-заготовка скопирован из шаблона');
    assert.ok(bot.includes('BOT_TOKEN'), 'в заготовке есть чтение токена');

    // Повторное применение не должно ничего дублировать или ломать.
    const again = planPreset(preset, dir);
    const second = await applyPresetPlan(again, { install: false });
    assert.deepEqual(second.files, [], 'существующий файл не перезаписывается');
    assert.deepEqual(second.env, [], 'переменные не добавляются второй раз');
    assert.equal(second.typeModule, false);
    assert.equal(readFileSync(path.join(dir, '.env'), 'utf8'), env, '.env не изменился');
    assert.equal(readFileSync(path.join(dir, '.gitignore'), 'utf8'), gitignore, '.gitignore не изменился');
  } finally {
    removeDir(dir);
  }
});

test('applyPresetPlan: ошибка установки останавливает работу и не пишет файлы', async () => {
  const dir = makeProject({ 'package.json': JSON.stringify({ name: 'bot', version: '0.1.0' }) });
  try {
    const plan = planPreset(preset, dir);
    const result = await applyPresetPlan(plan, {
      installer: async () => ({ ok: false, text: 'npm install grammy', ms: 12, stderr: 'npm ERR! code E404\nnpm ERR! 404 Not Found', stdout: '' }),
    });
    assert.ok(result.error, 'ошибка должна быть в результате');
    assert.match(result.error ?? '', /404/);
    assert.ok(!existsSync(path.join(dir, 'src', 'bot.ts')), 'файлы не создаются после падения установки');
    assert.ok(!existsSync(path.join(dir, '.env')), '.env не создаётся после падения установки');
  } finally {
    removeDir(dir);
  }
});

test('presetFromProject собирает набор из package.json, не копируя секреты', () => {
  const dir = makeProject({
    'package.json': JSON.stringify({
      name: 'мой-проект',
      dependencies: { grammy: '^1.0.0', zod: '^3.23.0' },
      devDependencies: { typescript: '^5.6.0' },
      scripts: { dev: 'node --watch src/index.ts' },
    }),
    '.env': 'BOT_TOKEN=супер-секретный-токен\nAPI_URL=https://example.com\n',
  });
  try {
    const built = presetFromProject(dir, 'my-stack');
    assert.ok(built);
    assert.equal(built?.name, 'my-stack');
    assert.equal(built?.items.length, 3);
    assert.deepEqual(built?.items.find((i) => i.name === 'typescript')?.dev, true);
    assert.deepEqual(built?.items.find((i) => i.name === 'grammy')?.dev, false);
    assert.equal(built?.scripts.dev, 'node --watch src/index.ts');
    assert.deepEqual(Object.keys(built?.env ?? {}).sort(), ['API_URL', 'BOT_TOKEN']);
    assert.ok(
      Object.values(built?.env ?? {}).every((v) => v === ''),
      'значения переменных в пресет не попадают — только имена',
    );
    assert.ok(!JSON.stringify(built).includes('супер-секретный-токен'), 'секрет не должен утечь в пресет');
  } finally {
    removeDir(dir);
  }
});

test('пользовательские пресеты сохраняются, перекрывают встроенные и удаляются', () => {
  const custom = { ...preset, desc: 'Моя версия бота', note: 'своё' };
  savePreset(custom);

  const found = getPreset('telegram-bot');
  assert.equal(found?.custom, true);
  assert.equal(found?.desc, 'Моя версия бота', 'своя версия важнее встроенной');

  const list = allPresets();
  assert.equal(list.filter((p) => p.name === 'telegram-bot').length, 1, 'пресет не должен дублироваться');
  assert.ok(list.some((p) => p.custom), 'свои пресеты есть в списке');
  assert.ok(list.some((p) => !p.custom), 'встроенные тоже на месте');

  assert.equal(removePreset('telegram-bot'), true);
  assert.equal(getPreset('telegram-bot')?.custom, false, 'после удаления снова виден встроенный');
});

/* --------------------------------- мелочи --------------------------------- */

test('detectManager выбирает менеджер по lock-файлу', () => {
  const npm = makeProject({ 'package-lock.json': '{}' });
  const pnpm = makeProject({ 'pnpm-lock.yaml': 'lockfileVersion: 9' });
  const yarn = makeProject({ 'yarn.lock': '# yarn' });
  const bun = makeProject({ 'bun.lockb': '' });
  const empty = makeProject({ 'package.json': '{}' });
  try {
    assert.equal(detectManager(npm), 'npm');
    assert.equal(detectManager(pnpm), 'pnpm');
    assert.equal(detectManager(yarn), 'yarn');
    assert.equal(detectManager(bun), 'bun');
    assert.equal(detectManager(empty), 'npm', 'по умолчанию npm');
  } finally {
    for (const dir of [npm, pnpm, yarn, bun, empty]) removeDir(dir);
  }
});

test('upsertEnv дописывает только недостающие переменные', () => {
  const dir = makeProject({ '.env': 'ЕСТЬ=старое-значение\n' });
  try {
    const result = upsertEnv(dir, { ЕСТЬ: 'новое-значение', НОВАЯ: 'значение' });
    // В .env.example попадают все ключи, в .env — только отсутствующие.
    assert.deepEqual([...result.added].sort(), ['ЕСТЬ', 'НОВАЯ']);
    assert.ok(result.skipped.includes('ЕСТЬ'), 'существующая переменная отмечена как пропущенная');
    assert.deepEqual(result.files.sort(), ['.env', '.env.example']);

    const text = readFileSync(path.join(dir, '.env'), 'utf8');
    assert.ok(text.includes('ЕСТЬ=старое-значение'), 'существующее значение не перезаписывается');
    assert.ok(text.includes('НОВАЯ=значение'));
    assert.ok(!text.includes('новое-значение'), 'значение не подменяется');

    const example = readFileSync(path.join(dir, '.env.example'), 'utf8');
    assert.ok(example.includes('ЕСТЬ=новое-значение') && example.includes('НОВАЯ=значение'), 'в примере есть все ключи');
  } finally {
    removeDir(dir);
  }
});

test('upsertEnv ничего не делает без переменных', () => {
  const dir = makeProject({});
  try {
    const result = upsertEnv(dir, {});
    assert.deepEqual(result.added, []);
    assert.ok(!existsSync(path.join(dir, '.env')));
  } finally {
    removeDir(dir);
  }
});

test('ensureGitignored не дублирует запись и не создаёт .gitignore сам', () => {
  const withFile = makeProject({ '.gitignore': '.env\nnode_modules/\n' });
  const withoutFile = makeProject({});
  try {
    const before = readFileSync(path.join(withFile, '.gitignore'), 'utf8');
    upsertEnv(withFile, { X: '1' });
    assert.equal(readFileSync(path.join(withFile, '.gitignore'), 'utf8'), before, 'уже игнорируется — не трогаем');

    upsertEnv(withoutFile, { X: '1' });
    assert.ok(!existsSync(path.join(withoutFile, '.gitignore')), '.gitignore не создаём из ниоткуда');
  } finally {
    removeDir(withFile);
    removeDir(withoutFile);
  }
});
