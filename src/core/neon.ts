// Неоновое оформление на chalk: логотип с «отражением», градиентные линейки
// и анимированный спиннер для пошаговых операций.
//
// Важно: chalk уважает NO_COLOR и не-TTY сам, а мы дополнительно опускаем его
// уровень до 0, когда тема выключена флагом --no-color. Поэтому в пайпах
// вывод остаётся чистым текстом.

import { Chalk } from 'chalk';
import { colorEnabledNow } from './theme.ts';
import { formatMs } from './util.ts';

const levels = new Map<number, Chalk>();

function instance(): Chalk {
  const level = colorEnabledNow() ? 3 : 0;
  let ch = levels.get(level);
  if (!ch) {
    ch = new Chalk({ level });
    levels.set(level, ch);
  }
  return ch;
}

/**
 * chalk, который сам подстраивается под текущий режим цвета.
 * Использование как у обычного chalk: ch.hex('#ff2d95').bold('текст').
 */
export const ch: Chalk = new Proxy({} as Chalk, {
  get(_target, prop) {
    const inst = instance() as unknown as Record<string | symbol, unknown>;
    const value = inst[prop];
    return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(inst) : value;
  },
}) as Chalk;

/** Неоновая палитра поверх основной темы. */
export const N = {
  pink: '#ff2d95',
  magenta: '#f20089',
  violet: '#a45cff',
  cyan: '#00e5ff',
  aqua: '#2de2e6',
  lime: '#b6ff3c',
  amber: '#ffb01f',
  red: '#ff3860',
  ember: '#ff7a45',
  ink: '#12121c',
};

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(r: number, g: number, b: number): string {
  const clamp = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));
  return '#' + [r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('');
}

function mix(a: string, b: string, k: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return toHex(r1 + (r2 - r1) * k, g1 + (g2 - g1) * k, b1 + (b2 - b1) * k);
}

/** Затухание цвета к тёмному фону — для «отражения» и приглушённого неона. */
function fade(hex: string, amount: number): string {
  return mix(hex, N.ink, amount);
}

export interface GradOptions {
  bold?: boolean;
  /** 0 — цвет как есть, 1 — полностью растворён в фоне. */
  dim?: number;
}

/** Градиент по символам: от from к to слева направо. */
export function grad(text: string, from: string, to: string, opts: GradOptions = {}): string {
  if (!colorEnabledNow()) return text;
  const chars = [...text];
  const n = Math.max(1, chars.length - 1);
  return chars
    .map((chr, i) => {
      let color = mix(from, to, i / n);
      if (opts.dim) color = fade(color, opts.dim);
      let piece = ch.hex(color)(chr);
      if (opts.bold) piece = ch.bold(piece);
      return piece;
    })
    .join('');
}

/** Градиент по строкам: каждая строка получает свой оттенок. */
export function gradLines(lines: string[], from: string, to: string, opts: GradOptions = {}): string[] {
  if (!colorEnabledNow()) return lines;
  const n = Math.max(1, lines.length - 1);
  return lines.map((line, i) => {
    let color = mix(from, to, i / n);
    if (opts.dim) color = fade(color, opts.dim);
    const painted = ch.hex(color)(line);
    return opts.bold ? ch.bold(painted) : painted;
  });
}

/** Градиентная линейка — тонкая неоновая полоса под заголовком. */
export function neonRule(width = 52, from = N.pink, to = N.cyan): string {
  return grad('━'.repeat(width), from, to);
}

const LOGO = [
  '     ██╗██████╗ ',
  '     ██║██╔══██╗',
  '     ██║██║  ██║',
  '██   ██║██║  ██║',
  '╚█████╔╝██████╔╝',
  ' ╚════╝ ╚═════╝ ',
];

export interface NeonBannerOptions {
  subtitle?: string;
  version?: string;
  /** Печатать «отражение» под логотипом — эффект неона на стекле. */
  reflection?: boolean;
  indent?: string;
}

/**
 * Неоновый логотип: сам знак горит градиентом, под ним — затухающее отражение,
 * сверху и снизу — светящиеся линейки.
 */
export function neonBanner(opts: NeonBannerOptions = {}): string {
  const indent = opts.indent ?? '  ';
  const on = colorEnabledNow();

  const art = gradLines(LOGO, N.pink, N.cyan, { bold: true });
  const out: string[] = [];

  // Верхняя «искра» — редкие точки, как на вывеске.
  if (on) {
    const sparks = ['·', '✦', '·', '✧', '·', '·', '✦', '·', '·', '✧', '·', '·', '✦', '·'];
    out.push(indent + sparks.map((s, i) => ch.hex(fade(mix(N.pink, N.cyan, i / (sparks.length - 1)), 0.35))(s)).join('  '));
  }

  for (const line of art) out.push(indent + line);

  // Отражение: перевёрнутый логотип, гаснущий книзу.
  if (opts.reflection !== false && on) {
    // Отражение: перевёрнутый логотип без нижней строки (иначе она дублируется),
    // гаснущее по мере удаления от «пола».
    const flipped = [...LOGO.slice(0, -1)].reverse().slice(0, 3);
    flipped.forEach((line, i) => {
      const distance = i + 1;
      out.push(indent + gradLines([line], N.pink, N.cyan, { dim: 0.55 + distance * 0.13 })[0]);
    });
  }

  if (opts.subtitle) {
    const spaced = [...opts.subtitle.toUpperCase()].join(' ');
    out.push('');
    out.push(indent + '  ' + grad(spaced, N.violet, N.aqua, { dim: 0.15 }));
  }

  if (opts.version) {
    out.push(indent + '  ' + ch.hex(N.violet)('v' + opts.version) + ch.hex(fade(N.violet, 0.5))('  ·  личный пульт разработчика'));
  }

  out.push(indent + neonRule(54));
  return out.join('\n');
}

const SPIN_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export interface NeonSpinner {
  update(text: string): void;
  stop(finalLine?: string): void;
  succeed(text: string): void;
  fail(text: string): void;
}

/**
 * Анимированный спиннер: рамка меняет цвет по кругу от розового к циану,
 * справа тикает время. В не-TTY просто печатает строку один раз.
 */
export function neonSpinner(text: string, opts: { color?: string } = {}): NeonSpinner {
  const started = Date.now();
  let label = text;
  let tick = 0;
  let timer: NodeJS.Timeout | null = null;
  const active = Boolean(process.stdout.isTTY) && colorEnabledNow();

  const render = (): void => {
    const k = (tick % 20) / 19;
    const color = mix(opts.color ?? N.pink, N.cyan, k <= 0.5 ? k * 2 : (1 - k) * 2);
    const frame = ch.hex(color).bold(SPIN_FRAMES[tick % SPIN_FRAMES.length]);
    const time = ch.hex(fade(N.violet, 0.4))(` ${formatMs(Date.now() - started)}`);
    process.stdout.write('\x1b[2K\r' + '  ' + frame + ' ' + label + time);
    tick++;
  };

  if (active) {
    process.stdout.write('\x1b[?25l');
    render();
    timer = setInterval(render, 80);
  }
  // Вне TTY молчим: прогресс не нужен, а мусор в stderr мешает пайпам и скриптам.
  // Итог шага всё равно печатается через succeed/fail/stop.

  const clear = (): void => {
    if (timer) clearInterval(timer);
    timer = null;
    if (active) {
      process.stdout.write('\x1b[2K\r');
      process.stdout.write('\x1b[?25h');
    }
  };

  return {
    update(next: string) {
      label = next;
    },
    stop(finalLine?: string) {
      clear();
      if (finalLine) process.stdout.write('  ' + finalLine + '\n');
    },
    succeed(done: string) {
      clear();
      const mark = colorEnabledNow() ? ch.hex(N.lime).bold('✔') : '✔';
      const time = colorEnabledNow() ? ch.hex(fade(N.violet, 0.4))(`  ${formatMs(Date.now() - started)}`) : '';
      process.stdout.write('  ' + mark + ' ' + done + time + '\n');
    },
    fail(reason: string) {
      clear();
      const mark = colorEnabledNow() ? ch.hex(N.red).bold('✖') : '✖';
      process.stdout.write('  ' + mark + ' ' + reason + '\n');
    },
  };
}

export interface Step {
  label: string;
  run: () => Promise<void> | void;
  /** Успешный итог. Строка или функция — если итог зависит от того, что реально произошло. */
  doneLabel?: string | (() => string);
}

export interface StepResult {
  label: string;
  ok: boolean;
  ms: number;
  error?: string;
}

/**
 * Выполнить шаги подряд, каждый — под своим спиннером, и напечатать
 * аккуратный протокол. На ошибке останавливается и возвращает, что упало.
 */
export async function runSteps(steps: Step[], startIndex = 1): Promise<{ results: StepResult[]; failed: StepResult | null }> {
  const results: StepResult[] = [];
  let index = startIndex;

  for (const step of steps) {
    const stepSpinner = neonSpinner(`${index}/${steps.length + startIndex - 1}  ${step.label}`);
    const began = Date.now();
    try {
      await step.run();
      const finalLabel = typeof step.doneLabel === 'function' ? step.doneLabel() : step.doneLabel;
      stepSpinner.succeed(finalLabel ?? step.label);
      results.push({ label: step.label, ok: true, ms: Date.now() - began });
    } catch (err) {
      const message = (err as Error).message || String(err);
      stepSpinner.fail(`${step.label} — ${message}`);
      const failed: StepResult = { label: step.label, ok: false, ms: Date.now() - began, error: message };
      results.push(failed);
      return { results, failed };
    }
    index++;
  }

  return { results, failed: null };
}
