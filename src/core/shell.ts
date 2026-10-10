// Запуск внешних процессов, PowerShell и буфер обмена.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';

export interface RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
  ms: number;
}

export interface RunOptions {
  cwd?: string;
  timeout?: number;
  input?: string;
}

export function run(cmd: string, args: string[] = [], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = execFile(
      cmd,
      args,
      {
        cwd: opts.cwd,
        timeout: opts.timeout ?? 20000,
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
        encoding: 'utf8',
      },
      (err, stdout, stderr) => {
        const code = err && typeof (err as { code?: unknown }).code === 'number'
          ? ((err as { code: number }).code)
          : err
            ? 1
            : 0;
        resolve({
          ok: !err,
          stdout: stdout ?? '',
          stderr: stderr ?? '',
          code,
          ms: Date.now() - started,
        });
      },
    );
    if (opts.input !== undefined && child.stdin) {
      child.stdin.end(opts.input);
    }
  });
}

/**
 * Запустить команду как в терминале: npm, pnpm, yarn и bun на Windows — это
 * .cmd-обёртки, которые execFile не умеет запускать напрямую. Передаём строку
 * оболочке сами: опция shell у execFile в Node 24 помечена устаревшей при
 * передаче массива аргументов.
 */
export function runLine(commandLine: string, opts: RunOptions = {}): Promise<RunResult> {
  if (process.platform === 'win32') {
    return run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', commandLine], opts);
  }
  return run('/bin/sh', ['-c', commandLine], opts);
}

let psExe: string | null = null;

/** PowerShell 7, если есть, иначе встроенный powershell.exe. */
export function powershellExe(): string {
  if (psExe) return psExe;
  const candidates = [
    'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    'C:\\Program Files\\PowerShell\\7-preview\\pwsh.exe',
  ];
  psExe = candidates.find((p) => existsSync(p)) ?? 'powershell.exe';
  return psExe;
}

const PS_PREFIX = '$ProgressPreference="SilentlyContinue"; [Console]::OutputEncoding=[Text.Encoding]::UTF8; ';

export async function ps(script: string, timeout = 20000): Promise<string> {
  const res = await run(
    powershellExe(),
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PS_PREFIX + script],
    { timeout },
  );
  return res.stdout;
}

/** Выполнить PowerShell и распарсить JSON. Возвращает null, если не вышло. */
export async function psJson<T>(script: string, timeout = 20000): Promise<T | null> {
  const out = (await ps(script, timeout)).replace(/^\uFEFF/, '').trim();
  if (!out || out === 'null') return null;
  try {
    return JSON.parse(out) as T;
  } catch {
    return null;
  }
}

export async function which(cmd: string): Promise<boolean> {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  const res = await run(finder, [cmd], { timeout: 4000 });
  return res.ok && res.stdout.trim().length > 0;
}

/** Положить текст в системный буфер обмена. */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (process.platform === 'win32') {
    const direct = await run('clip', [], { input: text, timeout: 8000 });
    if (direct.ok) return true;
    const viaPs = await ps('Set-Clipboard -Value $input', 8000);
    return viaPs !== null;
  }
  if (process.platform === 'darwin') {
    return (await run('pbcopy', [], { input: text })).ok;
  }
  for (const cmd of ['wl-copy', 'xclip', 'xsel']) {
    const args = cmd === 'xclip' ? ['-selection', 'clipboard'] : cmd === 'xsel' ? ['--clipboard', '--input'] : [];
    if (await which(cmd)) return (await run(cmd, args, { input: text })).ok;
  }
  return false;
}

/** Открыть файл/ссылку в системе по умолчанию. */
export async function openExternal(target: string): Promise<boolean> {
  if (process.platform === 'win32') return (await run('cmd', ['/c', 'start', '', target])).ok;
  if (process.platform === 'darwin') return (await run('open', [target])).ok;
  return (await run('xdg-open', [target])).ok;
}

export interface KillOutcome {
  ok: boolean;
  message: string;
}

/**
 * Завершить процесс вместе с дочерними. На Windows это taskkill /T /F,
 * иначе — kill -9. Используется и для портов, и для остановки команд проектов.
 */
export async function killTree(pid: number): Promise<KillOutcome> {
  if (!Number.isFinite(pid) || pid <= 0) return { ok: false, message: 'некорректный PID' };
  const killer = process.platform === 'win32' ? 'taskkill' : 'kill';
  const killArgs = process.platform === 'win32' ? ['/PID', String(pid), '/T', '/F'] : ['-9', String(pid)];
  const res = await run(killer, killArgs, { timeout: 15000 });
  if (res.ok) return { ok: true, message: 'остановлен' };

  const reason = (res.stderr || res.stdout).trim().split(/\r?\n/)[0] ?? `код ${res.code}`;
  if (/Access is denied|Отказано в доступе/i.test(reason)) {
    return { ok: false, message: 'нет прав — попробуй терминал от администратора' };
  }
  if (/not found|не найден|No such process/i.test(reason)) return { ok: false, message: 'процесс уже завершился' };
  return { ok: false, message: reason };
}

/** Открыть файл в редакторе: $EDITOR/$VISUAL, иначе системный по умолчанию. */
export async function openInEditor(file: string): Promise<boolean> {
  const editor = process.env.EDITOR ?? process.env.VISUAL ?? '';
  if (process.platform === 'win32') {
    const res = editor
      ? await run('cmd', ['/c', 'start', '/wait', editor, file], { timeout: 1000 * 60 * 30 })
      : await run('cmd', ['/c', 'start', '', file], { timeout: 1000 * 60 * 30 });
    return res.ok;
  }
  return (await run(editor || 'nano', [file], { timeout: 1000 * 60 * 30 })).ok;
}
