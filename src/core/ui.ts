// Визуальный кит: рамки, таблицы, полосы, спарклайны, спиннер, кадры.
// Всё считается с учётом ANSI-кодов и широких символов.

import { C, bg, bold, fg, paint } from './theme.ts';
import { clusterWidth, clusters, textWidth } from './util.ts';

export { textWidth as width };

const ANSI_RE = /\x1b\[[0-9;]*m/g;

export function strip(s: string): string {
  return s.replace(ANSI_RE, '');
}

export function truncate(s: string, max: number): string {
  if (max <= 0) return '';
  if (textWidth(s) <= max) return s;
  const plain = strip(s);
  let out = '';
  let w = 0;
  for (const cluster of clusters(plain)) {
    const cw = clusterWidth(cluster);
    if (w + cw > max - 1) break;
    out += cluster;
    w += cw;
  }
  return out + '…';
}

export function padEnd(s: string, target: number): string {
  const gap = target - textWidth(s);
  return gap > 0 ? s + ' '.repeat(gap) : s;
}

export function padStart(s: string, target: number): string {
  const gap = target - textWidth(s);
  return gap > 0 ? ' '.repeat(gap) + s : s;
}

export function center(s: string, target: number): string {
  const gap = target - textWidth(s);
  if (gap <= 0) return s;
  const left = Math.floor(gap / 2);
  return ' '.repeat(left) + s + ' '.repeat(gap - left);
}

/**
 * Подсветить позиции символов (результат fuzzyMatch) в строке.
 * fuzzyMatch считает позиции в UTF-16, а итерация идёт по код-поинтам —
 * поэтому ведём отдельный счётчик, иначе на эмодзи подсветка уезжает.
 */
export function highlight(s: string, positions: number[], color = C.warn): string {
  if (!positions.length) return s;
  const set = new Set(positions);
  let out = '';
  let offset = 0;
  for (const ch of s) {
    out += set.has(offset) ? paint(ch, bold(), fg(color)) : ch;
    offset += ch.length;
  }
  return out;
}

export interface BoxOptions {
  title?: string;
  right?: string;
  color?: string;
  padding?: number;
  minWidth?: number;
}

export function box(lines: string[], opts: BoxOptions = {}): string {
  const pad = opts.padding ?? 1;
  const color = opts.color ?? C.faint;
  const contentWidth = Math.max(
    opts.minWidth ?? 0,
    ...lines.map((l) => textWidth(l)),
    opts.title ? textWidth(opts.title) + 2 : 0,
  );
  const inner = contentWidth + pad * 2;
  const bc = (s: string): string => paint(s, fg(color));

  let top: string;
  if (opts.title) {
    const titleW = textWidth(opts.title);
    const fill = Math.max(0, inner - titleW - 3);
    top = bc('╭─ ') + opts.title + bc(' ' + '─'.repeat(fill) + '╮');
  } else {
    top = bc('╭' + '─'.repeat(inner) + '╮');
  }

  const body = lines.map((l) => {
    const padded = ' '.repeat(pad) + padEnd(l, contentWidth) + ' '.repeat(pad);
    return bc('│') + padded + bc('│');
  });

  const bottom = bc('╰' + '─'.repeat(inner) + '╯');
  return [top, ...body, bottom].join('\n');
}

export interface TableOptions {
  align?: ('left' | 'right')[];
  headerColor?: string;
  zebra?: boolean;
  gap?: number;
  showHeader?: boolean;
}

export function table(headers: string[], rows: string[][], opts: TableOptions = {}): string {
  const cols = headers.length;
  const gap = ' '.repeat(opts.gap ?? 2);
  const widths = headers.map((h, i) =>
    Math.max(textWidth(h), ...rows.map((r) => textWidth(r[i] ?? ''))),
  );
  const align = opts.align ?? headers.map(() => 'left' as const);

  const renderRow = (cells: string[], style?: (s: string) => string): string =>
    cells
      .map((cell, i) => {
        const c = cell ?? '';
        const fitted = align[i] === 'right' ? padStart(c, widths[i]) : padEnd(c, widths[i]);
        return style ? style(fitted) : fitted;
      })
      .join(gap)
      .trimEnd();

  const out: string[] = [];
  if (opts.showHeader !== false) {
    out.push(renderRow(headers, (s) => paint(s, bold(), fg(opts.headerColor ?? C.primary))));
    out.push(paint(widths.map((w) => '─'.repeat(w)).join(gap), fg(C.faint)));
  }
  rows.forEach((r, idx) => {
    const zebra = opts.zebra && idx % 2 === 1;
    out.push(zebra ? paint(renderRow(r), fg(C.soft)) : renderRow(r));
  });
  return out.join('\n');
}

/** Пары ключ → значение с выровненными ключами. */
export function kv(pairs: [string, string][], gap = 2): string {
  const w = Math.max(0, ...pairs.map(([k]) => textWidth(k)));
  return pairs.map(([k, v]) => paint(padEnd(k, w), fg(C.muted)) + ' '.repeat(gap) + v).join('\n');
}

/** Полоса заполнения: ████████░░░░░░ 62% */
export function bar(value: number, max: number, size = 24, color?: string): string {
  const ratio = max <= 0 ? 0 : Math.min(1, Math.max(0, value / max));
  const filled = Math.round(ratio * size);
  const c = color ?? C.primary;
  return paint('█'.repeat(filled), fg(c)) + paint('░'.repeat(Math.max(0, size - filled)), fg(C.faint));
}

const SPARK = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

export function sparkline(values: number[], color = C.info): string {
  if (!values.length) return '';
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  return paint(
    values.map((v) => SPARK[Math.min(SPARK.length - 1, Math.round(((v - min) / span) * 7))]).join(''),
    fg(color),
  );
}

export function hr(width = 60, color = C.faint): string {
  return paint('─'.repeat(width), fg(color));
}

export function badge(text: string, color: string): string {
  return paint(` ${text} `, bg(color), fg(C.bg), bold());
}

export function dot(color: string): string {
  return paint('●', fg(color));
}

export function clearScreen(): void {
  if (process.stdout.isTTY) process.stdout.write('\x1b[2J\x1b[H');
}

export function hideCursor(): void {
  if (process.stdout.isTTY) process.stdout.write('\x1b[?25l');
}

export function showCursor(): void {
  if (process.stdout.isTTY) process.stdout.write('\x1b[?25h');
}

/** Перерисовка блока фиксированной высоты на месте — база для TUI. */
export class Frame {
  private height = 0;

  draw(lines: string[]): void {
    let out = '';
    if (this.height > 0) out += `\x1b[${this.height}A`;
    for (const line of lines) out += '\x1b[2K' + line + '\n';
    if (lines.length < this.height) {
      const extra = this.height - lines.length;
      for (let i = 0; i < extra; i++) out += '\x1b[2K\n';
      out += `\x1b[${extra}A`;
    }
    this.height = lines.length;
    process.stdout.write(out);
  }

  done(): void {
    this.height = 0;
  }
}

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export interface Spinner {
  update(text: string): void;
  stop(finalLine?: string): void;
}

/** Спиннер. В не-TTY просто печатает текст один раз — логи остаются читаемыми. */
export function spinner(text: string): Spinner {
  let label = text;
  let i = 0;
  let timer: NodeJS.Timeout | null = null;
  const active = Boolean(process.stdout.isTTY);

  const render = (): void => {
    const frame = paint(SPINNER[i++ % SPINNER.length], fg(C.accent));
    process.stdout.write('\x1b[2K\r' + frame + ' ' + label);
  };

  if (active) {
    hideCursor();
    render();
    timer = setInterval(render, 80);
  } else {
    process.stderr.write(text + '\n');
  }

  return {
    update(next: string) {
      label = next;
      if (!active) process.stderr.write(next + '\n');
    },
    stop(finalLine?: string) {
      if (timer) clearInterval(timer);
      timer = null;
      if (active) {
        process.stdout.write('\x1b[2K\r');
        showCursor();
      }
      if (finalLine) process.stdout.write(finalLine + '\n');
    },
  };
}
