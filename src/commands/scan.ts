// jd scan — быстро прощупать дев-порты и одним движением освободить занятый.
//
// По умолчанию проверяется список популярных портов (быстро и читаемо),
// полный диапазон — через --range=3000-9000.

import { flagBool, flagList, flagStr, parseArgs } from '../core/args.ts';
import { fail } from '../core/help.ts';
import { confirm, isInteractive, selectList } from '../core/input.ts';
import { ch, N, neonSpinner } from '../core/neon.ts';
import { killPid, parsePortSpec, POPULAR_PORTS, probePort, scanPorts, shortProcess, type ScanHit } from '../core/ports.ts';
import { loadProject, ME_FILE } from '../core/project.ts';
import { C, bold, fg, paint } from '../core/theme.ts';
import { table } from '../core/ui.ts';
import type { Command } from '../core/registry.ts';

const GREEN = C.ok;
const RED = C.err;

function statusCell(hit: ScanHit): string {
  if (!hit.open) return paint('● свободен', fg(GREEN));
  const label = hit.rows.length ? 'занят' : 'отвечает';
  return paint('● ' + label, fg(RED));
}

function renderTable(hits: ScanHit[]): string {
  if (!hits.length) return paint('  нечего показывать', fg(C.muted));
  return table(
    ['ПОРТ', 'СТАТУС', 'PID', 'ПРОЦЕСС', 'АДРЕС'],
    hits.map((hit) => [
      paint(':' + hit.port, bold(), fg(hit.open ? RED : GREEN)),
      statusCell(hit),
      paint(hit.pid ? String(hit.pid) : '—', fg(hit.pid ? C.text : C.faint)),
      paint(hit.rows.length ? shortProcess(hit.process, 30) : '—', fg(hit.rows.length ? C.text : C.faint)),
      paint(hit.rows[0] ? `${hit.rows[0].proto} ${hit.rows[0].address}` : '—', fg(C.faint)),
    ]),
    { align: ['right', 'left', 'right', 'left', 'left'] },
  );
}

/** Компактная сетка для больших диапазонов: 3000✓ 3001✗ … */
function renderGrid(hits: ScanHit[], perRow: number): string {
  const cellWidth = Math.max(...hits.map((h) => 6 + String(h.port).length));
  const lines: string[] = [];
  for (let i = 0; i < hits.length; i += perRow) {
    const slice = hits.slice(i, i + perRow);
    lines.push(
      '  ' +
        slice
          .map((hit) => {
            const label = ':' + hit.port;
            const pad = ' '.repeat(Math.max(0, cellWidth - label.length - 2));
            const mark = hit.open ? paint('✗', bold(), fg(RED)) : paint('✓', fg(GREEN));
            return paint(label, fg(hit.open ? RED : GREEN)) + ' ' + mark + pad;
          })
          .join(''),
    );
  }
  return lines.join('\n');
}

export default {
  name: 'scan',
  aliases: ['portscan', 'scanports', 'ports-scan'],
  group: 'Сеть',
  title: 'Scan Local Ports',
  desc: 'Прощупывает дев-порты, показывает занятые и предлагает освободить',
  usage: 'jd scan [--project] [--ports=3000,5173] [--range=3000-9000] [--all] [--yes]',
  examples: [
    'jd scan',
    'jd scan --project',
    'jd scan --range=3000-9000',
    'jd scan --ports=3000,5000,8080',
    'jd scan --all',
  ],

  async run({ argv, cwd }) {
    if (process.platform !== 'win32' && process.platform !== 'linux') {
      fail('Команда рассчитана на Windows и Linux.');
      return;
    }

    const args = parseArgs(
      argv,
      { ports: 'array', p: 'array', range: 'string', r: 'string', all: 'boolean', a: 'boolean', busy: 'boolean', b: 'boolean', yes: 'boolean', y: 'boolean', project: 'boolean' },
      { p: 'ports', r: 'range', a: 'all', b: 'busy', y: 'yes' },
    );

    // Что сканируем: порты проекта, список, диапазон или набор по умолчанию.
    const rangeSpec = flagStr(args, 'range', '');
    const portsSpec = [...flagList(args, 'ports'), ...args._].filter(Boolean).join(',');

    let ports: number[];
    let scopeLabel: string;

    if (flagBool(args, 'project')) {
      const loaded = await loadProject(cwd);
      if (loaded.status === 'missing') {
        fail(`В этой папке нет ${ME_FILE}.`, 'Создать: jd init — затем впиши в него порты проекта полем "ports"');
        return;
      }
      if (loaded.status === 'broken') {
        fail(`${ME_FILE} не разобрался: ${loaded.error}`, `Проверь ${loaded.file}`);
        return;
      }
      const projectPorts = loaded.project.config.ports ?? [];
      if (!projectPorts.length) {
        fail(
          `В ${ME_FILE} не указаны порты проекта.`,
          'Добавь поле "ports": [3000, 5173] — и эта команда будет проверять именно их',
        );
        return;
      }
      ports = projectPorts;
      scopeLabel = `порты проекта ${loaded.project.config.projectName}`;
    } else if (rangeSpec) {
      ports = parsePortSpec(rangeSpec);
      scopeLabel = `диапазон ${rangeSpec}`;
    } else if (portsSpec) {
      ports = parsePortSpec(portsSpec);
      scopeLabel = 'заданный список';
    } else {
      ports = [...POPULAR_PORTS];
      scopeLabel = 'популярные дев-порты';
    }

    if (!ports.length) {
      fail('Не понял, какие порты сканировать.', 'Примеры: --ports=3000,8080 или --range=3000-9000');
      return;
    }
    if (ports.length > 20000) {
      fail(`Слишком много портов: ${ports.length}.`, 'Сузь диапазон, например --range=3000-4000');
      return;
    }

    // Сканирование с живым прогрессом.
    const spin = neonSpinner(`прощупываю ${ports.length} порт(ов), ${scopeLabel}…`);
    const startsAt = Date.now();
    const hits = await scanPorts(ports, (done, total, port, open) => {
      if (open || done === total || done % 100 === 0) {
        spin.update(`прощупываю ${done}/${total}  ·  последний :${port}`);
      }
    });
    spin.stop();

    const busy = hits.filter((h) => h.open);
    const elapsed = Date.now() - startsAt;
    const showAll = flagBool(args, 'all') && !flagBool(args, 'busy');

    // Итог: таблица для короткого списка, сетка + таблица занятых для диапазона.
    process.stdout.write('\n');
    if (hits.length > 60 && !showAll) {
      const perRow = Math.max(4, Math.floor((Math.min(process.stdout.columns ?? 100, 120) - 2) / 9));
      process.stdout.write(renderGrid(hits, perRow) + '\n');
      if (busy.length) {
        process.stdout.write('\n' + paint('  занятые порты', bold(), fg(C.accent)) + '\n\n');
        process.stdout.write(renderTable(busy) + '\n');
      }
    } else {
      const rowsToShow = showAll ? hits : hits.length > 60 ? busy : hits;
      process.stdout.write(renderTable(rowsToShow) + '\n');
    }

    process.stdout.write(
      '\n  ' +
        paint(`проверено ${hits.length}`, fg(C.muted)) +
        paint('  ·  ', fg(C.faint)) +
        paint(`свободно ${hits.length - busy.length}`, fg(GREEN)) +
        paint('  ·  ', fg(C.faint)) +
        paint(`занято ${busy.length}`, fg(busy.length ? RED : GREEN)) +
        paint(`  ·  ${elapsed} мс`, fg(C.faint)) +
        '\n',
    );

    if (!busy.length) {
      process.stdout.write('\n  ' + ch.hex(N.lime).bold('Все порты свободны.') + paint(' Можно запускать дев-сервер.\n\n', fg(C.muted)));
      return;
    }

    // В один клик освобождаем выбранный порт. В неинтерактивном режиме не спрашиваем.
    if (!isInteractive()) {
      process.stdout.write(
        '\n  ' + paint('освободить: ', fg(C.faint)) + paint('jd killport <порт>', fg(C.info)) + '\n\n',
      );
      return;
    }

    const assumeYes = flagBool(args, 'yes');
    let current = busy;

    for (;;) {
      process.stdout.write('\n');
      const want = assumeYes || (await confirm('Хотите убить какой-то из занятых портов?', false));
      if (!want) {
        process.stdout.write(
          '  ' + paint('освободить вручную: ', fg(C.faint)) + paint('jd killport <порт>', fg(C.info)) + '\n\n',
        );
        return;
      }

      const picked = await selectList(
        current.map((hit) => ({
          label: `:${hit.port}`,
          hint: hit.rows.length
            ? `${shortProcess(hit.process, 32)} · PID ${hit.pid}`
            : 'владелец не определён',
        })),
        {
          title: 'Какой порт освободить?',
          subtitle: 'Enter — выбрать · Esc — отмена',
        },
      );
      if (picked === null) {
        process.stdout.write('\n');
        return;
      }

      const target = current[picked];
      const who = target.rows.length ? `${shortProcess(target.process)} (PID ${target.pid})` : 'неизвестный процесс';
      const sure = assumeYes || (await confirm(`Завершить ${who} на порту ${target.port}?`, true));
      if (!sure) {
        process.stdout.write(paint('  отменено\n', fg(C.muted)));
        continue;
      }

      if (!target.pid) {
        fail(`У порта ${target.port} не видно PID — прибить нечего.`, 'Вероятно, порт держит системный процесс.');
        continue;
      }

      const killSpin = neonSpinner(`завершаю ${who}…`);
      const res = await killPid(target.pid);
      if (res.ok) killSpin.succeed(`остановлен ${who}`);
      else killSpin.fail(`${who} — ${res.message}`);

      // Перепроверяем и обновляем список.
      const verify = neonSpinner(`проверяю порт ${target.port}…`);
      const stillThere = await probePort(target.port, 400);
      verify.stop();

      if (!stillThere) {
        process.stdout.write('  ' + paint(`✓ порт ${target.port} свободен`, fg(GREEN)) + '\n');
        current = current.filter((h) => h.port !== target.port);
      } else {
        process.stdout.write('  ' + paint(`✖ порт ${target.port} всё ещё занят`, fg(RED)) + '\n');
      }

      if (!current.length) {
        process.stdout.write('\n  ' + ch.hex(N.lime).bold('Все занятые порты освобождены.') + '\n\n');
        return;
      }

      process.stdout.write(
        '\n  ' +
          paint(`осталось занятых: ${current.length}`, fg(C.muted)) +
          paint('  ·  ', fg(C.faint)) +
          current
            .slice(0, 8)
            .map((h) => paint(':' + h.port, fg(RED)))
            .join(paint(', ', fg(C.faint))) +
          (current.length > 8 ? paint(` и ещё ${current.length - 8}`, fg(C.faint)) : '') +
          '\n',
      );
    }
  },
} satisfies Command;
