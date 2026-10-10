// Интерактив: меню со стрелками и fuzzy-поиском, ввод строки, подтверждение.

import readline from 'node:readline';
import { C, bold, fg, paint } from './theme.ts';
import { Frame, hideCursor, padEnd, showCursor, truncate, width } from './ui.ts';
import { fuzzyMatch } from './util.ts';

export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

export interface SelectItem {
  label: string;
  hint?: string;
  group?: string;
}

export interface SelectOptions {
  title?: string;
  subtitle?: string;
  pageSize?: number;
  /** Группы, заголовки которых надо выделить акцентом, а не приглушить. */
  emphasizeGroups?: string[];
}

/**
 * Меню: стрелки, Enter — выбор, Esc — отмена, печать — нечёткий поиск.
 * Возвращает индекс в исходном массиве или null, если отменили.
 */
export async function selectList(items: SelectItem[], opts: SelectOptions = {}): Promise<number | null> {
  if (!isInteractive()) {
    throw new Error('Это интерактивная команда — запусти её в обычном окне терминала.');
  }
  if (items.length === 0) return null;

  const rows = process.stdout.rows ?? 30;
  const pageSize = Math.max(5, Math.min(opts.pageSize ?? 14, rows - 9));

  const stdin = process.stdin;
  const frame = new Frame();
  let query = '';
  let cursor = 0;

  readline.emitKeypressEvents(stdin);
  const wasRaw = stdin.isRaw;
  stdin.setRawMode(true);
  stdin.resume();
  hideCursor();

  type ViewRow = { item: SelectItem; index: number; positions: number[] };
  const computeView = (): ViewRow[] => {
    if (!query) return items.map((item, index) => ({ item, index, positions: [] }));
    return items
      .map((item, index) => {
        const m = fuzzyMatch(query, `${item.label} ${item.hint ?? ''} ${item.group ?? ''}`);
        return m ? { item, index, positions: m.positions, score: m.score } : null;
      })
      .filter((x): x is ViewRow & { score: number } => x !== null)
      .sort((a, b) => b.score - a.score)
      .map(({ item, index, positions }) => ({ item, index, positions }));
  };

  let view = computeView();

  const renderRows = (): string[] => {
    if (view.length === 0) return [paint('  ничего не найдено', fg(C.warn))];
    const win = Math.min(pageSize, view.length);
    let top = 0;
    if (cursor >= pageSize) top = cursor - pageSize + 1;
    if (top + win > view.length) top = Math.max(0, view.length - win);

    const out: string[] = [];
    let lastGroup = '';
    const totalWidth = Math.max(30, (process.stdout.columns ?? 90) - 4);

    for (let i = top; i < top + win; i++) {
      const row = view[i];
      const group = row.item.group ?? '';
      if (group && group !== lastGroup && !query) {
        if (out.length) out.push('');
        const emphasized = opts.emphasizeGroups?.includes(group) ?? false;
        out.push(paint('  ' + group, ...(emphasized ? [bold(), fg(C.accent)] : [fg(C.muted)])));
        lastGroup = group;
      }
      const selected = i === cursor;
      const marker = selected ? paint('❯ ', fg(C.accent), bold()) : '  ';
      const label = selected ? paint(row.item.label, bold(), fg(C.text)) : paint(row.item.label, fg(C.soft));
      const hint = row.item.hint ? paint(row.item.hint, fg(C.faint)) : '';
      const gap = Math.max(1, totalWidth - width(row.item.label) - width(row.item.hint ?? '') - 6);
      const line = marker + label + ' '.repeat(gap) + hint;
      out.push(truncate(line, totalWidth));
    }

    if (view.length > win) {
      out.push(paint(`  … ещё ${view.length - win}`, fg(C.faint)));
    }
    return out;
  };

  const render = (): void => {
    const lines: string[] = [];
    if (opts.title) lines.push(paint(opts.title, bold(), fg(C.primary)));
    lines.push(
      paint('  › ', fg(C.accent)) +
        (query ? paint(query, fg(C.text)) : paint('печатай для поиска', fg(C.faint))),
    );
    if (opts.subtitle) lines.push(paint('  ' + opts.subtitle, fg(C.muted)));
    lines.push('');
    lines.push(...renderRows());
    lines.push('');
    lines.push(paint('  ↑↓ выбор · Enter принять · Esc отмена', fg(C.faint)));
    frame.draw(lines);
  };

  return new Promise<number | null>((resolve) => {
    const cleanup = (): void => {
      stdin.removeListener('keypress', onKey);
      stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
      showCursor();
      frame.done();
    };

    const finish = (index: number | null): void => {
      cleanup();
      if (index === null) {
        process.stdout.write(paint('  отменено', fg(C.muted)) + '\n');
      } else {
        process.stdout.write(
          paint('  ✓ ', fg(C.ok)) + paint(items[index].label, bold(), fg(C.text)) + '\n',
        );
      }
      resolve(index);
    };

    const onKey = (_str: string, key: readline.Key): void => {
      if (!key) return;
      if (key.ctrl && key.name === 'c') return finish(null);

      switch (key.name) {
        case 'escape':
          return finish(null);
        case 'return':
        case 'enter': {
          const picked = view[cursor];
          return finish(picked ? picked.index : null);
        }
        case 'up':
        case 'k':
          if (key.name === 'up' || query === '') cursor = Math.max(0, cursor - 1);
          render();
          return;
        case 'down':
        case 'j':
          if (key.name === 'down' || query === '') cursor = Math.min(view.length - 1, cursor + 1);
          render();
          return;
        case 'pageup':
          cursor = Math.max(0, cursor - pageSize);
          render();
          return;
        case 'pagedown':
          cursor = Math.min(view.length - 1, cursor + pageSize);
          render();
          return;
        case 'home':
          cursor = 0;
          render();
          return;
        case 'end':
          cursor = Math.max(0, view.length - 1);
          render();
          return;
        case 'backspace':
        case 'delete':
          query = query.slice(0, -1);
          break;
        default: {
          const seq = key.sequence ?? '';
          if (key.ctrl || key.meta || seq.length === 0) return;
          if ([...seq].length !== 1) return;
          query += seq;
        }
      }

      view = computeView();
      cursor = 0;
      render();
    };

    stdin.on('keypress', onKey);
    render();
  });
}

export async function promptText(question: string, def = ''): Promise<string> {
  if (!isInteractive()) return def;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const hint = def ? paint(` [${def}]`, fg(C.faint)) : '';
  const answer = await new Promise<string>((resolve) => {
    rl.question(paint('? ', fg(C.accent)) + paint(question, fg(C.text)) + hint + ' ', resolve);
  });
  rl.close();
  const trimmed = answer.trim();
  return trimmed === '' ? def : trimmed;
}

export async function confirm(question: string, def = false): Promise<boolean> {
  if (!isInteractive()) return def;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const hint = def ? '[Y/n]' : '[y/N]';
  const answer = await new Promise<string>((resolve) => {
    rl.question(paint('? ', fg(C.accent)) + paint(question, fg(C.text)) + ' ' + paint(hint, fg(C.faint)) + ' ', resolve);
  });
  rl.close();
  const a = answer.trim().toLowerCase();
  if (!a) return def;
  return a === 'y' || a === 'yes' || a === 'д' || a === 'да';
}

/** Пауза «нажми любую клавишу» — чтобы окно не закрылось раньше времени. */
export async function pause(message = 'Enter — продолжить'): Promise<void> {
  if (!isInteractive()) return;
  process.stdout.write(paint('  ' + message, fg(C.faint)));
  const stdin = process.stdin;
  readline.emitKeypressEvents(stdin);
  const wasRaw = stdin.isRaw;
  stdin.setRawMode(true);
  stdin.resume();
  await new Promise<void>((resolve) => {
    const onKey = (): void => {
      stdin.removeListener('keypress', onKey);
      stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
      process.stdout.write('\n');
      resolve();
    };
    stdin.on('keypress', onKey);
  });
}
