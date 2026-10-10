// Утилиты: ширина строк, формат значений, нечёткий поиск, BOM.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { center, highlight, padEnd, truncate } from '../src/core/ui.ts';
import { setColor } from '../src/core/theme.ts';
import {
  clusterWidth,
  clusters,
  formatBytes,
  formatDuration,
  formatMs,
  fuzzyMatch,
  stripBom,
  textWidth,
  unique,
} from '../src/core/util.ts';

test('textWidth: кириллица, эмодзи и ANSI', () => {
  assert.equal(textWidth('abc'), 3);
  assert.equal(textWidth('привет'), 6);
  assert.equal(textWidth(''), 0);
  // Селектор эмодзи делает знак широким.
  assert.equal(textWidth('🛠️'), 2);
  assert.equal(textWidth('🛠'), 2);
  // ✔ и ⚠ без селектора остаются узкими — иначе таблицы разъезжаются.
  assert.equal(textWidth('✔'), 1);
  assert.equal(textWidth('✔️'), 2);
  assert.equal(textWidth('⚠'), 1);
  // ZWJ-последовательность — один кластер шириной 2.
  assert.equal(textWidth('👨‍👩‍👧'), 2);
  // ANSI-коды не считаются.
  assert.equal(textWidth('\x1b[31mabc\x1b[0m'), 3);
});

test('clusters склеивает селекторы и ZWJ', () => {
  assert.deepEqual(clusters('a✔️b'), ['a', '✔️', 'b']);
  assert.equal(clusters('👨‍👩‍👧').length, 1);
  assert.equal(clusterWidth('✔'), 1);
  assert.equal(clusterWidth('✔️'), 2);
});

test('formatBytes', () => {
  assert.equal(formatBytes(0), '0 Б');
  assert.equal(formatBytes(512), '512 Б');
  assert.equal(formatBytes(1536), '1.5 КБ');
  assert.equal(formatBytes(1024 * 1024 * 3), '3.0 МБ');
  assert.equal(formatBytes(-2048), '-2.0 КБ');
  assert.equal(formatBytes(Number.NaN), '—');
});

test('formatMs и formatDuration', () => {
  assert.equal(formatMs(420), '420 мс');
  assert.equal(formatMs(1500), '1.5 с');
  assert.equal(formatMs(65_000), '1м 5с');
  assert.equal(formatDuration(3725_000), '1ч 2м');
  assert.equal(formatDuration(0), '0с');
  assert.equal(formatDuration(90_000), '1м 30с');
});

test('fuzzyMatch: сокращения и промахи', () => {
  const hit = fuzzyMatch('snp', 'snip add');
  assert.ok(hit, 'сокращение должно находить команду');
  assert.deepEqual(hit?.positions, [0, 1, 3]);
  assert.equal(fuzzyMatch('zzz', 'snip add'), null);
  assert.deepEqual(fuzzyMatch('', 'что угодно')?.positions, []);
  // Совпадение с начала строки весит больше, чем в середине.
  const start = fuzzyMatch('snip', 'snip add');
  const middle = fuzzyMatch('add', 'snip add');
  assert.ok((start?.score ?? 0) > (middle?.score ?? 0));
});

test('stripBom убирает метку из начала файла', () => {
  assert.equal(stripBom('\uFEFF{"a":1}'), '{"a":1}');
  assert.equal(stripBom('{"a":1}'), '{"a":1}');
  assert.equal(stripBom(''), '');
  // BOM в середине — не наша забота, трогать нельзя.
  assert.equal(stripBom('a\uFEFFb'), 'a\uFEFFb');
});

test('truncate не разрезает эмодзи и учитывает ANSI', () => {
  assert.equal(truncate('abcdef', 4), 'abc…');
  assert.equal(truncate('abc', 10), 'abc');
  assert.equal(truncate('🎯🎯🎯', 4), '🎯…');
  assert.equal(textWidth(truncate('\x1b[31mabcdef\x1b[0m', 5)), 5);
});

test('padEnd и center считают видимую ширину', () => {
  assert.equal(padEnd('аб', 4), 'аб  ');
  assert.equal(padEnd('abcd', 2), 'abcd');
  assert.equal(center('ab', 6), '  ab  ');
  assert.equal(center('abc', 6), ' abc  ');
});

test('highlight красит нужные позиции, не сбиваясь на эмодзи', () => {
  setColor(true);
  try {
    const painted = highlight('a🎯b', [0, 3]);
    assert.ok(painted.includes('\x1b['), 'подсветка должна добавить ANSI');
    assert.equal(painted.replace(/\x1b\[[0-9;]*m/g, ''), 'a🎯b');
    // Без позиций строка возвращается как есть.
    assert.equal(highlight('abc', []), 'abc');
  } finally {
    setColor(false);
  }
});

test('unique сохраняет порядок', () => {
  assert.deepEqual(unique([3, 1, 3, 2, 1]), [3, 1, 2]);
});
