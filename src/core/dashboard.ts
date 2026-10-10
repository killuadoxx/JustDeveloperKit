// Полноэкранный интерфейс меню: рамка, вкладки разделов и панель деталей.
//
// Навигация: ↑↓ по списку, ←→ по разделам, Tab тоже переключает разделы,
// набор текста — поиск по всем разделам сразу, Enter — выбор, Esc — выход.
//
// Отрисовка вынесена в чистую функцию renderFrame(): она ничего не знает про
// stdin/stdout и получает размер терминала аргументом. Так вёрстку можно
// проверять тестом, а не глазами.

import readline from 'node:readline';
import { ch, N } from './neon.ts';
import { C, bold, fg, paint } from './theme.ts';
import { Frame, hideCursor, padEnd, showCursor, truncate } from './ui.ts';
import { clusterWidth, clusters, fuzzyMatch, textWidth } from './util.ts';

export interface DashDetail {
  /** Подпись слева (необязательно). */
  k?: string;
  /** Текст значения. */
  v: string;
}

export interface DashItem {
  label: string;
  hint: string;
  detail: DashDetail[];
}

export interface DashTab {
  /** Короткая подпись на вкладке. */
  label: string;
  items: DashItem[];
  /** Выделить вкладку акцентом (раздел проекта). */
  accent?: boolean;
}

export interface DashOptions {
  title: string;
  /** Надпись справа в верхней рамке (версия, режим). */
  right?: string;
}

export interface DashSelection {
  tab: number;
  item: number;
}

export interface DashState {
  tabIndex: number;
  cursor: number;
  scroll: number;
  query: string;
  searching: boolean;
}

export interface DashSize {
  cols: number;
  rows: number;
}

export interface DashLayout {
  width: number;
  height: number;
  inner: number;
  leftW: number;
  rightW: number;
  bodyH: number;
  /** Узкий терминал: панель деталей скрыта, список занимает всю ширину. */
  single: boolean;
}

const KEY_HINTS = '↑↓ выбор · ←→ разделы · Enter запустить · / поиск · Esc выход';

/** Разбить текст по ширине, не разрезая эмодзи и слова. */
export function wrapText(text: string, width: number): string[] {
  if (width <= 1) return [text];
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (!paragraph) {
      out.push('');
      continue;
    }
    let line = '';
    for (const word of paragraph.split(/(\s+)/)) {
      if (!word) continue;
      if (textWidth(line + word) <= width) {
        line += word;
        continue;
      }
      if (line.trim()) out.push(line.trimEnd());
      if (textWidth(word) <= width) {
        line = word.trimStart();
        continue;
      }
      // Слово длиннее строки — режем по кластерам.
      let chunk = '';
      for (const cluster of clusters(word)) {
        if (textWidth(chunk + cluster) > width) {
          out.push(chunk);
          chunk = '';
        }
        chunk += cluster;
      }
      line = chunk;
    }
    out.push(line.trimEnd());
  }
  return out;
}

/** Дополнить строку пробелами до ровно нужной ширины. */
function fit(text: string, width: number): string {
  if (width <= 0) return '';
  const cut = textWidth(text) > width ? truncate(text, width) : text;
  return padEnd(cut, width);
}

/**
 * Геометрия рамки. Рамка растёт под содержимое (а не занимает экран пустотой),
 * ужимается под высоту терминала и на узких окнах прячет панель деталей.
 */
export function layoutOf(size: DashSize, contentRows = 10): DashLayout {
  const cols = size.cols || 100;
  const rows = size.rows || 30;

  const width = Math.max(45, Math.min(cols, 118));
  const single = width < 58;
  // Тело: под самое длинное содержимое, но не больше 18 строк и не больше экрана.
  const bodyDesired = Math.max(8, Math.min(contentRows, 18));
  const maxHeight = Math.max(9, Math.min(rows - 1, 44));
  const height = Math.min(bodyDesired + 6, maxHeight);
  const bodyH = height - 6;

  let leftW = single ? width - 2 : Math.max(20, Math.min(Math.round(width * 0.4), 44));
  let rightW = single ? 0 : width - 3 - leftW;
  if (!single && rightW < 22) {
    rightW = 22;
    leftW = width - 3 - rightW;
  }
  return { width, height, inner: width - 2, leftW, rightW, bodyH, single };
}

/** Сколько строк нужно телу: самое длинное содержимое среди вкладок. */
export function contentRowsOf(tabs: DashTab[]): number {
  return Math.max(8, ...tabs.map((t) => t.items.length));
}

/** Какие элементы показаны и в каком порядке (с учётом поиска). */
export function viewOf(tabs: DashTab[], state: DashState): DashSelection[] {
  if (state.searching && state.query) {
    const found: { sel: DashSelection; score: number }[] = [];
    tabs.forEach((tab, t) => {
      tab.items.forEach((item, i) => {
        const m = fuzzyMatch(state.query, `${item.label} ${item.hint} ${tab.label}`);
        if (m) found.push({ sel: { tab: t, item: i }, score: m.score });
      });
    });
    return found.sort((a, b) => b.score - a.score).map((f) => f.sel);
  }
  const tab = tabs[state.tabIndex] ?? tabs[0];
  return tab.items.map((_, i) => ({ tab: state.tabIndex, item: i }));
}

function renderTabRow(tabs: DashTab[], state: DashState, inner: number): string {
  if (state.searching) {
    const label = state.query ? paint('  › ' + state.query, fg(C.text)) : paint('  › ', fg(C.accent));
    return fit(label + paint('▌', fg(C.accent)), inner);
  }
  let row = ' ';
  for (let i = 0; i < tabs.length; i++) {
    const text = ` ${tabs[i].label} `;
    if (textWidth(row) + textWidth(text) > inner - 1) {
      row += paint('…', fg(C.faint));
      break;
    }
    if (i === state.tabIndex) {
      row += ch.bgHex(C.bgSoft)(ch.hex(tabs[i].accent ? N.cyan : C.text).bold(text));
    } else {
      row += paint(text, fg(tabs[i].accent ? C.accent : C.muted));
    }
    row += paint('│', fg(C.faint));
  }
  return fit(row, inner);
}

function renderLeft(tabs: DashTab[], view: DashSelection[], state: DashState, rows: number, leftW: number): string[] {
  const out: string[] = [];
  if (!view.length) {
    out.push(paint('  ничего не найдено', fg(C.warn)));
  } else {
    const visible = Math.max(1, rows);
    if (state.cursor < state.scroll) state.scroll = state.cursor;
    if (state.cursor >= state.scroll + visible) state.scroll = state.cursor - visible + 1;
    if (state.scroll > Math.max(0, view.length - visible)) state.scroll = Math.max(0, view.length - visible);
    if (state.scroll < 0) state.scroll = 0;

    for (let i = state.scroll; i < Math.min(view.length, state.scroll + visible); i++) {
      const sel = view[i];
      const item = tabs[sel.tab]?.items[sel.item];
      if (!item) continue;
      const selected = i === state.cursor;
      const marker = selected ? paint('❯ ', fg(C.accent), bold()) : '  ';
      const label = selected ? paint(item.label, bold(), fg(C.text)) : paint(item.label, fg(C.soft));
      // При поиске полезно видеть, из какого раздела нашлось.
      const suffix = state.searching && state.query ? paint('  ' + tabs[sel.tab].label, fg(C.faint)) : '';
      out.push(marker + label + suffix);
    }
  }
  while (out.length < rows) out.push('');
  return out.slice(0, rows).map((l) => fit(l, leftW));
}

function renderRight(item: DashItem | null, rows: number, rightW: number): string[] {
  const lines: string[] = [];
  if (!item) {
    lines.push(paint(' выбери команду слева', fg(C.faint)));
  } else {
    lines.push(' ' + paint(item.label, bold(), fg(C.text)));
    for (const detail of item.detail) {
      const pad = detail.k ? textWidth(detail.k) + 1 : 0;
      const wrapped = wrapText(detail.v, Math.max(8, rightW - pad - 3));
      wrapped.forEach((part, i) => {
        if (i === 0 && detail.k) {
          lines.push(' ' + paint(detail.k, fg(C.muted)) + ' ' + paint(part, fg(C.soft)));
        } else {
          lines.push(' ' + ' '.repeat(pad) + paint(part, fg(C.soft)));
        }
      });
      if (detail.k) lines.push('');
    }
  }
  while (lines.length < rows) lines.push('');
  return lines.slice(0, rows).map((l) => fit(l, rightW));
}

/**
 * Собрать кадр целиком. Возвращает ровно layout.height строк, каждая шириной
 * ровно layout.width — иначе рамка «поедет» при перерисовке.
 */
export function renderFrame(
  tabs: DashTab[],
  opts: DashOptions,
  state: DashState,
  size: DashSize,
): string[] {
  const { width, height, inner, leftW, rightW, bodyH, single } = layoutOf(size, contentRowsOf(tabs));
  if (!tabs.length) return [];

  const view = viewOf(tabs, state);
  if (state.cursor > view.length - 1) state.cursor = Math.max(0, view.length - 1);
  const sel = view[state.cursor];
  const item = sel ? tabs[sel.tab]?.items[sel.item] ?? null : null;

  const content: string[] = [];

  // Верхняя рамка с заголовком.
  const titleText = ` ${opts.title} `;
  const rightText = opts.right ? ` ${opts.right} ` : '';
  const fillTop = Math.max(0, inner - textWidth(titleText) - textWidth(rightText) - 2);
  content.push(
    paint('╭─', fg(C.faint)) +
      ch.hex(N.pink).bold(titleText) +
      paint('─'.repeat(fillTop), fg(C.faint)) +
      paint(rightText, fg(C.faint)) +
      paint('─╮', fg(C.faint)),
  );

  // Вкладки разделов.
  content.push(paint('│', fg(C.faint)) + renderTabRow(tabs, state, inner) + paint('│', fg(C.faint)));

  // Разделители: с развилкой, когда панелей две.
  const split = (left: string, mid: string, right: string): string =>
    paint('├' + '─'.repeat(leftW) + (single ? '' : mid) + (single ? '' : '─'.repeat(rightW)) + right, fg(C.faint));

  content.push(split(leftW, '┬', '┤'));

  const left = renderLeft(tabs, view, state, bodyH, leftW);
  const right = single ? [] : renderRight(item, bodyH, rightW);
  for (let i = 0; i < bodyH; i++) {
    content.push(
      single
        ? paint('│', fg(C.faint)) + left[i] + paint('│', fg(C.faint))
        : paint('│', fg(C.faint)) + left[i] + paint('│', fg(C.faint)) + right[i] + paint('│', fg(C.faint)),
    );
  }

  content.push(split(leftW, '┴', '┤'));

  const counter = state.searching && state.query
    ? `${view.length} найдено`
    : `${tabs[state.tabIndex]?.items.length ?? 0} в разделе`;
  const hint = paint('  ' + KEY_HINTS + ' · ' + counter, fg(C.faint));
  content.push(paint('│', fg(C.faint)) + fit(textWidth(hint) > inner ? truncate(hint, inner) : hint, inner) + paint('│', fg(C.faint)));

  content.push(paint('╰' + '─'.repeat(inner) + '╯', fg(C.faint)));

  return content.slice(0, height);
}

export async function runDashboard(tabs: DashTab[], opts: DashOptions): Promise<DashSelection | null> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Интерфейс требует настоящий терминал.');
  }
  if (!tabs.length) return null;

  const stdin = process.stdin;
  const frame = new Frame();
  const state: DashState = { tabIndex: 0, cursor: 0, scroll: 0, query: '', searching: false };

  readline.emitKeypressEvents(stdin);
  const wasRaw = stdin.isRaw;
  stdin.setRawMode(true);
  stdin.resume();
  hideCursor();
  process.stdout.write('\x1b[2J\x1b[H');

  const termSize = (): DashSize => ({ cols: process.stdout.columns ?? 100, rows: process.stdout.rows ?? 30 });
  const pageSize = (): number => Math.max(1, layoutOf(termSize(), contentRowsOf(tabs)).bodyH);

  const render = (): void => {
    frame.draw(renderFrame(tabs, opts, state, termSize()));
  };

  return new Promise<DashSelection | null>((resolve) => {
    const cleanup = (): void => {
      stdin.removeListener('keypress', onKey);
      stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
      showCursor();
      frame.done();
    };

    const finish = (selection: DashSelection | null): void => {
      cleanup();
      process.stdout.write('\x1b[2J\x1b[H');
      resolve(selection);
    };

    const switchTab = (delta: number): void => {
      state.tabIndex = (state.tabIndex + delta + tabs.length) % tabs.length;
      state.cursor = 0;
      state.scroll = 0;
      state.searching = false;
      state.query = '';
    };

    const restartSearch = (): void => {
      state.cursor = 0;
      state.scroll = 0;
    };

    const onKey = (_str: string, key: readline.Key): void => {
      if (!key) return;
      if (key.ctrl && key.name === 'c') return finish(null);

      const view = viewOf(tabs, state);

      switch (key.name) {
        case 'escape':
          if (state.searching && state.query) {
            state.searching = false;
            state.query = '';
            restartSearch();
            render();
            return;
          }
          return finish(null);

        case 'return':
        case 'enter': {
          const sel = view[state.cursor];
          if (!sel) return;
          return finish(sel);
        }

        case 'up':
          state.cursor = Math.max(0, state.cursor - 1);
          render();
          return;
        case 'down':
          state.cursor = Math.min(view.length - 1, state.cursor + 1);
          render();
          return;
        case 'left':
          if (!state.searching) switchTab(-1);
          render();
          return;
        case 'right':
          if (!state.searching) switchTab(1);
          render();
          return;
        case 'tab':
          if (!state.searching) switchTab(key.shift ? -1 : 1);
          render();
          return;
        case 'k':
        case 'j':
        case 'h':
        case 'l':
          if (!state.searching) {
            if (key.name === 'k') state.cursor = Math.max(0, state.cursor - 1);
            else if (key.name === 'j') state.cursor = Math.min(view.length - 1, state.cursor + 1);
            else switchTab(key.name === 'h' ? -1 : 1);
            render();
            return;
          }
          break;
        case 'pageup':
          state.cursor = Math.max(0, state.cursor - pageSize());
          render();
          return;
        case 'pagedown':
          state.cursor = Math.min(view.length - 1, state.cursor + pageSize());
          render();
          return;
        case 'home':
          state.cursor = 0;
          render();
          return;
        case 'end':
          state.cursor = Math.max(0, view.length - 1);
          render();
          return;
        case 'backspace':
        case 'delete':
          if (state.searching) {
            state.query = state.query.slice(0, -1);
            restartSearch();
            if (!state.query) state.searching = false;
            render();
            return;
          }
          break;
        default:
          break;
      }

      const seq = key.sequence ?? '';
      if (key.ctrl || key.meta || !seq || [...seq].length !== 1) return;
      if (seq === '/') {
        state.searching = true;
        state.query = '';
        restartSearch();
        render();
        return;
      }
      // Любой печатный символ начинает поиск по всем разделам сразу.
      state.searching = true;
      state.query += seq;
      restartSearch();
      render();
    };

    stdin.on('keypress', onKey);
    render();
  });
}
