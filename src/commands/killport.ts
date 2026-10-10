// jd killport — освободить порт: спросить номер, найти процесс и прибить его.

import { flagBool, flagStr, parseArgs } from '../core/args.ts';
import { fail, info } from '../core/help.ts';
import { confirm, isInteractive, promptText } from '../core/input.ts';
import { neonSpinner } from '../core/neon.ts';
import { killPid, processDetails, probePort, shortProcess, whoHolds, type PortRow } from '../core/ports.ts';
import { C, bold, fg, paint } from '../core/theme.ts';
import { box, truncate } from '../core/ui.ts';
import type { Command } from '../core/registry.ts';

function uniqueByPid(rows: PortRow[]): PortRow[] {
  const seen = new Set<number>();
  const out: PortRow[] = [];
  for (const row of rows) {
    if (row.pid <= 0 || seen.has(row.pid)) continue;
    seen.add(row.pid);
    out.push(row);
  }
  return out;
}

export default {
  name: 'killport',
  aliases: ['kill', 'freeport', 'freekill'],
  group: 'Система',
  title: 'Kill Port',
  desc: 'Освобождает порт: находит процесс и завершает его',
  usage: 'jd killport [порт] [--yes] [--dry]',
  examples: ['jd killport', 'jd killport 3000', 'jd killport 8080 --yes'],

  async run({ argv }) {
    if (process.platform !== 'win32' && process.platform !== 'linux') {
      fail('Команда рассчитана на Windows и Linux.');
      return;
    }

    const args = parseArgs(
      argv,
      { port: 'string', p: 'string', yes: 'boolean', y: 'boolean', dry: 'boolean', force: 'boolean', f: 'boolean' },
      { p: 'port', y: 'yes', f: 'force' },
    );
    const assumeYes = flagBool(args, 'yes') || flagBool(args, 'force');
    const dry = flagBool(args, 'dry');

    // 1. Номер порта — аргументом или вопросом.
    let raw = (args._[0] ?? flagStr(args, 'port', '')).trim();
    if (!raw && isInteractive()) {
      raw = (await promptText('Какой порт освободить?')).trim();
    }
    if (!raw) {
      fail('Нужен номер порта.', 'Например: jd killport 3000 — или запусти без аргументов и введи номер.');
      return;
    }

    const port = Number(raw.replace(/^:/, ''));
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      fail(`"${raw}" не похоже на номер порта.`, 'Порт — целое число от 1 до 65535.');
      return;
    }

    // 2. Кто держит порт.
    const spin = neonSpinner(`смотрю, кто занял ${port}…`);
    const [rows, answers] = await Promise.all([whoHolds(port), probePort(port, 400)]);
    const holders = uniqueByPid(rows);
    spin.stop();

    if (!holders.length) {
      if (answers) {
        info(`Порт ${port} отвечает, но в таблице соединений его нет — слушает системный или чужой процесс.`);
      } else {
        process.stdout.write(
          '\n  ' +
            paint('✓ ', fg(C.ok)) +
            paint(`порт ${port} свободен`, bold(), fg(C.ok)) +
            paint(' — убивать некого', fg(C.muted)) +
            '\n\n',
        );
      }
      return;
    }

    // 3. Показываем, что именно держит порт.
    const detailLines: string[] = [];
    for (const row of holders) {
      detailLines.push(
        paint(`PID ${row.pid}`, bold(), fg(C.info)) +
          paint('  ' + shortProcess(row.process, 40), fg(C.text)) +
          paint(`  ${row.proto} ${row.address}:${row.port}`, fg(C.faint)),
      );
      const details = await processDetails(row.pid);
      if (details?.CommandLine) {
        detailLines.push(paint('   ' + truncate(details.CommandLine.trim(), 96), fg(C.faint)));
      }
    }
    process.stdout.write('\n' + box(detailLines, { title: paint(`Порт ${port} занят`, bold(), fg(C.warn)) }) + '\n');

    if (dry) {
      process.stdout.write('\n  ' + paint('режим --dry: ничего не убиваю', fg(C.muted)) + '\n\n');
      return;
    }

    // 4. Подтверждение и завершение.
    if (!assumeYes) {
      if (!isInteractive()) {
        fail('Нужно подтверждение, а терминал неинтерактивный.', 'Добавь --yes, чтобы убить без вопросов.');
        return;
      }
      const label = holders.map((h) => `${shortProcess(h.process)} (PID ${h.pid})`).join(', ');
      const go = await confirm(`Завершить ${label}?`, true);
      if (!go) {
        process.stdout.write(paint('  отменено\n\n', fg(C.muted)));
        return;
      }
    }

    process.stdout.write('\n');
    const killed: number[] = [];
    for (const holder of holders) {
      const killSpin = neonSpinner(`завершаю ${shortProcess(holder.process)} (PID ${holder.pid})…`);
      const res = await killPid(holder.pid);
      if (res.ok) {
        killSpin.succeed(`остановлен ${shortProcess(holder.process)} (PID ${holder.pid})`);
        killed.push(holder.pid);
      } else {
        killSpin.fail(`${shortProcess(holder.process)} (PID ${holder.pid}) — ${res.message}`);
      }
    }

    // 5. Проверяем результат, а не верим на слово.
    const verify = neonSpinner(`проверяю порт ${port}…`);
    const stillRows = uniqueByPid(await whoHolds(port));
    const stillAnswers = stillRows.length > 0 ? true : await probePort(port, 400);
    verify.stop();

    process.stdout.write('\n');
    if (!stillRows.length && !stillAnswers) {
      process.stdout.write(
        '  ' +
          paint('✓ ', fg(C.ok)) +
          paint(`порт ${port} свободен`, bold(), fg(C.ok)) +
          (killed.length ? paint(`   (остановлено процессов: ${killed.length})`, fg(C.muted)) : '') +
          '\n\n',
      );
      return;
    }

    const names = stillRows.map((r) => `${shortProcess(r.process)} (PID ${r.pid})`).join(', ');
    fail(
      `Порт ${port} всё ещё занят.`,
      names ? `Остался: ${names}. Возможно, нужен терминал от администратора.` : 'Порт отвечает, но владельца не видно — вероятно, системный процесс.',
    );
    process.stdout.write('\n');
  },
} satisfies Command;
