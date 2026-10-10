// Подсветка JSON и доступ по пути вида "items.0.name".

import { C, bold, fg, paint } from './theme.ts';

const TOKEN_RE = /("(?:\\.|[^"\\])*"\s*:)|("(?:\\.|[^"\\])*")|(\btrue\b|\bfalse\b)|(\bnull\b)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

/** Раскрасить компактный или форматированный JSON. */
export function colorizeJson(text: string): string {
  return text.replace(TOKEN_RE, (match, key, str, bool, nul, num) => {
    if (key) return paint(key, fg(C.info));
    if (str) return paint(str, fg(C.ok));
    if (bool) return paint(match, fg(C.accent), bold());
    if (nul) return paint(match, fg(C.muted));
    if (num) return paint(match, fg(C.warn));
    return match;
  });
}

export function prettyJson(value: unknown, indent = 2): string {
  return JSON.stringify(value, null, indent);
}

/** Достать значение по пути "a.b.0.c". Поддерживает ключи с точками через ["..."] */
export function queryPath(root: unknown, pathExpr: string): unknown {
  if (!pathExpr) return root;
  const parts: string[] = [];
  const re = /\["([^"]+)"\]|\[(\d+)\]|([^.[\]]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pathExpr)) !== null) {
    parts.push(m[1] ?? m[2] ?? m[3]);
  }

  let current: unknown = root;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const idx = Number(part);
      current = Number.isNaN(idx) ? undefined : current[idx];
    } else if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

/** Короткое описание структуры JSON — полезно для быстрого взгляда. */
export function describeShape(value: unknown, depth = 0): string {
  if (value === null) return paint('null', fg(C.muted));
  if (Array.isArray(value)) {
    if (value.length === 0) return paint('[] пустой массив', fg(C.muted));
    return `${paint(`массив [${value.length}]`, fg(C.accent))} из ${describeShape(value[0], depth + 1)}`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value as object);
    const head = keys.slice(0, 6).join(', ');
    const more = keys.length > 6 ? `, … +${keys.length - 6}` : '';
    return `${paint(`объект {${keys.length}}`, fg(C.accent))} ${paint(head + more, fg(C.muted))}`;
  }
  return paint(typeof value, fg(C.warn));
}
