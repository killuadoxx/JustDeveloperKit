// Cron, хеши, наблюдение за файлами и снимки архитектуры — партия «финальных» команд.

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { diffSnapshots, scanTree, snapshotOf } from '../src/core/arch.ts';
import { CronError, describeCron, matchesCron, nextRuns, parseCron } from '../src/core/cron.ts';
import { hashFile, hashText } from '../src/commands/hash.ts';
import { compareStates, describeChange, fileState, isEmptyChange, waitForUrl } from '../src/core/watch.ts';
import { makeProject, removeDir } from './helpers.ts';

/* ----------------------------------- cron --------------------------------- */

test('parseCron понимает поля, списки, шаги и имена', () => {
  const expr = parseCron('*/15 9-18 * * MON-FRI');
  assert.deepEqual([...expr.minute.values].sort((a, b) => a - b), [0, 15, 30, 45]);
  assert.deepEqual([...expr.hour.values].sort((a, b) => a - b), [9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
  assert.deepEqual([...expr.dayOfWeek.values].sort((a, b) => a - b), [1, 2, 3, 4, 5]);
  assert.equal(expr.minute.wildcard, false);
  assert.equal(expr.month.wildcard, true);
});

test('parseCron: воскресенье и как 0, и как 7', () => {
  assert.deepEqual([...parseCron('0 0 * * 7').dayOfWeek.values], [0]);
  assert.deepEqual([...parseCron('0 0 * * SUN').dayOfWeek.values], [0]);
  assert.deepEqual([...parseCron('0 0 * * 0,6').dayOfWeek.values].sort((a, b) => a - b), [0, 6]);
});

test('parseCron: понятные ошибки вместо падения', () => {
  assert.throws(() => parseCron('0 9 * *'), CronError, 'четыре поля — ошибка');
  assert.throws(() => parseCron(''), CronError);
  assert.throws(() => parseCron('70 9 * * *'), CronError, 'минута вне диапазона');
  assert.throws(() => parseCron('*/0 9 * * *'), CronError, 'шаг 0 невозможен');
  assert.throws(() => parseCron('10-5 9 * * *'), CronError, 'диапазон наоборот');
});

test('parseCron понимает короткие имена @daily и подобные', () => {
  assert.deepEqual([...parseCron('@daily').hour.values], [0]);
  assert.deepEqual([...parseCron('@hourly').minute.values], [0]);
  assert.deepEqual([...parseCron('@weekly').dayOfWeek.values], [0]);
  assert.deepEqual([...parseCron('@monthly').dayOfMonth.values], [1]);
});

test('describeCron объясняет словами', () => {
  const text = describeCron(parseCron('0 9 * * 1-5')).join(' | ');
  assert.match(text, /в 09:00/);
  assert.match(text, /по будням/);

  assert.match(describeCron(parseCron('*/5 * * * *')).join(' | '), /каждые 5 мин/);
  assert.match(describeCron(parseCron('30 3 1 * *')).join(' | '), /числа 1/);
  assert.match(describeCron(parseCron('0 0 * * 0,6')).join(' | '), /по выходным/);
  assert.match(describeCron(parseCron('0 0 1 1 *')).join(' | '), /января/);
});

test('matchesCron: день месяца и день недели работают по правилу «или»', () => {
  const first = new Date(2026, 10, 1, 6, 0); // 1 ноября 2026, воскресенье
  assert.equal(matchesCron(parseCron('0 6 1 * *'), first), true, 'первое число подходит');
  assert.equal(matchesCron(parseCron('0 6 * * 0'), first), true, 'воскресенье подходит');
  assert.equal(matchesCron(parseCron('0 6 1 * 0'), first), true, 'оба поля заданы — достаточно одного');
  assert.equal(matchesCron(parseCron('0 6 2 * 1'), first), false, 'ни число, ни день не совпали');
  assert.equal(matchesCron(parseCron('0 7 * * *'), first), false, 'час не тот');
});

test('nextRuns считает следующие срабатывания', () => {
  const from = new Date(2026, 9, 10, 10, 30); // суббота, 10 октября 2026
  const runs = nextRuns(parseCron('0 9 * * 1-5'), 3, from);

  assert.equal(runs.length, 3);
  assert.equal(runs[0].date.getDay(), 1, 'первый — понедельник');
  assert.equal(runs[0].date.getHours(), 9);
  assert.equal(runs[0].date.getMinutes(), 0);
  assert.equal(runs[0].date.getDate(), 12, 'ближайший понедельник — 12 октября');
  assert.ok(runs[0].msFromNow > 0);
  assert.ok(runs[1].date.getTime() > runs[0].date.getTime(), 'срабатывания по возрастанию');

  const hourly = nextRuns(parseCron('0 * * * *'), 2, from);
  assert.equal(hourly[0].date.getHours(), 11);
  assert.equal(hourly[0].date.getMinutes(), 0);
});

test('nextRuns: невозможное расписание не даёт ничего', () => {
  // 30 февраля не существует.
  assert.deepEqual(nextRuns(parseCron('0 0 30 2 *'), 3), []);
});

/* ----------------------------------- hash --------------------------------- */

test('hashText считает известные контрольные суммы', () => {
  assert.equal(hashText('', 'sha256'), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(hashText('', 'md5'), 'd41d8cd98f00b204e9800998ecf8427e');
  assert.equal(hashText('abc', 'sha1'), 'a9993e364706816aba3e25717850c26c9cd0d89d');
  assert.equal(hashText('привет', 'sha256'), hashText('привет', 'sha256'), 'одинаковый вход — одинаковый хеш');
  assert.notEqual(hashText('привет', 'sha256'), hashText('привет!', 'sha256'));
});

test('hashFile считает то же, что и hashText для того же содержимого', async () => {
  const dir = makeProject({ 'data.txt': 'привет\n' });
  try {
    const fromFile = await hashFile(path.join(dir, 'data.txt'), 'sha256');
    assert.equal(fromFile, hashText('привет\n', 'sha256'));
  } finally {
    removeDir(dir);
  }
});

/* ---------------------------------- watch --------------------------------- */

test('fileState и compareStates видят правку, добавление и удаление', async () => {
  const dir = makeProject({ 'src/index.ts': 'let a = 1;\n', 'src/util.ts': 'let b = 2;\n', 'node_modules/x/index.js': 'junk\n' });
  try {
    const before = await fileState(dir);
    assert.ok(before.has('src/index.ts'));
    assert.ok(![...before.keys()].some((f) => f.startsWith('node_modules/')), 'node_modules не наблюдаем');

    // Правка (и по размеру, и по времени), добавление и удаление.
    writeFileSync(path.join(dir, 'src', 'index.ts'), 'let a = 111111;\n', 'utf8');
    writeFileSync(path.join(dir, 'src', 'new.ts'), 'let c = 3;\n', 'utf8');

    const after = await fileState(dir);
    const change = compareStates(before, after);
    assert.ok(change.changed.includes('src/index.ts'));
    assert.ok(change.added.includes('src/new.ts'));
    assert.deepEqual(change.removed, []);
    assert.equal(isEmptyChange(change), false);

    const removed = compareStates(after, before);
    assert.ok(removed.removed.includes('src/new.ts'));
    assert.equal(isEmptyChange(compareStates(after, after)), true);

    const text = describeChange(change);
    assert.match(text, /index\.ts/);
    assert.match(text, /новые/);
  } finally {
    removeDir(dir);
  }
});

test('fileState уважает .gitignore проекта', async () => {
  const dir = makeProject({ '.gitignore': 'scratch/\n', 'src/a.ts': 'a\n', 'scratch/b.ts': 'b\n' });
  try {
    const state = await fileState(dir);
    assert.ok(state.has('src/a.ts'));
    assert.ok(!state.has('scratch/b.ts'), 'черновики из .gitignore не наблюдаем');
  } finally {
    removeDir(dir);
  }
});

test('waitForUrl дожидается живого сервера', async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  try {
    const result = await waitForUrl(`http://127.0.0.1:${port}/`, { intervalMs: 200, timeoutMs: 5000 });
    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
    assert.ok(result.ms < 5000);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('waitForUrl честно сдаётся по таймауту', async () => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));

  const result = await waitForUrl(`http://127.0.0.1:${port}/`, { intervalMs: 200, timeoutMs: 1000 });
  assert.equal(result.ok, false);
  assert.ok(result.attempts >= 1);
  assert.ok(result.error, 'должна быть причина');
});

/* --------------------------- снимки архитектуры --------------------------- */

test('снимок архитектуры и его сравнение', async () => {
  const dir = makeProject({
    'package.json': '{}',
    'src/index.ts': 'a\nb\n',
    'src/old.ts': 'c\n',
  });
  try {
    const first = snapshotOf(await scanTree(dir), '2026-01-01T00:00:00.000Z');

    writeFileSync(path.join(dir, 'src', 'index.ts'), 'a\nb\nc\nd\n', 'utf8');
    writeFileSync(path.join(dir, 'src', 'new.ts'), 'x\n', 'utf8');
    const second = snapshotOf(await scanTree(dir), '2026-02-01T00:00:00.000Z');

    const diff = diffSnapshots(first, second);
    assert.equal(diff.baseAt, '2026-01-01T00:00:00.000Z');
    assert.deepEqual(diff.added.map((f) => f.rel), ['src/new.ts']);
    assert.deepEqual(diff.removed, []);
    assert.equal(diff.changed.length, 1);
    assert.equal(diff.changed[0].rel, 'src/index.ts');
    assert.equal(diff.changed[0].linesFrom, 2);
    assert.equal(diff.changed[0].linesTo, 4);
    assert.equal(diff.filesDelta, 1);
    assert.equal(diff.linesDelta, 3);

    // Сравнение снимка с самим собой — пусто.
    const same = diffSnapshots(second, second);
    assert.deepEqual([same.added, same.removed, same.changed], [[], [], []]);
    assert.equal(same.filesDelta, 0);
  } finally {
    removeDir(dir);
  }
});
