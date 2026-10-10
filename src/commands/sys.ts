// jd sys — живой дашборд системы: CPU, память, диски, сеть, топ процессов.

import os from 'node:os';
import readline from 'node:readline';
import { parseArgs, flagBool, flagNum } from '../core/args.ts';
import { fail } from '../core/help.ts';
import { isInteractive } from '../core/input.ts';
import { psJson } from '../core/shell.ts';
import { C, bold, fg, paint, statusColor } from '../core/theme.ts';
import { Frame, bar, box, hideCursor, padEnd, showCursor, sparkline, table } from '../core/ui.ts';
import { clamp, formatBytes, formatDuration, sleep } from '../core/util.ts';
import type { Command } from '../core/registry.ts';

interface Disk {
  DeviceID: string;
  Size: number;
  FreeSpace: number;
  VolumeName?: string;
}

interface Proc {
  Name: string;
  Id: number;
  WS: number;
  CPU: number;
}

interface CpuTimes {
  total: number;
  idle: number;
}

function cpuTimes(): CpuTimes[] {
  return os.cpus().map((c) => {
    const t = c.times;
    const total = t.user + t.nice + t.sys + t.idle + t.irq;
    return { total, idle: t.idle };
  });
}

function cpuUsage(prev: CpuTimes[], curr: CpuTimes[]): number[] {
  return curr.map((c, i) => {
    const p = prev[i] ?? c;
    const dt = c.total - p.total;
    const di = c.idle - p.idle;
    if (dt <= 0) return 0;
    return clamp(((dt - di) / dt) * 100, 0, 100);
  });
}

function asArray<T>(value: T[] | T | null): T[] {
  if (value === null) return [];
  return Array.isArray(value) ? value : [value];
}

async function loadDisks(): Promise<Disk[]> {
  const raw = await psJson<Disk[] | Disk>(
    'Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | Select-Object DeviceID,Size,FreeSpace,VolumeName | ConvertTo-Json -Compress',
  );
  return asArray(raw).filter((d) => d && d.Size > 0);
}

async function loadProcs(limit: number): Promise<Proc[]> {
  const raw = await psJson<Proc[] | Proc>(
    `Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First ${limit} Name,Id,@{n='WS';e={$_.WorkingSet64}},CPU | ConvertTo-Json -Compress`,
  );
  return asArray(raw).filter(Boolean);
}

async function loadBattery(): Promise<{ pct: number; charging: boolean } | null> {
  const raw = await psJson<{ EstimatedChargeRemaining: number; BatteryStatus: number }[]>(
    'Get-CimInstance Win32_Battery | Select-Object -First 1 EstimatedChargeRemaining,BatteryStatus | ConvertTo-Json -Compress',
  );
  const first = asArray(raw)[0];
  if (!first || typeof first.EstimatedChargeRemaining !== 'number') return null;
  return { pct: first.EstimatedChargeRemaining, charging: first.BatteryStatus === 2 };
}

function cpuLine(usage: number[]): string {
  const overall = usage.length ? usage.reduce((a, b) => a + b, 0) / usage.length : 0;
  const color = statusColor(overall);
  const pct = paint(`${overall.toFixed(0)}%`.padStart(4), bold(), fg(color));
  return `${padEnd('CPU', 8)}${pct}  ${bar(overall, 100, 28, color)}  ${paint(`${usage.length} ядер`, fg(C.muted))}`;
}

function memLine(): string {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  const pct = (used / total) * 100;
  const color = statusColor(pct);
  return `${padEnd('Память', 8)}${paint(`${pct.toFixed(0)}%`.padStart(4), bold(), fg(color))}  ${bar(pct, 100, 28, color)}  ${paint(`${formatBytes(used)} / ${formatBytes(total)}`, fg(C.muted))}`;
}

function headerLines(usage: number[], battery: { pct: number; charging: boolean } | null): string[] {
  const lines: string[] = [];
  lines.push(
    padEnd(paint('Хост', fg(C.muted)), 16) +
      paint(`${os.hostname()}`, fg(C.text)) +
      paint(`  ·  ${os.platform()} ${os.release()}`, fg(C.muted)),
  );
  lines.push(
    padEnd(paint('Аптайм', fg(C.muted)), 16) +
      paint(formatDuration(os.uptime() * 1000), fg(C.text)) +
      (battery
        ? paint(`   ·   батарея `, fg(C.muted)) +
          paint(`${battery.pct}%${battery.charging ? ' ⚡' : ''}`, fg(battery.pct < 25 && !battery.charging ? C.err : C.ok))
        : ''),
  );
  lines.push('');
  lines.push(cpuLine(usage));
  lines.push(memLine());
  if (usage.length > 1) {
    lines.push(`${padEnd('', 8)}${paint('по ядрам  ', fg(C.muted))}${sparkline(usage, C.accent)}  ${paint(usage.map((u) => u.toFixed(0)).join(' '), fg(C.faint))}`);
  }
  return lines;
}

function diskLines(disks: Disk[]): string {
  if (!disks.length) return paint('нет данных', fg(C.muted));
  return table(
    ['Том', 'Занято', 'Свободно', 'Всего', ''],
    disks.map((d) => {
      const used = d.Size - d.FreeSpace;
      const pct = (used / d.Size) * 100;
      return [
        paint((d.VolumeName ? `${d.DeviceID} ${d.VolumeName}` : d.DeviceID) ?? '', fg(C.text)),
        paint(formatBytes(used), fg(C.soft)),
        paint(formatBytes(d.FreeSpace), fg(pct > 90 ? C.err : pct > 75 ? C.warn : C.ok)),
        paint(formatBytes(d.Size), fg(C.muted)),
        bar(pct, 100, 18, statusColor(pct)),
      ];
    }),
    { align: ['left', 'right', 'right', 'right', 'left'], showHeader: true },
  );
}

function procLines(procs: Proc[]): string {
  if (!procs.length) return paint('нет данных', fg(C.muted));
  return table(
    ['PID', 'Процесс', 'Память', 'CPU, с'],
    procs.map((p) => [
      paint(String(p.Id), fg(C.muted)),
      paint((p.Name ?? '').replace(/\.exe$/i, ''), fg(C.text)),
      paint(formatBytes(p.WS ?? 0), fg(C.soft)),
      paint((p.CPU ?? 0).toFixed(1), fg(C.faint)),
    ]),
    { align: ['right', 'left', 'right', 'right'] },
  );
}

function netLines(): string {
  const rows: string[][] = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.internal || addr.family !== 'IPv4') continue;
      rows.push([paint(name, fg(C.text)), paint(addr.address, fg(C.info)), paint(addr.mac, fg(C.faint))]);
    }
  }
  if (!rows.length) return paint('нет активных интерфейсов', fg(C.muted));
  return table(['Интерфейс', 'IPv4', 'MAC'], rows);
}

async function collect(prev: CpuTimes[], procLimit: number) {
  const curr = cpuTimes();
  const usage = cpuUsage(prev, curr);
  const [disks, procs, battery] = await Promise.all([loadDisks(), loadProcs(procLimit), loadBattery()]);
  return { curr, usage, disks, procs, battery };
}

function render(usage: number[], disks: Disk[], procs: Proc[], battery: { pct: number; charging: boolean } | null): string[] {
  const lines: string[] = [];
  lines.push(...box(headerLines(usage, battery), { title: paint('Система', bold(), fg(C.primary)), color: C.faint }).split('\n'));
  lines.push('');
  lines.push(...box(diskLines(disks).split('\n'), { title: paint('Диски', bold(), fg(C.primary)), color: C.faint }).split('\n'));
  lines.push('');
  lines.push(...box(procLines(procs).split('\n'), { title: paint('Топ процессов', bold(), fg(C.primary)), color: C.faint }).split('\n'));
  lines.push('');
  lines.push(...box(netLines().split('\n'), { title: paint('Сеть', bold(), fg(C.primary)), color: C.faint }).split('\n'));
  return lines;
}

export default {
  name: 'sys',
  aliases: ['status', 'top'],
  group: 'Система',
  title: 'Дашборд системы',
  desc: 'CPU, память, диски, сеть и топ процессов',
  usage: 'jd sys [--watch] [--interval=2] [--procs=8]',
  examples: ['jd sys', 'jd sys --watch', 'jd sys -w --interval=5'],

  async run({ argv }) {
    const args = parseArgs(argv, { watch: 'boolean', w: 'boolean', interval: 'number', procs: 'number', once: 'boolean' }, { w: 'watch' });
    const watch = flagBool(args, 'watch');
    const interval = Math.max(1, flagNum(args, 'interval', 2));
    const procLimit = clamp(flagNum(args, 'procs', 8), 1, 30);

    if (watch && !isInteractive()) {
      fail('Режим --watch требует интерактивного терминала.');
      return;
    }

    if (!watch) {
      const first = cpuTimes();
      await sleep(350);
      const { usage, disks, procs, battery } = await collect(first, procLimit);
      process.stdout.write(render(usage, disks, procs, battery).join('\n') + '\n');
      return;
    }

    // Живой режим: тяжёлые данные (диски, процессы) обновляем реже, чем CPU.
    const stdin = process.stdin;
    readline.emitKeypressEvents(stdin);
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    hideCursor();
    const frame = new Frame();

    let stopped = false;
    const onKey = (_s: string, key: readline.Key): void => {
      if (!key) return;
      if (key.name === 'q' || key.name === 'escape' || (key.ctrl && key.name === 'c')) stopped = true;
    };
    stdin.on('keypress', onKey);

    const cleanup = (): void => {
      stdin.removeListener('keypress', onKey);
      stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
      showCursor();
      frame.done();
    };

    let prev = cpuTimes();
    let disks: Disk[] = [];
    let procs: Proc[] = [];
    let battery: { pct: number; charging: boolean } | null = null;
    let tick = 0;

    try {
      while (!stopped) {
        await sleep(interval * 1000);
        if (stopped) break;
        const usage = cpuUsage(prev, cpuTimes());
        prev = cpuTimes();

        if (tick % 2 === 0) {
          [disks, procs, battery] = await Promise.all([loadDisks(), loadProcs(procLimit), loadBattery()]);
        }
        tick++;

        const lines = render(usage, disks, procs, battery);
        lines.push('');
        lines.push(paint('  q — выход · обновление каждые ' + interval + ' с', fg(C.faint)));
        frame.draw(lines);
      }
    } finally {
      cleanup();
    }
  },
} satisfies Command;
