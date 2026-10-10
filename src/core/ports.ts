// Общая логика по портам: кто слушает, кто держит, чем занят и как освободить.
// Используется командами ports, killport и scan — чтобы не дублировать разбор netstat.

import { createConnection } from 'node:net';
import { killTree, psJson, run } from './shell.ts';

export interface PortRow {
  proto: string;
  address: string;
  port: number;
  pid: number;
  process: string;
  state: string;
}

/** Порты, которые чаще всего занимает веб-разработка. */
export const POPULAR_PORTS: number[] = [
  3000, 3001, 3002, 4000, 4200, 4321, 5000, 5173, 5174, 5500, 5555, 6000,
  7000, 8000, 8001, 8080, 8081, 8443, 8888, 9000, 9090, 9229, 27017, 5432, 6379, 3306,
];

export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export async function processNames(): Promise<Map<number, string>> {
  if (process.platform !== 'win32') return new Map();
  const res = await run('tasklist', ['/FO', 'CSV', '/NH'], { timeout: 20000 });
  const map = new Map<number, string>();
  for (const line of res.stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    const pid = Number(cols[1]);
    if (Number.isFinite(pid) && cols[0]) map.set(pid, cols[0]);
  }
  return map;
}

function splitAddress(local: string): { address: string; port: number } {
  const idx = local.lastIndexOf(':');
  if (idx === -1) return { address: local, port: 0 };
  return { address: local.slice(0, idx), port: Number(local.slice(idx + 1)) };
}

/**
 * Список занятых портов. includeAll=true — все соединения (включая ESTABLISHED),
 * иначе только слушающие. Отсортирован по номеру порта.
 */
export async function listenRows(includeAll = false): Promise<PortRow[]> {
  if (process.platform === 'linux') {
    const res = await run('ss', ['-ltnp'], { timeout: 15000 });
    const rows: PortRow[] = [];
    for (const line of res.stdout.split(/\r?\n/).slice(1)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 5) continue;
      const { address, port } = splitAddress(parts[3]);
      const nameMatch = /users:\(\("([^"]+)",pid=(\d+)/.exec(parts[5] ?? '');
      rows.push({
        proto: 'TCP',
        address,
        port,
        pid: nameMatch ? Number(nameMatch[2]) : 0,
        process: nameMatch ? nameMatch[1] : '—',
        state: 'LISTEN',
      });
    }
    return rows.sort((a, b) => a.port - b.port);
  }

  const [netstat, names] = await Promise.all([
    run('netstat', ['-ano'], { timeout: 25000 }),
    processNames(),
  ]);
  const rows: PortRow[] = [];
  const seen = new Set<string>();

  for (const line of netstat.stdout.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 4) continue;
    const proto = cols[0];
    if (proto !== 'TCP' && proto !== 'UDP') continue;

    const isTcp = proto === 'TCP';
    const state = isTcp ? cols[3] : '';
    const pid = Number(isTcp ? cols[4] : cols[3]);
    if (!Number.isFinite(pid)) continue;
    if (!includeAll && (!isTcp || state !== 'LISTENING')) continue;

    const { address, port } = splitAddress(cols[1]);
    const key = `${proto}:${port}:${pid}`;
    if (seen.has(key)) continue;
    seen.add(key);

    rows.push({
      proto,
      address,
      port,
      pid,
      process: names.get(pid) ?? '—',
      state: state || 'UDP',
    });
  }

  return rows.sort((a, b) => a.port - b.port);
}

/** Все строки, относящиеся к конкретному порту. */
export async function whoHolds(port: number, includeAll = true): Promise<PortRow[]> {
  return (await listenRows(includeAll)).filter((r) => r.port === port);
}

export async function processDetails(pid: number): Promise<{ CommandLine?: string; CreationDate?: string } | null> {
  if (process.platform !== 'win32') return null;
  return psJson(
    `Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | Select-Object CommandLine,CreationDate | ConvertTo-Json -Compress`,
    10000,
  );
}

export interface KillResult {
  ok: boolean;
  message: string;
}

/** Прибить процесс, который держит порт. Через общий killTree. */
export async function killPid(pid: number): Promise<KillResult> {
  if (pid === process.pid) return { ok: false, message: 'это процесс самого jd — не трону' };
  return killTree(pid);
}

/** Проверить, отвечает ли порт на loopback. Отказ приходит мгновенно, поэтому это дёшево. */
export function probePort(port: number, timeout = 350, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host });
    let settled = false;
    const done = (result: boolean): void => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeout);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

/** Разобрать "3000,5173" или "3000-3010" в список портов. */
export function parsePortSpec(spec: string): number[] {
  const out = new Set<number>();
  for (const chunk of spec.split(/[,\s]+/).filter(Boolean)) {
    const range = /^(\d+)\s*[-–:]\s*(\d+)$/.exec(chunk);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      const step = from <= to ? 1 : -1;
      for (let p = from; step > 0 ? p <= to : p >= to; p += step) {
        if (p >= 1 && p <= 65535) out.add(p);
      }
      continue;
    }
    const single = Number(chunk);
    if (Number.isFinite(single) && single >= 1 && single <= 65535) out.add(single);
  }
  return [...out].sort((a, b) => a - b);
}

/** Пул с ограничением параллельности — чтобы не завалить систему сокетами. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      out[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return out;
}

export interface ScanHit {
  port: number;
  open: boolean;
  probeAnswered: boolean;
  rows: PortRow[];
  pid: number;
  process: string;
}

/**
 * Просканировать список портов: параллельно пробуем подключиться и сверяемся
 * с таблицей слушателей (она даёт PID и имя процесса).
 */
export async function scanPorts(
  ports: number[],
  onProgress?: (done: number, total: number, port: number, open: boolean) => void,
): Promise<ScanHit[]> {
  let listeners: PortRow[] = [];
  try {
    listeners = await listenRows(false);
  } catch {
    listeners = [];
  }

  const byPort = new Map<number, PortRow[]>();
  for (const row of listeners) {
    if (!byPort.has(row.port)) byPort.set(row.port, []);
    byPort.get(row.port)!.push(row);
  }

  let done = 0;
  return mapLimit(ports, 128, async (port) => {
    const rows = byPort.get(port) ?? [];
    const answers = await probePort(port);
    const open = answers || rows.length > 0;
    done++;
    onProgress?.(done, ports.length, port, open);
    const primary = rows.find((r) => r.process && r.process !== '—') ?? rows[0];
    return {
      port,
      open,
      probeAnswered: answers,
      rows,
      pid: primary?.pid ?? 0,
      process: primary?.process ?? '—',
    };
  });
}

/** Убрать .exe и обрезать длинные имена процессов. */
export function shortProcess(name: string, max = 28): string {
  const clean = name.replace(/\.exe$/i, '');
  return clean.length > max ? clean.slice(0, max - 1) + '…' : clean;
}
