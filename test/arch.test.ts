// Архитектура проекта: типы файлов, подсчёт строк, обход дерева.

import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import {
  classifyFile,
  countLines,
  detectEntryPoints,
  detectProjectType,
  flattenFiles,
  isTextKind,
  scanTree,
  shouldSkipDir,
  shouldSkipFile,
} from '../src/core/arch.ts';
import { makeProject, removeDir } from './helpers.ts';

test('classifyFile определяет тип по имени и пути', () => {
  assert.equal(classifyFile('cli.ts', 'src/cli.ts'), 'code');
  assert.equal(classifyFile('bot.tsx', 'src/bot.tsx'), 'code');
  assert.equal(classifyFile('main.go', 'main.go'), 'code');
  assert.equal(classifyFile('schema.prisma', 'prisma/schema.prisma'), 'code');

  assert.equal(classifyFile('arch.test.ts', 'test/arch.test.ts'), 'test');
  assert.equal(classifyFile('utils_test.go', 'internal/utils_test.go'), 'test');
  assert.equal(classifyFile('anything.ts', 'tests/anything.ts'), 'test');

  assert.equal(classifyFile('README.md', 'README.md'), 'doc');
  assert.equal(classifyFile('LICENSE', 'LICENSE'), 'doc');
  assert.equal(classifyFile('notes.txt', 'docs/notes.txt'), 'doc');

  assert.equal(classifyFile('package.json', 'package.json'), 'config');
  assert.equal(classifyFile('tsconfig.json', 'tsconfig.json'), 'config');
  assert.equal(classifyFile('.env.example', '.env.example'), 'config');
  assert.equal(classifyFile('vite.config.ts', 'vite.config.ts'), 'config');
  assert.equal(classifyFile('Dockerfile', 'Dockerfile'), 'config');

  assert.equal(classifyFile('index.css', 'src/index.css'), 'style');
  assert(classifyFile('install.sh', 'scripts/install.sh'), 'script');
  assert(classifyFile('powershell.ps1', 'tools/powershell.ps1'), 'script');
  assert.equal(classifyFile('bot.ts', 'src/templates/telegram-bot/bot.ts'), 'template');
  assert.equal(classifyFile('page.hbs', 'views/page.hbs'), 'template');
  assert.equal(classifyFile('logo.png', 'assets/logo.png'), 'asset');
  assert.equal(classifyFile('dump.csv', 'data/dump.csv'), 'data');
  assert.equal(classifyFile('Makefile', 'Makefile'), 'config');
  assert.equal(classifyFile('странный.xyz', 'странный.xyz'), 'other');
  assert.equal(classifyFile('без-расширения', 'bin/без-расширения'), 'other');
});

test('isTextKind: строки считаем только у текста', () => {
  assert.equal(isTextKind('code'), true);
  assert.equal(isTextKind('test'), true);
  assert.equal(isTextKind('doc'), true);
  assert.equal(isTextKind('asset'), false);
  assert.equal(isTextKind('other'), false);
});

test('countLines считает последнюю строку без перевода строки', () => {
  assert.equal(countLines(''), 0);
  assert.equal(countLines('одна строка'), 1);
  assert.equal(countLines('a\nb'), 2);
  assert.equal(countLines('a\nb\n'), 2);
  assert.equal(countLines('a\r\nb\r\n'), 2);
  assert.equal(countLines('\n'), 1);
});

test('shouldSkipDir: мусорные папки не участвуют в архитектуре', () => {
  for (const dir of ['node_modules', '.git', 'dist', 'build', 'coverage', '.venv', '__pycache__', 'target']) {
    assert.equal(shouldSkipDir(dir), true, `${dir} должен пропускаться`);
  }
  for (const dir of ['src', 'test', 'lib', 'app', 'docs']) {
    assert.equal(shouldSkipDir(dir), false, `${dir} должен попадать в дерево`);
  }
});

test('shouldSkipFile пропускает логи и служебные файлы системы', () => {
  assert.equal(shouldSkipFile('debug.log'), true);
  assert.equal(shouldSkipFile('Thumbs.db'), true);
  assert.equal(shouldSkipFile('index.ts'), false);
});

test('detectProjectType понимает распространённые стеки', () => {
  assert.equal(detectProjectType(['package.json']), 'Node.js');
  assert.equal(detectProjectType(['package.json', 'tsconfig.json']), 'Node.js + TypeScript');
  assert.equal(detectProjectType(['package.json'], true), 'Node.js + TypeScript');
  assert.equal(detectProjectType(['go.mod', 'main.go']), 'Go');
  assert.equal(detectProjectType(['pyproject.toml']), 'Python');
  assert.equal(detectProjectType(['Cargo.toml']), 'Rust');
  assert.equal(detectProjectType(['Dockerfile']), 'Docker');
  assert.equal(detectProjectType(['index.html']), 'статика');
  assert.equal(detectProjectType([]), 'проект');
});

test('detectEntryPoints берёт main/bin и типовые имена', () => {
  const files = [
    { name: 'cli.ts', rel: 'src/cli.ts', kind: 'code' as const, bytes: 10, lines: 1, depth: 2 },
    { name: 'index.ts', rel: 'src/index.ts', kind: 'code' as const, bytes: 10, lines: 1, depth: 2 },
    { name: 'other.ts', rel: 'src/other.ts', kind: 'code' as const, bytes: 10, lines: 1, depth: 2 },
    { name: 'main.py', rel: 'main.py', kind: 'code' as const, bytes: 10, lines: 1, depth: 1 },
  ];
  const found = detectEntryPoints(files, { main: 'src/index.ts', bin: { jd: 'src/cli.ts' } });
  assert.deepEqual(found, ['src/cli.ts', 'src/index.ts', 'main.py'].sort());
  assert.deepEqual(detectEntryPoints(files, { bin: 'src/cli.ts' }).includes('src/cli.ts'), true);
  // Пути, которых нет в дереве, не выдумываем.
  assert.deepEqual(detectEntryPoints([], { main: 'dist/app.js' }), []);
});

test('scanTree: считает файлы, папки, строки и пропускает мусор', () => {
  const dir = makeProject({
    'package.json': JSON.stringify({ name: 'demo', main: 'src/index.ts' }),
    'tsconfig.json': '{}',
    'README.md': '# demo\n\nописание\n',
    'src/index.ts': 'export const x = 1;\nexport const y = 2;\n',
    'src/core/util.ts': 'export const a = 1;\n',
    'test/index.test.ts': 'test("x", () => {});\n',
    'node_modules/chalk/index.js': 'module.exports = {};\n'.repeat(50),
    'dist/bundle.js': 'console.log(1);\n',
    'assets/logo.png': '\u0000PNG\u0000',
  });

  return scanTree(dir, { depth: 4 }).then((summary) => {
    try {
      assert.equal(summary.projectType, 'Node.js + TypeScript');
      assert.equal(summary.files, 7, 'node_modules и dist не считаются, а assets/logo.png считается');
      assert.equal(summary.truncated, false);
      assert.equal(summary.binaryFiles, 1, 'у картинки строк не считаем');

      const kinds = Object.fromEntries(summary.byKind.map((k) => [k.kind, k.stat.files]));
      assert.equal(kinds.code, 2, 'src/index.ts и src/core/util.ts');
      assert.equal(kinds.test, 1, 'test/index.test.ts — это тест, а не код');
      assert.equal(kinds.config, 2);
      assert.equal(kinds.doc, 1);
      assert.equal(kinds.asset, 1);

      const all = flattenFiles(summary.tree);
      assert.equal(all.find((f) => f.rel === 'src/index.ts')?.lines, 2);
      assert.equal(all.find((f) => f.rel === 'README.md')?.lines, 3);
      assert.equal(all.find((f) => f.rel === 'assets/logo.png')?.lines, null, 'бинарный файл без строк');

      assert.deepEqual(summary.entryPoints, ['src/index.ts']);

      const src = summary.tree.dirs.find((d) => d.name === 'src');
      assert.equal(src?.fileCount, 2);
      assert.equal(src?.lines, 3, 'две строки index.ts и одна util.ts');

      // Сумма строк по папкам сходится с итогом.
      assert.equal(summary.tree.lines, summary.lines);

      // Самые тяжёлые файлы: порядок по убыванию размера, первый — реально самый большой.
      assert.ok(summary.top.length > 0);
      const bySize = [...all].sort((a, b) => b.bytes - a.bytes);
      assert.equal(summary.top[0].rel, bySize[0].rel);
      assert.deepEqual(
        summary.top.map((f) => f.bytes),
        [...summary.top.map((f) => f.bytes)].sort((a, b) => b - a),
      );
    } finally {
      removeDir(dir);
    }
  });
});

test('scanTree: --no-lines не читает файлы и не врёт строками', async () => {
  const dir = makeProject({ 'package.json': '{}', 'src/index.ts': 'a\nb\nc\n' });
  try {
    const summary = await scanTree(dir, { lines: false });
    assert.equal(summary.lines, 0);
    assert.equal(summary.files, 2);
    assert.ok(flattenFiles(summary.tree).every((f) => f.lines === null));
  } finally {
    removeDir(dir);
  }
});

test('scanTree: depth ограничивает обход', async () => {
  const dir = makeProject({
    'package.json': '{}',
    'src/index.ts': 'a\n',
    'src/deep/nested/file.ts': 'b\n',
  });
  try {
    const shallow = await scanTree(dir, { depth: 1 });
    const deep = await scanTree(dir, { depth: 6 });
    assert.equal(shallow.files, 2, 'на глубине 1 виден только src/index.ts');
    assert.equal(deep.files, 3);
  } finally {
    removeDir(dir);
  }
});

test('scanTree: пустая папка не падает', async () => {
  const dir = makeProject({});
  try {
    const summary = await scanTree(dir);
    assert.equal(summary.files, 0);
    assert.equal(summary.lines, 0);
    assert.equal(summary.projectType, 'проект');
    assert.deepEqual(summary.byKind, []);
  } finally {
    removeDir(dir);
  }
});

test('scanTree видит проекты без package.json', async () => {
  const dir = makeProject({ 'main.py': 'print(1)\n', 'requirements.txt': 'requests\n' });
  try {
    const summary = await scanTree(dir);
    assert.equal(summary.projectType, 'Python');
    assert.deepEqual(summary.entryPoints, ['main.py']);
    assert.equal(summary.files, 2);
  } finally {
    removeDir(dir);
  }
});

test('scanTree уважает .gitignore проекта', async () => {
  const dir = makeProject({
    'package.json': '{}',
    '.gitignore': 'node_modules/\nscratch/\n# комментарий\n*.log\n/local-only\n!важное\n',
    'src/index.ts': 'a\n',
    'scratch/черновик.ts': 'b\n',
    'local-only/файл.ts': 'c\n',
    'logs/app.ts': 'd\n',
  });
  try {
    const summary = await scanTree(dir);
    const rels = flattenFiles(summary.tree).map((f) => f.rel);
    assert.ok(!rels.some((r) => r.startsWith('scratch/')), 'папка из .gitignore не попадает в архитектуру');
    assert.ok(!rels.some((r) => r.startsWith('local-only/')), 'и /local-only тоже');
    assert.ok(!rels.some((r) => r.startsWith('logs/')), 'и logs, он в списке по умолчанию');
    assert.ok(rels.includes('src/index.ts'));

    // С --all показываем всё: это отладочный режим.
    const everything = await scanTree(dir, { all: true });
    assert.ok(flattenFiles(everything.tree).some((f) => f.rel.startsWith('scratch/')));
  } finally {
    removeDir(dir);
  }
});

test('ignoredDirsFromGitignore понимает простые имена папок', async () => {
  const { ignoredDirsFromGitignore } = await import('../src/core/arch.ts');
  const dirs = ignoredDirsFromGitignore('# коммент\nscratch/\n/local/\n*.log\n!важное\nимя\nподпапка/вложенная\n\n');
  assert.deepEqual([...dirs].sort(), ['local', 'scratch', 'имя']);
});

test('scanTree не путает папку проекта с её именем', async () => {
  const dir = makeProject({ 'package.json': '{}' });
  try {
    const summary = await scanTree(dir);
    assert.equal(summary.name, path.basename(dir));
    assert.equal(summary.root, dir);
  } finally {
    removeDir(dir);
  }
});

/* ------------------------------ вкладки и вёрстка ------------------------- */

test('buildTabs: вкладка на каждую папку, внутри — её папки и файлы', async () => {
  const { buildTabs } = await import('../src/commands/arch.ts');
  const dir = makeProject({
    'package.json': '{}',
    'README.md': '# demo\n',
    'src/index.ts': 'export const a = 1;\n',
    'src/core/util.ts': 'export const b = 2;\n',
    'src/commands/cli.ts': 'export const c = 3;\n',
    'test/index.test.ts': 'test("x", () => {});\n',
  });
  try {
    const summary = await scanTree(dir);
    const { tabs, actions } = buildTabs(summary);

    assert.equal(tabs[0].label.includes('Обзор'), true, 'первая вкладка — обзор');
    assert.equal(actions.length, tabs.length, 'у каждой вкладки свой список действий');

    // Вкладки папок: ровно по одной на папку верхнего уровня плюс «В корне».
    const labels = tabs.map((t) => t.label);
    for (const child of summary.tree.dirs) {
      assert.ok(labels.includes(`📁 ${child.name}`), `нет вкладки для папки ${child.name}`);
    }
    assert.ok(labels.includes('📄 В корне'), 'файлы корня тоже видны');

    // Внутри вкладки папки — именно её содержимое, и действия совпадают с пунктами.
    const srcIndex = labels.indexOf('📁 src');
    const srcTab = tabs[srcIndex];
    const src = summary.tree.dirs.find((d) => d.name === 'src')!;
    assert.equal(srcTab.items.length, src.dirs.length + src.files.length);
    const itemLabels = srcTab.items.map((i) => i.label);
    for (const sub of src.dirs) assert.ok(itemLabels.includes(`📁 ${sub.name}/`), `нет пункта для ${sub.name}/`);
    for (const file of src.files) assert.ok(itemLabels.some((l) => l.includes(file.name)), `нет пункта для ${file.name}`);
    assert.equal(actions[srcIndex].length, srcTab.items.length);

    // У каждого действия есть детали для панели справа.
    for (const tab of tabs) {
      assert.ok(tab.items.length > 0, `вкладка ${tab.label} не должна быть пустой`);
      for (const item of tab.items) {
        assert.ok(item.label.length > 0);
        assert.ok(Array.isArray(item.detail));
      }
    }
  } finally {
    removeDir(dir);
  }
});

test('renderStatic: печатает дерево, разделы и точки входа', async () => {
  const { renderStatic, renderTree } = await import('../src/commands/arch.ts');
  const dir = makeProject({
    'package.json': JSON.stringify({ name: 'demo', main: 'src/index.ts' }),
    'src/index.ts': 'a\nb\n',
    'src/core/deep/util.ts': 'c\n',
    'README.md': '# demo\n',
  });
  try {
    const summary = await scanTree(dir, { depth: 4 });
    const text = renderStatic(summary);
    assert.ok(text.includes('СТРУКТУРА'), 'есть раздел структуры');
    assert.ok(text.includes('ИЗ ЧЕГО СОСТОИТ'), 'есть раздел со статистикой');
    assert.ok(text.includes('📁 src/'), 'папки видны в дереве');
    assert.ok(text.includes('index.ts'), 'файлы видны в дереве');
    assert.ok(text.includes('src/index.ts'), 'точка входа показана');
    assert.ok(text.includes('├─') || text.includes('└─'), 'дерево нарисовано линиями');

    // Дерево рисуется с отступами и не ломается на вложенности.
    const tree = renderTree(summary.tree);
    assert.ok(tree.length >= 4);
    assert.ok(tree.some((line) => line.includes('│')), 'есть вертикальные направляющие');

    // Пустой проект тоже печатается.
    const empty = renderStatic(await scanTree(makeProject({})));
    assert.ok(empty.includes('0 файлов'));
  } finally {
    removeDir(dir);
  }
});
