// Состояние проекта для шапки меню: одна короткая строка вместо трёх проверок руками.
//
// Всё считается быстро и молча: если что-то не удалось — просто не показываем это.

import { run } from './shell.ts';
import { envDiff } from './env.ts';
import { scanPorts } from './ports.ts';
import { C, fg, paint } from './theme.ts';

export interface MenuStatus {
  /** Строка для правого угла шапки. */
  right: string;
  /** Короткая сводка для панели деталей. */
  summary: string[];
  /** Есть на что посмотреть. */
  attention: boolean;
}

export interface StatusInput {
  dir: string;
  /** Порты проекта из .me.json. */
  ports: number[];
}

async function gitState(dir: string): Promise<{ changed: number; unpushed: number } | null> {
  const inside = await run('git', ['rev-parse', '--is-inside-work-tree'], { cwd: dir, timeout: 4000 });
  if (!inside.ok) return null;

  const [status, ahead] = await Promise.all([
    run('git', ['status', '--porcelain'], { cwd: dir, timeout: 6000 }),
    run('git', ['rev-list', '--count', '@{u}..HEAD'], { cwd: dir, timeout: 5000 }),
  ]);

  return {
    changed: status.ok ? status.stdout.split(/\r?\n/).filter((l) => l.trim()).length : 0,
    unpushed: ahead.ok ? Number(ahead.stdout.trim()) || 0 : 0,
  };
}

/** Собрать состояние: git, порты проекта, переменные окружения. */
export async function menuStatus(input: StatusInput): Promise<MenuStatus> {
  const [git, busy] = await Promise.all([
    gitState(input.dir),
    input.ports.length ? scanPorts(input.ports).then((hits) => hits.filter((h) => h.open)) : Promise.resolve([]),
  ]);

  const diff = envDiff(input.dir);
  const missingEnv = diff.hasExample && diff.env.length ? diff.missing : [];

  const bits: string[] = [];
  const summary: string[] = [];
  let attention = false;

  if (git) {
    if (git.changed) {
      bits.push(`${git.changed} изм.`);
      summary.push(`${git.changed} файл(ов) с изменениями`);
      attention = true;
    }
    if (git.unpushed) {
      bits.push(`↑${git.unpushed}`);
      summary.push(`не запушено коммитов: ${git.unpushed}`);
      attention = true;
    }
    if (!git.changed && !git.unpushed) summary.push('git: дерево чистое');
  } else {
    summary.push('git: папка не под контролем версий');
  }

  if (busy.length) {
    bits.push(busy.map((h) => `:${h.port}`).join(' '));
    summary.push(`занятые порты проекта: ${busy.map((h) => h.port).join(', ')}`);
    attention = true;
  } else if (input.ports.length) {
    summary.push(`порты проекта свободны (${input.ports.join(', ')})`);
  }

  if (missingEnv.length) {
    bits.push(`нет ${missingEnv.length} перем.`);
    summary.push(`в .env не хватает: ${missingEnv.slice(0, 4).join(', ')}`);
    attention = true;
  }

  const right = bits.length ? bits.join(' · ') : 'всё спокойно';
  return { right, summary, attention };
}

/** Подсветить статус в панели деталей. */
export function statusLine(status: MenuStatus): string {
  if (!status.summary.length) return '';
  const dot = status.attention ? paint('• ', fg(C.warn)) : paint('• ', fg(C.ok));
  return status.summary.map((line) => dot + paint(line, fg(C.muted))).join('\n');
}
