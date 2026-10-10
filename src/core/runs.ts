// История запусков команд проекта.
//
// Нужна, чтобы отвечать на вопросы «падало ли это раньше», «сколько идёт»,
// «что я запускаю чаще всего» — и чтобы меню показывало это прямо в панели деталей.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { dbPath, history, type HistoryRow } from './store.ts';

export const RUN_KIND = 'project';

/** База ещё не создана — значит, истории нет и создавать её ради подсказки не стоит. */
function dbReady(): boolean {
  try {
    return existsSync(dbPath());
  } catch {
    return false;
  }
}

export interface RunStat {
  title: string;
  /** Сколько раз запускали. */
  runs: number;
  fails: number;
  /** Среднее время удачного запуска, мс. */
  avgMs: number;
  /** Время последнего запуска. */
  lastAt: string;
  lastOk: boolean;
  lastMs: number;
  /** Последняя команда, которая реально выполнялась. */
  lastCmd: string;
}

function normalize(dir: string): string {
  return path.resolve(dir);
}

/** Записать запуск команды проекта. */
export function recordRun(dir: string, title: string, cmd: string, ok: boolean, ms: number): void {
  try {
    history.add({ kind: RUN_KIND, title, payload: cmd, ok, ms, context: normalize(dir) });
  } catch {
    // История — вспомогательная вещь: если база недоступна, команда всё равно должна работать.
  }
}

/** Сырые записи по папке проекта. */
export function projectRuns(dir: string, limit = 2000): HistoryRow[] {
  if (!dbReady()) return [];
  try {
    return history.byContext(RUN_KIND, normalize(dir), limit);
  } catch {
    return [];
  }
}

/** Агрегаты по командам: сколько запусков, падений, среднее время, последний запуск. */
export function runStats(dir: string, rows = projectRuns(dir)): RunStat[] {
  const map = new Map<string, RunStat & { okMs: number; okCount: number }>();

  for (const row of rows) {
    let stat = map.get(row.title);
    if (!stat) {
      stat = { title: row.title, runs: 0, fails: 0, avgMs: 0, lastAt: row.created_at, lastOk: true, lastMs: 0, lastCmd: '', okMs: 0, okCount: 0 };
      map.set(row.title, stat);
    }
    stat.runs++;
    if (!row.ok) stat.fails++;
    else {
      stat.okMs += row.ms;
      stat.okCount++;
    }
    // rows идут свежими сверху, поэтому первый встреченный — последний запуск.
    if (!stat.lastCmd) {
      stat.lastAt = row.created_at;
      stat.lastOk = Boolean(row.ok);
      stat.lastMs = row.ms;
      stat.lastCmd = row.payload;
    }
  }

  return [...map.values()]
    .map(({ okMs, okCount, ...stat }) => ({ ...stat, avgMs: okCount ? Math.round(okMs / okCount) : 0 }))
    .sort((a, b) => b.runs - a.runs || a.title.localeCompare(b.title, 'ru'));
}

/** Статистика одной команды проекта. */
export function runStatOf(dir: string, title: string): RunStat | null {
  return runStats(dir).find((s) => s.title === title) ?? null;
}

/** Самые проблемные команды: сначала те, что падают чаще. */
export function failingStats(stats: RunStat[]): RunStat[] {
  return stats.filter((s) => s.fails > 0).sort((a, b) => b.fails - a.fails || b.runs - a.runs);
}
