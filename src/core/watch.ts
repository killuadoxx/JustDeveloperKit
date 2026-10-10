// Наблюдение: дождаться, пока поднимется сервер, и заметить, что файлы изменились.
//
// Файлы отслеживаем опросом размеров и времени правки, а не fs.watch: опрос
// работает одинаково на Windows, Linux и в WSL, не теряет события при переименовании
// и не требует зависимостей. Для «перезапустить дев-сервер» этого более чем достаточно.

import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { ignoredDirsFromGitignore, shouldSkipDir } from './arch.ts';
import { mapLimit } from './ports.ts';
import { readFile } from 'node:fs/promises';
import { stripBom } from './util.ts';

export interface FileStamp {
  size: number;
  mtime: number;
}

export type FileState = Map<string, FileStamp>;

export interface SnapshotOptions {
  /** Что пропускать: по умолчанию мусорные папки и то, что в .gitignore. */
  skipDirs?: Set<string>;
  maxFiles?: number;
}

/** Собрать «отпечатки» файлов: размер и время правки. */
export async function fileState(root: string, opts: SnapshotOptions = {}): Promise<FileState> {
  const state: FileState = new Map();
  const maxFiles = opts.maxFiles ?? 20000;

  let ignore = opts.skipDirs ?? new Set<string>();
  if (!opts.skipDirs) {
    try {
      ignore = ignoredDirsFromGitignore(stripBom(await readFile(path.join(root, '.gitignore'), 'utf8')));
    } catch {
      ignore = new Set();
    }
  }

  const walk = async (dir: string): Promise<void> => {
    if (state.size >= maxFiles) return;
    let entries: Awaited<ReturnType<typeof readdir>>;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const dirs: string[] = [];
    const files: string[] = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (shouldSkipDir(entry.name) || ignore.has(entry.name)) continue;
        dirs.push(path.join(dir, entry.name));
      } else if (entry.isFile()) {
        files.push(path.join(dir, entry.name));
      }
    }

    await mapLimit(files, 32, async (file) => {
      try {
        const info = await stat(file);
        state.set(path.relative(root, file).split(path.sep).join('/'), { size: info.size, mtime: info.mtimeMs });
      } catch {
        // файл исчез между чтением папки и stat — это и есть изменение, не беда
      }
    });
    for (const child of dirs) await walk(child);
  };

  const info = await stat(root).catch(() => null);
  if (info?.isFile()) {
    state.set(path.basename(root), { size: info.size, mtime: info.mtimeMs });
    return state;
  }
  await walk(root);
  return state;
}

export interface StateChange {
  changed: string[];
  added: string[];
  removed: string[];
}

export function compareStates(before: FileState, after: FileState): StateChange {
  const changed: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];

  for (const [file, stamp] of after) {
    const was = before.get(file);
    if (!was) added.push(file);
    else if (was.size !== stamp.size || was.mtime !== stamp.mtime) changed.push(file);
  }
  for (const file of before.keys()) if (!after.has(file)) removed.push(file);

  const sort = (list: string[]): string[] => list.sort((a, b) => a.localeCompare(b));
  return { changed: sort(changed), added: sort(added), removed: sort(removed) };
}

export function isEmptyChange(change: StateChange): boolean {
  return !change.changed.length && !change.added.length && !change.removed.length;
}

/** Короткое описание изменения: «src/index.ts», «+2 новых», «−1 удалён». */
export function describeChange(change: StateChange, max = 3): string {
  const parts: string[] = [];
  const shown = change.changed.slice(0, max);
  if (shown.length) parts.push(shown.join(', ') + (change.changed.length > shown.length ? ` и ещё ${change.changed.length - shown.length}` : ''));
  if (change.added.length) parts.push(`новые: ${change.added.slice(0, 2).join(', ')}${change.added.length > 2 ? ` и ещё ${change.added.length - 2}` : ''}`);
  if (change.removed.length) parts.push(`удалены: ${change.removed.slice(0, 2).join(', ')}${change.removed.length > 2 ? ` и ещё ${change.removed.length - 2}` : ''}`);
  return parts.join(' · ') || 'изменения';
}

/* ---------------------------------- URL ---------------------------------- */

export interface UrlWaitOptions {
  intervalMs?: number;
  timeoutMs?: number;
  /** Попытка: можно показать прогресс. Возвращает false, чтобы прекратить ожидание. */
  onAttempt?: (attempt: number, elapsedMs: number) => boolean | void;
  signal?: AbortSignal;
}

export interface UrlWaitResult {
  ok: boolean;
  status: number | null;
  attempts: number;
  ms: number;
  error?: string;
}

/** Ждать, пока URL начнёт отвечать. Любой HTTP-ответ считается «поднялся». */
export async function waitForUrl(url: string, opts: UrlWaitOptions = {}): Promise<UrlWaitResult> {
  const interval = Math.max(200, opts.intervalMs ?? 1000);
  const timeout = Math.max(1000, opts.timeoutMs ?? 120000);
  const started = Date.now();
  let attempt = 0;
  let lastError = '';

  for (;;) {
    if (opts.signal?.aborted) return { ok: false, status: null, attempts: attempt, ms: Date.now() - started, error: 'прервано' };
    attempt++;
    const keepGoing = opts.onAttempt?.(attempt, Date.now() - started);
    if (keepGoing === false) return { ok: false, status: null, attempts: attempt, ms: Date.now() - started, error: 'остановлено' };

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(Math.min(5000, interval * 3)) });
      return { ok: true, status: response.status, attempts: attempt, ms: Date.now() - started };
    } catch (err) {
      lastError = (err as Error).name === 'TimeoutError' ? 'превышено время ожидания ответа' : (err as Error).message;
    }

    if (Date.now() - started >= timeout) {
      return { ok: false, status: null, attempts: attempt, ms: Date.now() - started, error: lastError || 'не дождались ответа' };
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}
