// Вёрстка меню: renderFrame — единственная часть TUI, которую можно проверить
// без терминала. Интерактив в этом окружении недоступен, поэтому проверяем
// инварианты геометрии: рамка не разъезжается, не вылезает за экран и
// прокручивается до конца списка.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  contentRowsOf,
  layoutOf,
  renderFrame,
  viewOf,
  wrapText,
  type DashState,
  type DashTab,
} from '../src/core/dashboard.ts';
import { strip } from '../src/core/ui.ts';
import { textWidth } from '../src/core/util.ts';

const SIZE = { cols: 100, rows: 30 };

function tabsOf(itemCount = 5, tabCount = 3): DashTab[] {
  return Array.from({ length: tabCount }, (_, t) => ({
    label: `Раздел ${t + 1}`,
    items: Array.from({ length: itemCount }, (_, i) => ({
      label: `команда-${t}-${i}`,
      hint: `подсказка ${i} с довольно длинным текстом, чтобы проверить перенос`,
      detail: [
        { k: 'команда', v: `jd команда-${t}-${i}` },
        { v: 'описание подлиннее — оно тоже переносится по строкам панели деталей' },
      ],
    })),
  }));
}

const state = (over: Partial<DashState> = {}): DashState => ({
  tabIndex: 0,
  cursor: 0,
  scroll: 0,
  query: '',
  searching: false,
  ...over,
});

test('layoutOf: ширина и высота остаются в границах терминала', () => {
  for (let cols = 40; cols <= 200; cols += 7) {
    for (let rows = 8; rows <= 60; rows += 5) {
      const l = layoutOf({ cols, rows }, 12);
      assert.ok(l.width >= 45, `ширина ${l.width} при cols=${cols}`);
      assert.ok(l.width <= 118, `ширина ${l.width} не должна превышать 118`);
      assert.ok(l.height >= 9, `высота ${l.height} при rows=${rows}`);
      assert.ok(l.height <= Math.max(9, rows - 1) + 0.001, `рамка не влезает: height=${l.height} rows=${rows}`);
      assert.ok(l.bodyH >= 1, 'тело должно быть хотя бы в одну строку');
      if (l.single) {
        assert.equal(l.rightW, 0, 'в узком режиме панели деталей нет');
        assert.equal(l.leftW, l.width - 2);
      } else {
        assert.ok(l.rightW >= 22, `правая панель слишком узкая: ${l.rightW}`);
        assert.equal(l.leftW + l.rightW + 3, l.width);
      }
    }
  }
});

test('layoutOf: рамка растёт под содержимое, но не занимает весь экран', () => {
  const few = layoutOf({ cols: 100, rows: 40 }, 3);
  const many = layoutOf({ cols: 100, rows: 40 }, 40);
  assert.ok(many.height > few.height, 'на большом списке рамка выше');
  assert.ok(many.height <= 24, 'высота не должна улетать');
  assert.equal(layoutOf({ cols: 100, rows: 40 }, 12).height, 18);
});

test('renderFrame: все строки одинаковой ширины и влезают в терминал', () => {
  const tabs = tabsOf(7, 4);
  for (const size of [
    { cols: 40, rows: 10 },
    { cols: 57, rows: 12 },
    { cols: 58, rows: 14 },
    { cols: 80, rows: 20 },
    { cols: 120, rows: 30 },
    { cols: 200, rows: 60 },
  ]) {
    const lines = renderFrame(tabs, { title: 'jd · Just Developer Kit', right: 'v0.4.0' }, state(), size);
    const layout = layoutOf(size, contentRowsOf(tabs));
    assert.equal(lines.length, layout.height, `строк должно быть ${layout.height} при ${size.cols}x${size.rows}`);
    for (const line of lines) {
      assert.equal(textWidth(line), layout.width, `строка «${strip(line)}» шириной ${textWidth(line)}, ожидалось ${layout.width}`);
    }
  }
});

test('renderFrame: рамка целая — углы, разделители и развилки на месте', () => {
  const tabs = tabsOf(6, 3);
  const size = { cols: 100, rows: 24 };
  const lines = renderFrame(tabs, { title: 'jd', right: 'v0.4.0' }, state(), size).map(strip);
  const layout = layoutOf(size, contentRowsOf(tabs));

  assert.ok(lines[0].startsWith('╭─'), 'верхний левый угол');
  assert.ok(lines[0].endsWith('─╮'), 'верхний правый угол');
  assert.ok(lines[lines.length - 1].startsWith('╰'), 'нижний левый угол');
  assert.ok(lines[lines.length - 1].endsWith('╯'), 'нижний правый угол');

  const fork = lines.findIndex((l) => l.includes('┬'));
  const join = lines.findIndex((l) => l.includes('┴'));
  assert.ok(fork > 0 && join > fork, 'развилка должна быть выше соединения');
  // Развилка ровно там, где кончается левая панель.
  assert.equal(lines[fork].indexOf('┬'), layout.leftW + 1);
  assert.equal(lines[join].indexOf('┴'), layout.leftW + 1);

  for (const line of lines) {
    assert.ok(line.startsWith('│') || line.startsWith('╭') || line.startsWith('├') || line.startsWith('╰'), `битая левая граница: ${line}`);
    assert.ok(line.endsWith('│') || line.endsWith('╮') || line.endsWith('┤') || line.endsWith('╯'), `битая правая граница: ${line}`);
  }
});

test('renderFrame: заголовок и версия попадают в верхнюю рамку', () => {
  const lines = renderFrame(tabsOf(3, 2), { title: 'jd · Just Developer Kit', right: 'v0.4.0' }, state(), SIZE).map(strip);
  assert.ok(lines[0].includes('jd · Just Developer Kit'), 'в заголовке есть название');
  assert.ok(lines[0].includes('v0.4.0'), 'в заголовке есть версия');
  assert.ok(lines[1].includes('Раздел 1'), 'видны вкладки разделов');
});

test('renderFrame: прокрутка до последнего элемента', () => {
  const tabs = tabsOf(40, 1);
  const size = { cols: 100, rows: 24 };
  const layout = layoutOf(size, contentRowsOf(tabs));
  const state40 = state({ cursor: 39 });
  const lines = renderFrame(tabs, { title: 'jd' }, state40, size).map(strip);

  assert.ok(lines.some((l) => l.includes('команда-0-39')), 'последний элемент должен быть виден');
  assert.ok(!lines.some((l) => l.includes('команда-0-0 ')), 'первый элемент уехал вверх');
  // Прокрутка пересчитана, а не осталась нулевой.
  assert.ok(state40.scroll > 0, 'scroll должен сдвинуться');
  assert.ok(state40.scroll <= 40 - layout.bodyH + 1);
});

test('renderFrame: поиск фильтрует и показывает раздел-источник', () => {
  const tabs = tabsOf(5, 3);
  const lines = renderFrame(tabs, { title: 'jd' }, state({ searching: true, query: 'команда-2-3' }), SIZE).map(strip);
  const body = lines.join('\n');
  assert.ok(body.includes('команда-2-3'), 'нашлась нужная команда');
  assert.ok(body.includes('Раздел 3'), 'видно, из какого она раздела');
  assert.ok(body.includes('найдено'), 'счётчик переключился на результаты поиска');
});

test('renderFrame: пустой раздел не ломает рамку', () => {
  const tabs: DashTab[] = [
    { label: 'Пусто', items: [] },
    { label: 'Есть', items: [{ label: 'одна', hint: '', detail: [] }] },
  ];
  const lines = renderFrame(tabs, { title: 'jd' }, state({ tabIndex: 0 }), SIZE);
  const layout = layoutOf(SIZE, contentRowsOf(tabs));
  assert.equal(lines.length, layout.height);
  for (const line of lines) assert.equal(textWidth(line), layout.width);
  assert.ok(lines.join('\n').includes('0 в разделе'), 'счётчик честно показывает ноль');
});

test('renderFrame: без вкладок кадр пустой', () => {
  assert.deepEqual(renderFrame([], { title: 'jd' }, state(), SIZE), []);
});

test('viewOf: поиск собирает совпадения из всех разделов', () => {
  const tabs = tabsOf(3, 3);
  const found = viewOf(tabs, state({ searching: true, query: 'команда-1' }));
  assert.ok(found.length >= 3, 'должны найтись элементы из разных разделов');
  assert.deepEqual([...new Set(found.map((f) => f.tab))].sort(), [0, 1, 2]);
  // Без поиска виден только текущий раздел.
  const plain = viewOf(tabs, state({ tabIndex: 2 }));
  assert.equal(plain.length, 3);
  assert.ok(plain.every((p) => p.tab === 2));
});

test('wrapText: переносит по словам, режет слишком длинные слова', () => {
  // «один два» в 7 не влезает, а «два три» — ровно 7.
  assert.deepEqual(wrapText('один два три', 7), ['один', 'два три']);
  assert.deepEqual(wrapText('один два три', 6), ['один', 'два', 'три']);
  assert.deepEqual(wrapText('короткая строка', 40), ['короткая строка']);
  assert.deepEqual(wrapText('', 10), ['']);
  assert.deepEqual(wrapText('первая\nвторая', 20), ['первая', 'вторая']);
  const long = wrapText('а'.repeat(25), 10);
  assert.ok(long.length >= 3);
  for (const line of long) assert.ok(textWidth(line) <= 10);
});

test('width учитывает эмодзи в элементах меню', () => {
  const tabs: DashTab[] = [
    {
      label: '📂 проект',
      items: [{ label: '🚀 Dev Server', hint: 'npm run dev', detail: [{ k: 'cmd', v: 'npm run dev' }] }],
      accent: true,
    },
  ];
  const lines = renderFrame(tabs, { title: 'jd', right: 'v1' }, state(), SIZE);
  const layout = layoutOf(SIZE, contentRowsOf(tabs));
  for (const line of lines) assert.equal(textWidth(line), layout.width);
});
