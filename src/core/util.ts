// Утилиты: размеры, длительности, fuzzy-поиск, хеши, работа с потоками ввода.

import { createHash, randomUUID } from 'node:crypto';

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Убрать BOM в начале текста. Windows-редакторы (и PowerShell Out-File)
 * любят писать его в .env, .gitignore и JSON — из-за него JSON.parse падает,
 * а первая строка .gitignore перестаёт совпадать с шаблоном.
 */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** 1536 -> "1.5 КБ", 0 -> "0 Б" */
export function formatBytes(bytes: number, digits = 1): string {
  if (!Number.isFinite(bytes)) return '—';
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ', 'ПБ'];
  let v = Math.abs(bytes);
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const sign = bytes < 0 ? '-' : '';
  const fixed = i === 0 ? String(Math.round(v)) : v.toFixed(digits);
  return `${sign}${fixed} ${units[i]}`;
}

/** 3725000 -> "1ч 2м 5с" */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts: string[] = [];
  if (d) parts.push(`${d}д`);
  if (h) parts.push(`${h}ч`);
  if (m && !d) parts.push(`${m}м`);
  if (s && !d && !h) parts.push(`${s}с`);
  return parts.join(' ') || '0с';
}

/** 420 -> "420 мс", 1500 -> "1.5 с". Для коротких операций секунды слишком грубы. */
export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} мс`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} с`;
  return formatDuration(ms);
}

/** "5 минут назад", "вчера", "12.03.2025" */
export function timeAgo(date: Date | number | string): string {
  const d = date instanceof Date ? date : new Date(date);
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'вчера';
  if (days < 7) return `${days} дн назад`;
  return d.toLocaleDateString('ru-RU');
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function stamp(d = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function uuid(): string {
  return randomUUID();
}

export interface FuzzyResult {
  score: number;
  positions: number[];
}

/**
 * Нечёткий поиск: "snp" находит "snip add". Чем плотнее совпадение и чем
 * раньше оно начинается — тем выше счёт.
 */
export function fuzzyMatch(query: string, text: string): FuzzyResult | null {
  if (!query) return { score: 0, positions: [] };
  const q = query.toLowerCase();
  const target = text.toLowerCase();
  let qi = 0;
  let score = 0;
  let streak = 0;
  const positions: number[] = [];

  for (let i = 0; i < target.length && qi < q.length; i++) {
    if (target[i] === q[qi]) {
      positions.push(i);
      streak++;
      score += 10 + streak * 5;
      const prev = i > 0 ? target[i - 1] : '';
      if (i === 0) score += 20;
      else if (/[\s._\-/:]/.test(prev)) score += 15;
      qi++;
    } else {
      streak = 0;
    }
  }

  if (qi < q.length) return null;
  score -= Math.max(0, target.length - q.length) * 0.4;
  return { score, positions };
}

/**
 * Разбить строку на визуальные кластеры: базовый символ вместе с селекторами
 * (U+FE0E/U+FE0F) и ZWJ-последовательностями. Без этого эмодзи вроде «🛠️»
 * считались бы как два разных знака и ломали выравнивание.
 */
export function clusters(s: string): string[] {
  const chars = [...s];
  const out: string[] = [];
  for (let i = 0; i < chars.length; i++) {
    let cluster = chars[i];
    while (i + 1 < chars.length) {
      const next = chars[i + 1].codePointAt(0) ?? 0;
      if (next === 0xfe0e || next === 0xfe0f) {
        cluster += chars[i + 1];
        i++;
        continue;
      }
      if (next === 0x200d && i + 2 < chars.length) {
        cluster += chars[i + 1] + chars[i + 2];
        i += 2;
        continue;
      }
      break;
    }
    out.push(cluster);
  }
  return out;
}

/** Ширина одного кластера в ячейках терминала. */
export function clusterWidth(cluster: string): number {
  const cps = [...cluster].map((c) => c.codePointAt(0) ?? 0);
  const base = cps[0] ?? 0;
  if (base === 0xfe0e || base === 0xfe0f) return 0;
  // Селектор эмодзи переводит узкий символ (✔, ⚠, ⚗) в широкое начертание.
  if (cps.includes(0xfe0f)) return 2;
  return isWide(base) ? 2 : 1;
}

/** Разложить строку на количество ячеек терминала. */
export function textWidth(s: string): number {
  const plain = s.replace(/\x1b\[[0-9;]*m/g, '');
  let w = 0;
  for (const cluster of clusters(plain)) w += clusterWidth(cluster);
  return w;
}

function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    // Все эмодзи-блоки: 1F300–1F64F, 1F680–1F6FF, 1F900–1F9FF и т.д.
    (cp >= 0x1f000 && cp <= 0x1faff) ||
    // ⬛ ⭐ ⬅ — символы с эмодзи-начертанием по умолчанию.
    (cp >= 0x2b00 && cp <= 0x2bff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  );
}

/** Прочитать stdin целиком, если он пришёл из пайпа. Иначе null. */
export async function readStdin(): Promise<string | null> {
  if (process.stdin.isTTY) return null;
  const chunks: Buffer[] = [];
  try {
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Buffer));
  } catch {
    return null;
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text.length ? text : null;
}

/** Значение из argv или из stdin — удобно для конвертеров. */
export async function valueOrStdin(value: string | undefined): Promise<string | null> {
  if (value !== undefined && value !== '') return value;
  const piped = await readStdin();
  if (piped === null) return null;
  return piped.replace(/\r?\n$/, '');
}

export function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

export function groupBy<T, K extends string>(items: T[], key: (item: T) => K): Record<K, T[]> {
  const out = {} as Record<K, T[]>;
  for (const item of items) {
    const k = key(item);
    (out[k] ||= []).push(item);
  }
  return out;
}
