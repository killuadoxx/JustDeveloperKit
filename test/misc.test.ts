// История запусков, алиасы и русские числительные — мелочи, на которых всё держится.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expandAlias, loadAliases, removeAlias, resolveAlias, setAlias, tokenize } from '../src/core/alias.ts';
import { failingStats, projectRuns, recordRun, runStatOf, runStats } from '../src/core/runs.ts';
import { kv } from '../src/core/store.ts';
import { countOf, plural } from '../src/core/util.ts';
import { makeProject, removeDir } from './helpers.ts';

/* -------------------------------- числительные ---------------------------- */

test('plural выбирает русскую форму', () => {
  const forms = ['файл', 'файла', 'файлов'] as const;
  assert.equal(plural(1, forms), 'файл');
  assert.equal(plural(2, forms), 'файла');
  assert.equal(plural(4, forms), 'файла');
  assert.equal(plural(5, forms), 'файлов');
  assert.equal(plural(11, forms), 'файлов');
  assert.equal(plural(12, forms), 'файлов');
  assert.equal(plural(14, forms), 'файлов');
  assert.equal(plural(21, forms), 'файл');
  assert.equal(plural(22, forms), 'файла');
  assert.equal(plural(25, forms), 'файлов');
  assert.equal(plural(101, forms), 'файл');
  assert.equal(plural(111, forms), 'файлов');
  assert.equal(plural(0, forms), 'файлов');
});

test('countOf печатает число вместе со словом', () => {
  assert.equal(countOf(1, ['строка', 'строки', 'строк']), '1 строка');
  assert.equal(countOf(1500, ['строка', 'строки', 'строк']), '1\u00A0500 строк');
});

/* ---------------------------------- алиасы -------------------------------- */

test('tokenize разбирает значение с кавычками', () => {
  assert.deepEqual(tokenize('run dev'), ['run', 'dev']);
  assert.deepEqual(tokenize('run "my task"'), ['run', 'my task']);
  assert.deepEqual(tokenize("git status --short"), ['git', 'status', '--short']);
  assert.deepEqual(tokenize('  пробелы   вокруг  '), ['пробелы', 'вокруг']);
  assert.deepEqual(tokenize(''), []);
  assert.deepEqual(tokenize('один "незакрытая'), ['один', 'незакрытая']);
});

test('алиасы сохраняются, находятся и удаляются', () => {
  setAlias('t1', 'run dev');
  assert.equal(resolveAlias('t1'), 'run dev');
  assert.equal(removeAlias('t1'), true);
  assert.equal(removeAlias('t1'), false);
  assert.equal(resolveAlias('t1'), null);
});

test('expandAlias раскрывает цепочку и не зацикливается', () => {
  setAlias('a1', 'run dev');
  setAlias('a2', 'a1 --port=3000');
  setAlias('loop', 'loop forever');

  const single = expandAlias(['a1', '--yes']);
  assert.deepEqual(single?.argv, ['run', 'dev', '--yes']);
  assert.deepEqual(single?.used, ['a1']);

  const chained = expandAlias(['a2']);
  assert.deepEqual(chained?.argv, ['run', 'dev', '--port=3000']);
  assert.deepEqual(chained?.used, ['a2', 'a1']);

  assert.equal(expandAlias(['loop'])?.argv[0], 'loop', 'цикл останавливается на первом повторе');
  assert.equal(expandAlias(['help']), null, 'обычная команда не трогается');
  assert.equal(expandAlias([]), null);

  for (const name of ['a1', 'a2', 'loop']) removeAlias(name);
  assert.deepEqual(loadAliases(), {}, 'после уборки алиасов не остаётся');
});

test('битое значение алиасов в базе не ломает загрузку', () => {
  setAlias('ok1', 'run dev');
  assert.equal(loadAliases().ok1, 'run dev');
  removeAlias('ok1');

  // Если в базе окажется мусор вместо JSON, jd должен просто не видеть алиасов.
  kv.set('aliases', '{это не json');
  assert.deepEqual(loadAliases(), {});
  kv.set('aliases', '["массив","вместо","объекта"]');
  assert.deepEqual(loadAliases(), {});
  kv.set('aliases', '{"правильный":"run dev","пустой":"   ","число":42}');
  assert.deepEqual(loadAliases(), { правильный: 'run dev' });
  kv.set('aliases', '{}');
});

/* ------------------------------ история запусков -------------------------- */

test('runStats считает запуски, падения, среднее и последний запуск', () => {
  const dir = makeProject({ 'package.json': '{}' });
  try {
    recordRun(dir, 'dev', 'npm run dev', true, 1000);
    recordRun(dir, 'dev', 'npm run dev', false, 200);
    recordRun(dir, 'dev', 'npm run dev', true, 3000);
    recordRun(dir, 'build', 'npm run build', true, 5000);

    const stats = runStats(dir);
    const dev = stats.find((s) => s.title === 'dev');
    assert.ok(dev, 'команда dev должна быть в статистике');
    assert.equal(dev?.runs, 3);
    assert.equal(dev?.fails, 1);
    assert.equal(dev?.avgMs, 2000, 'среднее считается по удачным запускам');
    assert.equal(dev?.lastOk, true, 'последним был удачный запуск');
    assert.equal(dev?.lastMs, 3000);
    assert.equal(dev?.lastCmd, 'npm run dev');

    assert.equal(stats[0].title, 'dev', 'сортировка по числу запусков');
    assert.equal(runStatOf(dir, 'build')?.fails, 0);
    assert.equal(runStatOf(dir, 'нет-такой'), null);

    assert.deepEqual(failingStats(stats).map((s) => s.title), ['dev']);
  } finally {
    removeDir(dir);
  }
});

test('история привязана к папке проекта', () => {
  const first = makeProject({ 'package.json': '{}' });
  const second = makeProject({ 'package.json': '{}' });
  try {
    recordRun(first, 'only-here', 'echo 1', true, 10);
    assert.equal(runStats(first).length, 1);
    assert.equal(runStats(second).length, 0, 'чужой проект не видит наши запуски');
    assert.ok(projectRuns(first).length >= 1);
    assert.deepEqual(projectRuns(second), []);
  } finally {
    removeDir(first);
    removeDir(second);
  }
});

test('запись истории не падает на несуществующей папке', () => {
  const ghost = `${makeProject({})}\\нет\\такой`;
  assert.doesNotThrow(() => recordRun(ghost, 'ghost', 'echo', true, 1));
});

/* ------------------------------ состояние меню ---------------------------- */

test('menuStatus собирает строку для шапки', async () => {
  const { menuStatus } = await import('../src/core/status.ts');
  const dir = makeProject({ 'package.json': '{}', '.env.example': 'A=1\n', '.env': '' });
  try {
    const status = await menuStatus({ dir, ports: [] });
    assert.ok(status.right.length > 0, 'строка состояния не пустая');
    assert.ok(status.summary.length > 0);
    assert.equal(typeof status.attention, 'boolean');
    assert.ok(status.summary.some((line) => line.includes('git')), 'git проверяется всегда');
  } finally {
    removeDir(dir);
  }
});

test('menuStatus замечает нехватку переменных окружения', async () => {
  const { menuStatus } = await import('../src/core/status.ts');
  const dir = makeProject({ 'package.json': '{}', '.env.example': 'PORT=3000\n', '.env': 'OTHER=1\n' });
  try {
    const status = await menuStatus({ dir, ports: [] });
    assert.equal(status.attention, true);
    assert.ok(status.right.includes('перем'), `в шапке должно быть про переменные: ${status.right}`);
  } finally {
    removeDir(dir);
  }
});
