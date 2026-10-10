// Свои короткие имена: `jd d` → `jd run dev`.
//
// Алиасы живут в базе (kv), а не в файле: они личные и не должны разъезжаться
// по проектам. Встроенные команды всегда важнее алиаса — как в git.

import { kv } from './store.ts';

const KEY = 'aliases';

export type AliasMap = Record<string, string>;

export function loadAliases(): AliasMap {
  try {
    const raw = kv.get(KEY, '');
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: AliasMap = {};
    for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string' && value.trim()) out[name] = value.trim();
    }
    return out;
  } catch {
    return {};
  }
}

export function saveAliases(map: AliasMap): void {
  kv.set(KEY, JSON.stringify(map));
}

/** Найти алиас по имени. */
export function resolveAlias(name: string): string | null {
  return loadAliases()[name] ?? null;
}

export function setAlias(name: string, value: string): void {
  const map = loadAliases();
  map[name] = value.trim();
  saveAliases(map);
}

export function removeAlias(name: string): boolean {
  const map = loadAliases();
  if (!(name in map)) return false;
  delete map[name];
  saveAliases(map);
  return true;
}

/** Разобрать значение алиаса на аргументы, уважая кавычки. */
export function tokenize(value: string): string[] {
  const out: string[] = [];
  let current = '';
  let quote = '';
  for (const ch of value.trim()) {
    if (quote) {
      if (ch === quote) quote = '';
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current) out.push(current);
  return out;
}

/** Раскрыть алиасы по цепочке (не больше трёх шагов) и без зацикливания. */
export function expandAlias(argv: string[]): { argv: string[]; used: string[] } | null {
  const aliases = loadAliases();
  const used: string[] = [];
  let current = [...argv];

  for (let step = 0; step < 3; step++) {
    const first = current[0];
    if (!first) break;
    const value = aliases[first];
    if (!value || used.includes(first)) break;
    used.push(first);
    current = [...tokenize(value), ...current.slice(1)];
  }

  return used.length ? { argv: current, used } : null;
}

/** Имена, которые нельзя занимать: встроенные команды и уже существующие алиасы. */
export const RESERVED = ['menu', 'list', 'help', 'version'];
