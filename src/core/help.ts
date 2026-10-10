// Справка и подсказки.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { neonBanner } from './neon.ts';
import { loadProjectSync, projectGroupLabel } from './project.ts';
import { C, bold, fg, gradient, paint } from './theme.ts';
import { truncate, width } from './ui.ts';
import { findCommand, groupsOf, type Command } from './registry.ts';
import { fuzzyMatch, stripBom } from './util.ts';

/** Версия берётся из package.json — одна точка правды, не нужно синхронизировать. */
export const VERSION: string = (() => {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const raw = readFileSync(path.join(here, '..', '..', 'package.json'), 'utf8');
    const pkg = JSON.parse(stripBom(raw)) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

export function header(): string {
  return (
    gradient('jd', C.primary, C.accent) +
    paint(' · Just Developer Kit', fg(C.muted)) +
    paint(`   v${VERSION}`, fg(C.faint))
  );
}

function termWidth(): number {
  return Math.max(60, Math.min(process.stdout.columns ?? 100, 120));
}

export function printHelp(commands: Command[], topic?: string): void {
  if (topic) return printCommandHelp(commands, topic);

  const out: string[] = [];
  out.push('');
  out.push(neonBanner({ subtitle: 'Just Developer Kit', version: VERSION }));
  out.push('');
  out.push(paint('  Личный CLI: всё локально, запуск без сборки, из зависимостей только chalk.', fg(C.muted)));
  out.push('');
  out.push('  ' + paint('jd', bold(), fg(C.text)) + '                     ' + paint('меню со стрелками и поиском', fg(C.soft)));
  out.push('  ' + paint('jd <команда> [флаги]', bold(), fg(C.text)) + '    ' + paint('выполнить команду', fg(C.soft)));
  out.push('  ' + paint('jd help <команда>', bold(), fg(C.text)) + '       ' + paint('подробнее о команде', fg(C.soft)));

  const maxWidth = termWidth();

  // Локальный контекст проекта — наверх, он важнее глобальных команд.
  const local = loadProjectSync();
  if (local.status === 'ok' && local.project.config.commands.length) {
    out.push('');
    out.push('  ' + paint(projectGroupLabel(local.project.config), bold(), fg(C.accent)));
    for (const entry of local.project.config.commands) {
      const gap = Math.max(2, 26 - width(entry.name));
      out.push(truncate('   ' + paint(entry.name, fg(C.primary)) + ' '.repeat(gap) + paint(entry.cmd, fg(C.cyan)), maxWidth));
    }
    out.push('  ' + paint('   запуск: ', fg(C.faint)) + paint('jd run <имя>', fg(C.info)) + paint(`   ${local.project.file}`, fg(C.faint)));
  } else if (local.status === 'broken') {
    out.push('');
    out.push('  ' + paint(`⚠ ${local.file} не разобрался: ${local.error}`, fg(C.warn)));
  }

  for (const group of groupsOf(commands)) {
    out.push('');
    out.push('  ' + paint(group.toUpperCase(), bold(), fg(C.accent)));
    for (const cmd of commands.filter((c) => !c.hidden && c.group === group)) {
      const names = [cmd.name, ...(cmd.aliases ?? []).slice(0, 2)].join(', ');
      // Отступ минимум в 2 пробела: длинные списки имён не должны слипаться с описанием.
      const gap = Math.max(2, 22 - width(names));
      const left = '   ' + paint(names, fg(C.primary)) + ' '.repeat(gap);
      const right = paint(cmd.title, fg(C.text));
      const tail = cmd.desc ? paint(' — ' + cmd.desc, fg(C.muted)) : '';
      out.push(truncate(left + right + tail, maxWidth));
    }
  }

  out.push('');
  out.push('  ' + paint('Совет: ', fg(C.faint)) + paint('набери ', fg(C.muted)) + paint('jd', fg(C.info)) + paint(' и просто начни печатать — меню само отфильтрует.', fg(C.muted)));
  out.push('');
  process.stdout.write(out.join('\n') + '\n');
}

export function printCommandHelp(commands: Command[], name: string): void {
  const cmd = findCommand(commands, name);
  if (!cmd) {
    process.stderr.write(paint(`Команда "${name}" не найдена.`, fg(C.err)) + '\n');
    const guesses = suggest(commands, name);
    if (guesses.length) {
      process.stderr.write(paint('Может быть: ', fg(C.muted)) + guesses.map((g) => paint(g, fg(C.info))).join(', ') + '\n');
    }
    process.exitCode = 1;
    return;
  }

  const out: string[] = [];
  out.push('');
  out.push('  ' + paint(`jd ${cmd.name}`, bold(), fg(C.primary)) + paint(' — ' + cmd.title, fg(C.text)));
  out.push('');
  out.push('  ' + paint(cmd.desc, fg(C.muted)));
  if (cmd.aliases?.length) {
    out.push('  ' + paint('псевдонимы: ', fg(C.faint)) + paint(cmd.aliases.join(', '), fg(C.info)));
  }
  out.push('');
  out.push('  ' + paint('ИСПОЛЬЗОВАНИЕ', bold(), fg(C.accent)));
  out.push('    ' + paint(cmd.usage ?? `jd ${cmd.name}`, fg(C.soft)));
  if (cmd.examples?.length) {
    out.push('');
    out.push('  ' + paint('ПРИМЕРЫ', bold(), fg(C.accent)));
    for (const ex of cmd.examples) out.push('    ' + paint(ex, fg(C.cyan)));
  }
  out.push('');
  process.stdout.write(out.join('\n') + '\n');
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

/**
 * Подсказки к опечаткам. Нечёткий поиск не ловит лишние буквы ("snipz"),
 * поэтому добавляем расстояние редактирования.
 */
export function suggest(commands: Command[], input: string): string[] {
  const target = input.toLowerCase().trim();
  if (!target) return [];

  return commands
    .map((cmd) => {
      const names = [cmd.name, ...(cmd.aliases ?? [])];
      let best = Number.NEGATIVE_INFINITY;
      for (const name of names) {
        const lowered = name.toLowerCase();
        const match = fuzzyMatch(target, lowered);
        if (match) best = Math.max(best, match.score);
        const distance = levenshtein(target, lowered);
        const threshold = lowered.length <= 3 ? 1 : 2;
        if (distance <= threshold && (distance <= 1 || lowered[0] === target[0])) {
          best = Math.max(best, 100 - distance * 20);
        }
        if (lowered.startsWith(target) || target.startsWith(lowered)) best = Math.max(best, 60);
        if (cmd.name === input) best = Math.max(best, 200);
      }
      return { name: cmd.name, score: best };
    })
    .filter((x) => Number.isFinite(x.score))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((x) => x.name);
}

export function fail(message: string, hint?: string): void {
  process.stderr.write('\n  ' + paint('✖ ', fg(C.err)) + paint(message, fg(C.text)) + '\n');
  if (hint) process.stderr.write('    ' + paint(hint, fg(C.muted)) + '\n');
  process.exitCode = 1;
}

export function ok(message: string): void {
  process.stdout.write('  ' + paint('✔ ', fg(C.ok)) + paint(message, fg(C.text)) + '\n');
}

export function info(message: string): void {
  process.stdout.write('  ' + paint('· ', fg(C.info)) + paint(message, fg(C.soft)) + '\n');
}
