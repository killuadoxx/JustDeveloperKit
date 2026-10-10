// Палитра и ANSI. truecolor, с честным уважением к NO_COLOR / FORCE_COLOR / не-TTY.
//
// Порядок приоритетов такой же, как у chalk: явный FORCE_COLOR сильнее NO_COLOR,
// иначе два движка цвета в одном приложении разошлись бы в решении.

const env = process.env;

let colorEnabled: boolean = (() => {
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== '') return env.FORCE_COLOR !== '0';
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false;
  return Boolean(process.stdout.isTTY);
})();

export function setColor(on: boolean): void {
  colorEnabled = on;
}
export function colorEnabledNow(): boolean {
  return colorEnabled;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function fg(hex: string): string {
  if (!colorEnabled) return '';
  const [r, g, b] = hexToRgb(hex);
  return `\x1b[38;2;${r};${g};${b}m`;
}

export function bg(hex: string): string {
  if (!colorEnabled) return '';
  const [r, g, b] = hexToRgb(hex);
  return `\x1b[48;2;${r};${g};${b}m`;
}

export const RESET = '\x1b[0m';
export const reset = (): string => (colorEnabled ? RESET : '');
export const bold = (): string => (colorEnabled ? '\x1b[1m' : '');
export const dim = (): string => (colorEnabled ? '\x1b[2m' : '');
export const italic = (): string => (colorEnabled ? '\x1b[3m' : '');
export const underline = (): string => (colorEnabled ? '\x1b[4m' : '');
export const inverse = (): string => (colorEnabled ? '\x1b[7m' : '');
export const strike = (): string => (colorEnabled ? '\x1b[9m' : '');

// Тёмная тема в духе Tokyo Night — приятно смотреть целый день.
export const C = {
  text: '#c0caf5',
  soft: '#a9b1d6',
  muted: '#565f89',
  faint: '#3b4261',
  primary: '#7aa2f7',
  accent: '#bb9af7',
  ok: '#9ece6a',
  warn: '#e0af68',
  err: '#f7768e',
  info: '#7dcfff',
  pink: '#ff75a0',
  cyan: '#73daca',
  bg: '#1a1b26',
  bgSoft: '#24283b',
};

export type Style = string;

export function paint(text: string, ...styles: Style[]): string {
  if (!colorEnabled || styles.length === 0) return text;
  return styles.join('') + text + RESET;
}

export const t = {
  plain: (s: string) => s,
  text: (s: string) => paint(s, fg(C.text)),
  soft: (s: string) => paint(s, fg(C.soft)),
  muted: (s: string) => paint(s, fg(C.muted)),
  faint: (s: string) => paint(s, fg(C.faint)),
  primary: (s: string) => paint(s, fg(C.primary)),
  accent: (s: string) => paint(s, fg(C.accent)),
  ok: (s: string) => paint(s, fg(C.ok)),
  warn: (s: string) => paint(s, fg(C.warn)),
  err: (s: string) => paint(s, fg(C.err)),
  info: (s: string) => paint(s, fg(C.info)),
  pink: (s: string) => paint(s, fg(C.pink)),
  cyan: (s: string) => paint(s, fg(C.cyan)),
  b: (s: string) => paint(s, bold(), fg(C.text)),
  title: (s: string) => paint(s, bold(), fg(C.primary)),
  key: (s: string) => paint(s, fg(C.info)),
  val: (s: string) => paint(s, fg(C.text)),
  dim: (s: string) => paint(s, dim(), fg(C.soft)),
  inv: (s: string) => paint(s, inverse()),
};

/** Плавный градиент по символам — для логотипа и заголовков. */
export function gradient(text: string, from: string, to: string): string {
  if (!colorEnabled) return text;
  const [r1, g1, b1] = hexToRgb(from);
  const [r2, g2, b2] = hexToRgb(to);
  const chars = [...text];
  const n = Math.max(1, chars.length - 1);
  return chars
    .map((ch, i) => {
      const k = i / n;
      const r = Math.round(r1 + (r2 - r1) * k);
      const g = Math.round(g1 + (g2 - g1) * k);
      const b = Math.round(b1 + (b2 - b1) * k);
      return `\x1b[38;2;${r};${g};${b}m${ch}`;
    })
    .join('') + RESET;
}

/** Цвет по смыслу значения: зелёный — хорошо, красный — плохо. */
export function statusColor(pct: number): string {
  if (pct >= 90) return C.err;
  if (pct >= 70) return C.warn;
  if (pct >= 40) return C.ok;
  return C.info;
}
