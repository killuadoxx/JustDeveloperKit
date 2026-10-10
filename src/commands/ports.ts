// jd ports — кто занял порт, что за процесс и как его прибить.

import { flagBool, parseArgs } from '../core/args.ts';
import { fail, info } from '../core/help.ts';
import { confirm } from '../core/input.ts';
import { killPid, listenRows, processDetails, shortProcess, type PortRow } from '../core/ports.ts';
import { C, bold, fg, paint } from '../core/theme.ts';
import { box, table } from '../core/ui.ts';
import type { Command } from '../core/registry.ts';

function renderTable(rows: PortRow[], includeAll: boolean): string {
  if (!rows.length) return paint('  ничего не слушает', fg(C.muted));
  return table(
    ['ПОРТ', 'ПРОЦЕСС', 'PID', includeAll ? 'ТИП' : 'АДРЕС'],
    rows.map((r) => [
      paint(String(r.port), bold(), fg(C.info)),
      paint(shortProcess(r.process), fg(C.text)),
      paint(String(r.pid), fg(C.muted)),
      paint(includeAll ? `${r.proto} ${r.state}` : r.address, fg(C.faint)),
    ]),
    { align: ['right', 'left', 'right', 'left'] },
  );
}

export default {
  name: 'ports',
  aliases: ['port', 'net'],
  group: 'Система',
  title: 'Кто занял порт',
  desc: 'Слушающие порты, процессы и освобождение порта',
  usage: 'jd ports [порт] [kill <порт>] [--all]',
  examples: ['jd ports', 'jd ports 3000', 'jd ports kill 3000', 'jd ports --all'],

  async run({ argv }) {
    if (process.platform !== 'win32' && process.platform !== 'linux') {
      fail('Команда рассчитана на Windows и Linux.');
      return;
    }

    const args = parseArgs(argv, { all: 'boolean', a: 'boolean', force: 'boolean', f: 'boolean' }, { a: 'all', f: 'force' });
    const includeAll = flagBool(args, 'all');
    const sub = args._[0];
    const target = sub === 'kill' ? args._[1] : sub;
    const sparse = Number(target);

    if (sub === 'kill') {
      if (!Number.isFinite(sparse) || sparse <= 0) {
        fail('Укажи порт: jd ports kill 3000');
        return;
      }
      const rows = (await listenRows(true)).filter((r) => r.port === sparse);
      if (!rows.length) {
        fail(`Порт ${sparse} никто не слушает.`);
        return;
      }
      const force = flagBool(args, 'force');
      for (const row of rows) {
        const label = `${shortProcess(row.process)} (PID ${row.pid})`;
        const agreed = force || (await confirm(`Убить ${label} на порту ${row.port}?`, false));
        if (!agreed) {
          info('Отменено.');
          continue;
        }
        const res = await killPid(row.pid);
        if (res.ok) info(`Остановлен ${label}`);
        else fail(`Не удалось остановить ${label}`, res.message);
      }
      return;
    }

    const rows = await listenRows(includeAll);

    if (target !== undefined) {
      if (!Number.isFinite(sparse)) {
        fail(`"${target}" не похоже на номер порта.`);
        return;
      }
      const matched = rows.filter((r) => r.port === sparse);
      if (!matched.length) {
        fail(`Порт ${sparse} свободен.`);
        return;
      }
      const lines: string[] = [];
      for (const row of matched) {
        lines.push(paint(`${row.proto} ${row.address}:${row.port}`, bold(), fg(C.info)));
        lines.push(paint('  процесс  ', fg(C.muted)) + paint(shortProcess(row.process, 80), fg(C.text)));
        lines.push(paint('  PID      ', fg(C.muted)) + paint(String(row.pid), fg(C.text)));
        lines.push(paint('  состояние', fg(C.muted)) + ' ' + paint(row.state, fg(C.soft)));
        const details = await processDetails(row.pid);
        if (details?.CommandLine) {
          lines.push(paint('  команда  ', fg(C.muted)) + paint(details.CommandLine.trim(), fg(C.faint)));
        }
        lines.push('');
      }
      lines.push(paint(`  чтобы освободить: jd ports kill ${sparse}`, fg(C.faint)));
      process.stdout.write(box(lines, { title: paint(`Порт ${sparse}`, bold(), fg(C.primary)) }) + '\n');
      return;
    }

    process.stdout.write('\n' + renderTable(rows, includeAll) + '\n');
    process.stdout.write(
      '\n  ' +
        paint(`всего ${rows.length}`, fg(C.muted)) +
        paint('  ·  ', fg(C.faint)) +
        paint('jd ports <порт>', fg(C.info)) +
        paint(' — детали, ', fg(C.muted)) +
        paint('jd ports kill <порт>', fg(C.info)) +
        paint(' — освободить', fg(C.muted)) +
        '\n\n',
    );
  },
} satisfies Command;
