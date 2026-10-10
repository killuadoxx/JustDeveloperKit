// Хранилище на встроенном node:sqlite. База живёт в ~/.jd/jd.db (или $JD_HOME).
// Здесь же — типизированные операции над сниппетами, заметками, историей.

import './warnings.ts';

import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

export function jdHome(): string {
  return process.env.JD_HOME || path.join(os.homedir(), '.jd');
}

export function dbPath(): string {
  return path.join(jdHome(), 'jd.db');
}

type DB = DatabaseSync;

let ctor: (new (file: string) => DB) | null = null;
let database: DB | null = null;

/**
 * node:sqlite подгружаем лениво — и ради скорости (командам без базы он не нужен),
 * и ради тишины: при статическом импорте Node печатает ExperimentalWarning
 * на этапе загрузки графа, то есть раньше, чем warnings.ts успевает заглушить его.
 */
function databaseClass(): new (file: string) => DB {
  if (!ctor) {
    const mod = process.getBuiltinModule('node:sqlite') as { DatabaseSync: new (file: string) => DB };
    ctor = mod.DatabaseSync;
  }
  return ctor;
}

export function db(): DB {
  if (database) return database;
  mkdirSync(jdHome(), { recursive: true });
  const Database = databaseClass();
  database = new Database(dbPath());
  database.exec('PRAGMA journal_mode = WAL');
  database.exec(`
    CREATE TABLE IF NOT EXISTS snippets (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL UNIQUE,
      lang       TEXT NOT NULL DEFAULT 'text',
      tags       TEXT NOT NULL DEFAULT '',
      body       TEXT NOT NULL,
      uses       INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      body       TEXT NOT NULL,
      tags       TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS todos (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      body       TEXT NOT NULL,
      done       INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      done_at    TEXT
    );
    CREATE TABLE IF NOT EXISTS history (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      kind       TEXT NOT NULL,
      title      TEXT NOT NULL,
      payload    TEXT NOT NULL DEFAULT '',
      ok         INTEGER NOT NULL DEFAULT 1,
      ms         INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      context    TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS kv (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL
    );
    -- Магазин расширений: базовый каталог плюс всё, что пользователь добавил сам.
    CREATE TABLE IF NOT EXISTS pkgs (
      name       TEXT PRIMARY KEY,
      spec       TEXT NOT NULL,
      title      TEXT NOT NULL DEFAULT '',
      desc       TEXT NOT NULL DEFAULT '',
      category   TEXT NOT NULL DEFAULT 'Разное',
      tags       TEXT NOT NULL DEFAULT '',
      url        TEXT NOT NULL DEFAULT '',
      dev        INTEGER NOT NULL DEFAULT 0,
      builtin    INTEGER NOT NULL DEFAULT 0,
      hidden     INTEGER NOT NULL DEFAULT 0,
      installs   INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS presets (
      name       TEXT PRIMARY KEY,
      title      TEXT NOT NULL DEFAULT '',
      desc       TEXT NOT NULL DEFAULT '',
      icon       TEXT NOT NULL DEFAULT '📦',
      items      TEXT NOT NULL DEFAULT '[]',
      scripts    TEXT NOT NULL DEFAULT '{}',
      env        TEXT NOT NULL DEFAULT '[]',
      files      TEXT NOT NULL DEFAULT '[]',
      builtin    INTEGER NOT NULL DEFAULT 0,
      uses       INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS installs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      project    TEXT NOT NULL,
      name       TEXT NOT NULL,
      spec       TEXT NOT NULL,
      dev        INTEGER NOT NULL DEFAULT 0,
      ok         INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_history_kind ON history(kind, id DESC);
    CREATE INDEX IF NOT EXISTS idx_installs_project ON installs(project, id DESC);
  `);

  // Старые базы создавались без context: добавляем колонку, а не ломаем их.
  ensureColumn('history', 'context', "TEXT NOT NULL DEFAULT ''");
  return database;
}

/** Добавить колонку, если её ещё нет — мягкая миграция для уже существующих баз. */
function ensureColumn(table: string, column: string, definition: string): void {
  if (!database) return;
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (columns.some((c) => c.name === column)) return;
  database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function now(): string {
  return new Date().toISOString();
}

/* ------------------------------- сниппеты ------------------------------- */

export interface Snippet {
  id: number;
  name: string;
  lang: string;
  tags: string;
  body: string;
  uses: number;
  created_at: string;
  updated_at: string;
}

export const snippets = {
  upsert(input: { name: string; body: string; lang?: string; tags?: string }): void {
    const exists = snippets.get(input.name);
    if (exists) {
      db()
        .prepare('UPDATE snippets SET body = ?, lang = ?, tags = ?, updated_at = ? WHERE name = ?')
        .run(input.body, input.lang ?? exists.lang, input.tags ?? exists.tags, now(), input.name);
    } else {
      db()
        .prepare(
          'INSERT INTO snippets (name, lang, tags, body, uses, created_at, updated_at) VALUES (?,?,?,?,0,?,?)',
        )
        .run(input.name, input.lang ?? 'text', input.tags ?? '', input.body, now(), now());
    }
  },

  get(name: string): Snippet | null {
    const row = db().prepare('SELECT * FROM snippets WHERE name = ?').get(name);
    return (row as Snippet | undefined) ?? null;
  },

  all(): Snippet[] {
    return db().prepare('SELECT * FROM snippets ORDER BY updated_at DESC').all() as Snippet[];
  },

  remove(name: string): boolean {
    const res = db().prepare('DELETE FROM snippets WHERE name = ?').run(name);
    return Number(res.changes) > 0;
  },

  touch(name: string): void {
    db().prepare('UPDATE snippets SET uses = uses + 1 WHERE name = ?').run(name);
  },
};

/* -------------------------------- заметки ------------------------------- */

export interface Note {
  id: number;
  body: string;
  tags: string;
  created_at: string;
}

export const notes = {
  add(body: string, tags = ''): number {
    const res = db()
      .prepare('INSERT INTO notes (body, tags, created_at) VALUES (?,?,?)')
      .run(body, tags, now());
    return Number(res.lastInsertRowid);
  },
  all(limit = 50): Note[] {
    return db().prepare('SELECT * FROM notes ORDER BY id DESC LIMIT ?').all(limit) as Note[];
  },
  search(query: string, limit = 50): Note[] {
    return db()
      .prepare('SELECT * FROM notes WHERE body LIKE ? ORDER BY id DESC LIMIT ?')
      .all(`%${query}%`, limit) as Note[];
  },
  remove(id: number): boolean {
    return Number(db().prepare('DELETE FROM notes WHERE id = ?').run(id).changes) > 0;
  },
};

/* --------------------------------- задачи ------------------------------- */

export interface Todo {
  id: number;
  body: string;
  done: number;
  created_at: string;
  done_at: string | null;
}

export const todos = {
  add(body: string): number {
    const res = db().prepare('INSERT INTO todos (body, created_at) VALUES (?,?)').run(body, now());
    return Number(res.lastInsertRowid);
  },
  all(includeDone = false): Todo[] {
    const sql = includeDone
      ? 'SELECT * FROM todos ORDER BY done ASC, id DESC'
      : 'SELECT * FROM todos WHERE done = 0 ORDER BY id ASC';
    return db().prepare(sql).all() as Todo[];
  },
  toggle(id: number): boolean {
    const row = db().prepare('SELECT done FROM todos WHERE id = ?').get(id) as { done: number } | undefined;
    if (!row) return false;
    const next = row.done ? 0 : 1;
    db().prepare('UPDATE todos SET done = ?, done_at = ? WHERE id = ?').run(next, next ? now() : null, id);
    return true;
  },
  remove(id: number): boolean {
    return Number(db().prepare('DELETE FROM todos WHERE id = ?').run(id).changes) > 0;
  },
};

/* --------------------------------- история ------------------------------ */

export interface HistoryRow {
  id: number;
  kind: string;
  title: string;
  payload: string;
  ok: number;
  ms: number;
  created_at: string;
  context: string;
}

export const history = {
  add(row: { kind: string; title: string; payload?: string; ok?: boolean; ms?: number; context?: string }): void {
    db()
      .prepare('INSERT INTO history (kind, title, payload, ok, ms, created_at, context) VALUES (?,?,?,?,?,?,?)')
      .run(row.kind, row.title, row.payload ?? '', row.ok === false ? 0 : 1, row.ms ?? 0, now(), row.context ?? '');
  },
  recent(kind: string, limit = 20): HistoryRow[] {
    return db()
      .prepare('SELECT * FROM history WHERE kind = ? ORDER BY id DESC LIMIT ?')
      .all(kind, limit) as unknown as HistoryRow[];
  },
  /** Всё по одному контексту (например, папке проекта), свежие сверху. */
  byContext(kind: string, context: string, limit = 2000): HistoryRow[] {
    return db()
      .prepare('SELECT * FROM history WHERE kind = ? AND context = ? ORDER BY id DESC LIMIT ?')
      .all(kind, context, limit) as unknown as HistoryRow[];
  },
  all(limit = 50): HistoryRow[] {
    return db().prepare('SELECT * FROM history ORDER BY id DESC LIMIT ?').all(limit) as unknown as HistoryRow[];
  },
  search(query: string, limit = 20): HistoryRow[] {
    return db()
      .prepare('SELECT * FROM history WHERE title LIKE ? ORDER BY id DESC LIMIT ?')
      .all(`%${query}%`, limit) as unknown as HistoryRow[];
  },
  clear(kind?: string): number {
    const res = kind
      ? db().prepare('DELETE FROM history WHERE kind = ?').run(kind)
      : db().prepare('DELETE FROM history').run();
    return Number(res.changes);
  },
  /** Очистить историю одного контекста — например, конкретной папки проекта. */
  clearContext(kind: string, context: string): number {
    const res = db().prepare('DELETE FROM history WHERE kind = ? AND context = ?').run(kind, context);
    return Number(res.changes);
  },
};

/* ----------------------------------- kv --------------------------------- */

export const kv = {
  get(key: string, def = ''): string {
    const row = db().prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? def;
  },
  set(key: string, value: string): void {
    db()
      .prepare('INSERT INTO kv (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value);
  },
  all(): { key: string; value: string }[] {
    return db().prepare('SELECT key, value FROM kv ORDER BY key').all() as { key: string; value: string }[];
  },
};
