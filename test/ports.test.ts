// Порты: разбор спецификаций, разбор вывода netstat, реальное прощупывание.

import assert from 'node:assert/strict';
import net from 'node:net';
import { test } from 'node:test';
import { POPULAR_PORTS, mapLimit, parseCsvLine, parsePortSpec, probePort, shortProcess } from '../src/core/ports.ts';

test('parsePortSpec: список, диапазон и мусор', () => {
  assert.deepEqual(parsePortSpec('3000,5173'), [3000, 5173]);
  assert.deepEqual(parsePortSpec('3000 5173'), [3000, 5173]);
  assert.deepEqual(parsePortSpec('3000-3003'), [3000, 3001, 3002, 3003]);
  assert.deepEqual(parsePortSpec('3003-3000'), [3000, 3001, 3002, 3003], 'обратный диапазон тоже понятен');
  assert.deepEqual(parsePortSpec('3000-3000'), [3000]);
  assert.deepEqual(parsePortSpec('80, 3000-\t3000, 3000'), [80, 3000], 'дубликаты убираются');
  assert.deepEqual(parsePortSpec('0, 70000, -5, abc'), [], 'некорректные значения отбрасываются');
  assert.deepEqual(parsePortSpec(''), []);
});

test('parsePortSpec: диапазон 3000-9000 даёт 6001 порт', () => {
  const ports = parsePortSpec('3000-9000');
  assert.equal(ports.length, 6001);
  assert.equal(ports[0], 3000);
  assert.equal(ports[ports.length - 1], 9000);
});

test('parseCsvLine понимает кавычки и запятые внутри значений', () => {
  assert.deepEqual(parseCsvLine('a,b,c'), ['a', 'b', 'c']);
  assert.deepEqual(parseCsvLine('"node.exe","1234","Console","1","45 000 КБ"'), [
    'node.exe', '1234', 'Console', '1', '45 000 КБ',
  ]);
  assert.deepEqual(parseCsvLine('"имя, с запятой",2'), ['имя, с запятой', '2']);
  assert.deepEqual(parseCsvLine('"двойная ""кавычка""",3'), ['двойная "кавычка"', '3']);
  assert.deepEqual(parseCsvLine(''), ['']);
});

test('shortProcess убирает .exe и сокращает длинные имена', () => {
  assert.equal(shortProcess('node.exe'), 'node');
  assert.equal(shortProcess('node'), 'node');
  assert.equal(shortProcess('a'.repeat(60), 20).length, 20);
  assert.ok(shortProcess('очень длинное имя процесса', 12).endsWith('…'));
});

test('POPULAR_PORTS: только валидные порты без повторов', () => {
  assert.ok(POPULAR_PORTS.length > 10);
  assert.equal(new Set(POPULAR_PORTS).size, POPULAR_PORTS.length, 'порты не должны повторяться');
  for (const port of POPULAR_PORTS) {
    assert.ok(Number.isInteger(port) && port > 0 && port <= 65535, `некорректный порт ${port}`);
  }
});

test('probePort действительно находит живой сокет', async () => {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  assert.ok(port > 0, 'сервер должен получить порт');

  try {
    assert.equal(await probePort(port, 800), true, 'занятый порт отвечает');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('probePort молчит на закрытом порту', async () => {
  // Сначала занимаем порт и сразу освобождаем — так он почти наверняка свободен.
  const probe = net.createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const address = probe.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve) => probe.close(() => resolve()));

  assert.equal(await probePort(port, 400), false, 'свободный порт не отвечает');
});

test('mapLimit сохраняет порядок и не превышает лимит', async () => {
  let active = 0;
  let peak = 0;
  const items = Array.from({ length: 20 }, (_, i) => i);

  const result = await mapLimit(items, 4, async (item) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active--;
    return item * 2;
  });

  assert.deepEqual(result, items.map((i) => i * 2), 'порядок результатов = порядок входных данных');
  assert.ok(peak <= 4, `одновременных задач было ${peak}, ожидалось не больше 4`);
  assert.ok(peak > 1, 'задачи должны идти параллельно');
});

test('mapLimit на пустом списке', async () => {
  assert.deepEqual(await mapLimit([], 4, async (x: number) => x), []);
});
