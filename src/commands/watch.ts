// jd watch — ждать сервер или перезапускать команду при изменениях.
//
// Два режима:
//   jd watch http://localhost:3000            — долбить URL, пока не ответит
//   jd watch src --run="npm run build"        — следить за файлами и перезапускать
//
// Второй режим — это «сохранил файл → команда сама перезапустилась», без watch-плагинов.

import path from 'node:path';
import { flagBool, flagNum, flagStr, parseArgs } from '../core/args.ts';
import { fail, info, ok } from '../core/help.ts';
import { isInteractive } from '../core/input.ts';
import { neonSpinner } from '../core/neon.ts';
import { openExternal } from '../core/shell.ts';
import { C, bold, fg, paint } from '../core/theme.ts';
import { box } from '../core/ui.ts';
import { formatMs } from '../core/util.ts';
import {
  compareStates,
  describeChange,
  fileState,
  isEmptyChange,
  waitForUrl,
  type FileState,
} from '../core/watch.ts';
import type { Command } from '../core/registry.ts';

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function normalizeUrl(value: string): string {
  if (/^\d{2,5}$/.test(value)) return `http://localhost:${value}`;
  if (/^https?:\/\//i.test(value)) return value;
  return `http://${value}`;
}

/** Ждать, пока сервер поднимется. */
async function watchUrl(rawUrl: string, args: ReturnType<typeof parseArgs>): Promise<void> {
  const url = normalizeUrl(rawUrl);
  const interval = Math.max(200, flagNum(args, 'interval', 1000));
  const timeoutSec = Math.max(1, flagNum(args, 'timeout', 120));
  const timeoutMs = flagBool(args, 'forever') ? Number.MAX_SAFE_INTEGER : timeoutSec * 1000;

  process.stdout.write(
    '\n' +
      box(
        [
          paint(url, bold(), fg(C.accent)),
          '',
          paint('проверяю каждые ', fg(C.muted)) + paint(`${interval} мс`, fg(C.soft)) + paint(', жду до ', fg(C.muted)) + paint(formatMs(timeoutMs), fg(C.soft)),
          paint('Ctrl+C — перестать ждать', fg(C.faint)),
        ],
        { title: paint('⏳ Жду, пока сервер поднимется', bold(), fg(C.accent)) },
      ) +
      '\n',
  );

  const spin = neonSpinner(`стучась в ${url}…`);
  const result = await waitForUrl(url, {
    intervalMs: interval,
    timeoutMs,
    onAttempt: (attempt) => {
      spin.update(`стучась в ${url}… попытка ${attempt}`);
    },
  });
  spin.stop();

  if (!result.ok) {
    fail(`Сервер не ответил за ${formatMs(result.ms)}.`, result.error ? `Последняя ошибка: ${result.error}` : 'Проверь, что сервер вообще запущен.');
    process.stdout.write('\n');
    return;
  }

  const statusColor = result.status && result.status < 400 ? C.ok : C.warn;
  process.stdout.write(
    '\n  ' +
      paint('✔ ', bold(), fg(statusColor)) +
      paint('сервер отвечает', bold(), fg(C.text)) +
      paint(`   HTTP ${result.status ?? '—'} · ${result.attempts} попыток · ${formatMs(result.ms)}\n`, fg(C.muted)),
  );

  if (flagBool(args, 'open') && result.status && result.status < 400) {
    const opened = await openExternal(url);
    process.stdout.write(
      opened ? paint('  открыл в браузере\n', fg(C.faint)) : paint(`  открой сам: ${url}\n`, fg(C.faint)),
    );
  }
  process.stdout.write('\n');
}

/** Следить за файлами и перезапускать команду. */
async function watchFiles(target: string, commandLine: string, args: ReturnType<typeof parseArgs>): Promise<void> {
  const root = path.resolve(target);
  const interval = Math.max(200, flagNum(args, 'interval', 700));
  const debounce = Math.max(0, flagNum(args, 'debounce', 250));
  const runOnce = flagBool(args, 'once');
  const clear = flagBool(args, 'clear');

  process.stdout.write(
    '\n' +
      box(
        [
          paint('слежу за ', fg(C.muted)) + paint(root, fg(C.soft)),
          paint('запускаю  ', fg(C.muted)) + paint(commandLine, fg(C.cyan)),
          '',
          paint(`опрос каждые ${interval} мс · Ctrl+C — остановить`, fg(C.faint)),
        ],
        { title: paint('👀 Наблюдаю за файлами', bold(), fg(C.accent)) },
      ) +
      '\n',
  );

  const { execCommand } = await import('../core/project.ts');
  let state: FileState = await fileState(root);
  let runs = 0;
  let failures = 0;
  let stop = false;

  process.once('SIGINT', () => {
    stop = true;
    process.stdout.write(paint('\n  остановлено\n\n', fg(C.muted)));
    process.exit(0);
  });

  const runCommand = async (reason: string): Promise<void> => {
    runs++;
    process.stdout.write(
      '\n  ' +
        paint('⟳ ', bold(), fg(C.accent)) +
        paint(reason, fg(C.text)) +
        paint(`   запуск №${runs} · ${new Date().toLocaleTimeString('ru-RU')}`, fg(C.faint)) +
        '\n' +
        paint('  ── вывод команды ' + '─'.repeat(Math.max(4, 40)), fg(C.faint)) +
        '\n',
    );
    const started = Date.now();
    const outcome = await execCommand(
      commandLine,
      root,
      { onData: (chunk: string) => process.stdout.write(chunk) },
      process.env,
    );
    const time = formatMs(Date.now() - started);
    if (outcome.ok) {
      process.stdout.write('\n  ' + paint('✔', fg(C.ok)) + paint(` готово за ${time}`, fg(C.muted)) + '\n');
    } else {
      failures++;
      process.stdout.write('\n  ' + paint('✖', fg(C.err)) + paint(` код ${outcome.code ?? '—'} за ${time} — жду следующего изменения`, fg(C.warn)) + '\n');
    }
    if (clear) process.stdout.write('\x1b[2J\x1b[H');
  };

  await runCommand('первый запуск');
  if (runOnce) return;

  process.stdout.write(paint(`\n  жду изменений (${state.size} файлов под наблюдением)…\n`, fg(C.faint)));

  while (!stop) {
    await new Promise((resolve) => setTimeout(resolve, interval));
    const next = await fileState(root);
    const change = compareStates(state, next);
    state = next;
    if (isEmptyChange(change)) continue;

    // Даём редактору дописать файл, иначе поймаем половину сохранения.
    if (debounce) await new Promise((resolve) => setTimeout(resolve, debounce));
    const again = await fileState(root);
    state = again;

    await runCommand(`изменение: ${describeChange(change)}`);
    process.stdout.write(paint(`\n  жду изменений…\n`, fg(C.faint)));
  }

  if (failures) info(`запусков: ${runs}, из них с ошибкой: ${failures}`);
}

export default {
  name: 'watch',
  aliases: ['w'],
  group: 'Разработка',
  title: 'Наблюдение',
  desc: 'Ждать, пока сервер поднимется, или перезапускать команду при изменениях',
  usage: 'jd watch <url|папка> [--run="команда"] [--interval=700] [--timeout=120] [--open]',
  examples: [
    'jd watch 3000 --open',
    'jd watch http://localhost:5173 --open',
    'jd watch src --run="npm test"',
    'jd watch . --run="npm run build" --interval=500',
  ],

  async run({ argv, cwd }) {
    const args = parseArgs(argv, {
      run: 'string', interval: 'number', timeout: 'number', open: 'boolean', once: 'boolean',
      forever: 'boolean', clear: 'boolean', debounce: 'number',
    });

    const target = args._[0] ?? '';
    if (!target) {
      fail('Что наблюдаем?', 'URL или порт: jd watch 3000 --open   ·   папка с командой: jd watch src --run="npm test"');
      return;
    }

    const commandLine = flagStr(args, 'run', '');
    const isUrl = looksLikeUrl(target) || /^\d{2,5}$/.test(target) || /^localhost(:\d+)?$/i.test(target) || /^127\.0\.0\.1(:\d+)?$/.test(target);

    if (isUrl && !commandLine) {
      await watchUrl(target, args);
      return;
    }

    if (!commandLine) {
      fail('Нужна команда для перезапуска.', `jd watch ${target} --run="npm run build"`);
      return;
    }

    if (!isInteractive() && !flagBool(args, 'once')) {
      info('Режим наблюдения работает в обычном терминале; сделаю один прогон.');
      const { execCommand } = await import('../core/project.ts');
      const outcome = await execCommand(commandLine, path.resolve(cwd, target), { onData: (chunk: string) => process.stdout.write(chunk) }, process.env);
      process.exitCode = outcome.ok ? 0 : 1;
      return;
    }

    await watchFiles(target, commandLine, args);
  },
} satisfies Command;
