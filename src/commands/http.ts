// jd http — быстрый HTTP-клиент с человеческим выводом и историей запросов.

import { writeFileSync } from 'node:fs';
import { parseArgs, flagBool, flagList, flagNum, flagStr } from '../core/args.ts';
import { fail, info, ok } from '../core/help.ts';
import { colorizeJson, describeShape } from '../core/json.ts';
import { copyToClipboard } from '../core/shell.ts';
import { history } from '../core/store.ts';
import { C, bold, fg, paint } from '../core/theme.ts';
import { box, table, truncate } from '../core/ui.ts';
import { formatBytes, readStdin, timeAgo } from '../core/util.ts';
import type { Command } from '../core/registry.ts';

function statusBadge(status: number): string {
  const color = status < 300 ? C.ok : status < 400 ? C.info : status < 500 ? C.warn : C.err;
  return paint(` ${status} `, bold(), fg(color));
}

function parseHeader(input: string): [string, string] | null {
  const idx = input.indexOf(':');
  if (idx === -1) return null;
  return [input.slice(0, idx).trim(), input.slice(idx + 1).trim()];
}

async function showHistory(): Promise<void> {
  const rows = history.recent('http', 25);
  if (!rows.length) {
    info('История пуста — сделай первый запрос: jd http https://api.github.com');
    return;
  }
  process.stdout.write(
    '\n' +
      table(
        ['КОГДА', 'СТАТУС', 'МС', 'ЗАПРОС'],
        rows.map((r) => [
          paint(timeAgo(r.created_at), fg(C.faint)),
          r.ok ? paint('200', fg(C.ok)) : paint('ошибка', fg(C.err)),
          paint(String(r.ms), fg(C.muted)),
          paint(truncate(r.title, 70), fg(C.text)),
        ]),
        { align: ['left', 'left', 'right', 'left'] },
      ) +
      '\n\n',
  );
}

export default {
  name: 'http',
  aliases: ['req', 'curl'],
  group: 'Сеть',
  title: 'HTTP-запрос',
  desc: 'Запрос с подсветкой JSON, таймингом и историей',
  usage: 'jd http <url> [--method=POST] [--header="K: V"] [--data=...] [--json] [--raw] [--full] [--copy] [--save=file]',
  examples: [
    'jd http https://api.github.com/repos/nodejs/node',
    'jd http https://httpbin.org/post --method=POST --json --data=\'{"a":1}\'',
    'jd http https://api.example.com -H "Authorization: Bearer ..."',
    'jd http history',
    'jd http https://example.com --raw > page.html',
  ],

  async run({ argv }) {
    const args = parseArgs(
      argv,
      {
        method: 'string', X: 'string', header: 'array', H: 'array', data: 'array', d: 'array',
        json: 'boolean', raw: 'boolean', full: 'boolean', copy: 'boolean', save: 'string',
        timeout: 'number', headers: 'boolean', history: 'boolean',
      },
      { X: 'method', H: 'header', d: 'data' },
    );

    if (args._[0] === 'history') {
      await showHistory();
      return;
    }

    const url = args._[0];
    if (!url) {
      fail('Укажи адрес.', 'Например: jd http https://api.github.com');
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      fail('Адрес должен начинаться с http:// или https://');
      return;
    }

    let body: string | undefined;
    const dataParts = flagList(args, 'data');
    if (dataParts.length) body = dataParts.join('&');
    else if (!process.stdin.isTTY) body = (await readStdin())?.replace(/\r?\n$/, '') || undefined;

    const wantJson = flagBool(args, 'json');
    const method = (flagStr(args, 'method') || (body ? 'POST' : 'GET')).toUpperCase();

    const headers = new Headers();
    for (const raw of flagList(args, 'header')) {
      const parsed = parseHeader(raw);
      if (parsed) headers.set(parsed[0], parsed[1]);
    }
    if (wantJson && !headers.has('content-type')) headers.set('content-type', 'application/json');
    if (!headers.has('user-agent')) headers.set('user-agent', 'jd-cli/0.1');
    if (!headers.has('accept')) headers.set('accept', 'application/json, text/plain, */*');

    const timeout = Math.max(1, flagNum(args, 'timeout', 20)) * 1000;
    const started = Date.now();

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: method === 'GET' || method === 'HEAD' ? undefined : body,
        signal: AbortSignal.timeout(timeout),
        redirect: 'follow',
      });
    } catch (err) {
      const ms = Date.now() - started;
      history.add({ kind: 'http', title: `${method} ${url}`, ok: false, ms, payload: String((err as Error).message) });
      const cause = (err as { cause?: { code?: string } }).cause;
      fail(
        `Запрос не удался за ${ms} мс: ${(err as Error).message}`,
        cause?.code ? `код: ${cause.code}` : undefined,
      );
      return;
    }

    const text = await response.text();
    const ms = Date.now() - started;
    const contentType = response.headers.get('content-type') ?? '';
    const isJson = contentType.includes('json') || /^\s*[[{]/.test(text);
    history.add({ kind: 'http', title: `${method} ${url}`, ok: response.ok, ms, payload: String(response.status) });

    if (flagBool(args, 'raw')) {
      process.stdout.write(text);
      if (!text.endsWith('\n')) process.stdout.write('\n');
      return;
    }

    const head: string[] = [];
    head.push(
      statusBadge(response.status) +
        '  ' +
        paint(response.statusText || '', fg(C.soft)) +
        paint(`   ${method} `, fg(C.muted)) +
        paint(truncate(url, 80), fg(C.info)),
    );
    head.push(
      paint('  время ', fg(C.muted)) + paint(`${ms} мс`, fg(ms > 3000 ? C.warn : C.ok)) +
      paint('   размер ', fg(C.muted)) + paint(formatBytes(Buffer.byteLength(text)), fg(C.soft)) +
      paint('   тип ', fg(C.muted)) + paint(contentType.split(';')[0] || '—', fg(C.faint)),
    );
    process.stdout.write('\n' + head.join('\n') + '\n');

    if (flagBool(args, 'headers')) {
      const rows: string[][] = [];
      response.headers.forEach((value, key) => rows.push([paint(key, fg(C.muted)), paint(truncate(value, 90), fg(C.soft))]));
      process.stdout.write('\n' + table(['ЗАГОЛОВОК', 'ЗНАЧЕНИЕ'], rows, { showHeader: false }) + '\n');
    }

    const savePath = flagStr(args, 'save');
    if (savePath) {
      writeFileSync(savePath, text, 'utf8');
      ok(`Сохранено в ${savePath}`);
    }

    if (flagBool(args, 'copy')) {
      ok((await copyToClipboard(text)) ? 'Тело скопировано в буфер обмена' : 'Не удалось скопировать');
    }

    if (!text.trim()) {
      process.stdout.write('\n  ' + paint('тело пустое', fg(C.muted)) + '\n\n');
      return;
    }

    const full = flagBool(args, 'full');
    if (isJson) {
      try {
        const parsed = JSON.parse(text);
        const pretty = JSON.stringify(parsed, null, 2);
        process.stdout.write('\n  ' + paint('структура: ', fg(C.muted)) + describeShape(parsed) + '\n\n');
        const lines = pretty.split('\n');
        const shown = full ? lines : lines.slice(0, 60);
        process.stdout.write(shown.map((l) => '  ' + colorizeJson(l)).join('\n') + '\n');
        if (shown.length < lines.length) {
          process.stdout.write(paint(`  … ещё ${lines.length - shown.length} строк (--full или --save=file)`, fg(C.faint)) + '\n');
        }
      } catch {
        process.stdout.write(box(text.split('\n').slice(0, 60), { title: paint('тело', fg(C.muted)) }) + '\n');
      }
    } else {
      const lines = text.split('\n');
      const shown = full ? lines : lines.slice(0, 60);
      process.stdout.write(shown.map((l) => '  ' + truncate(l, 160)).join('\n') + '\n');
      if (shown.length < lines.length) {
        process.stdout.write(paint(`  … ещё ${lines.length - shown.length} строк (--full, --save=file)`, fg(C.faint)) + '\n');
      }
    }
    process.stdout.write('\n');
  },
} satisfies Command;
