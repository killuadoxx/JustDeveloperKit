// jd json / jd csv / jd table — посмотреть данные по-человечески.

import { existsSync, readFileSync } from 'node:fs';
import { parseArgs, flagBool, flagNum, flagStr, type ParsedArgs } from '../core/args.ts';
import { fail, info } from '../core/help.ts';
import { colorizeJson, describeShape, queryPath } from '../core/json.ts';
import { C, bold, fg, paint } from '../core/theme.ts';
import { table, truncate } from '../core/ui.ts';
import { formatBytes, readStdin, stripBom } from '../core/util.ts';
import type { Command } from '../core/registry.ts';

async function loadText(args: ParsedArgs): Promise<{ text: string; label: string } | null> {
  const explicit = flagStr(args, 'file', '');
  const positional = args._[0];
  const candidate = explicit || (positional && existsSync(positional) ? positional : '');
  if (candidate) {
    try {
      // BOM от редактора сломал бы JSON.parse и испортил первую колонку CSV.
      const text = stripBom(readFileSync(candidate, 'utf8'));
      return { text, label: candidate };
    } catch (err) {
      fail(`Не удалось прочитать ${candidate}: ${(err as Error).message}`);
      return null;
    }
  }
  const piped = await readStdin();
  if (piped !== null) return { text: piped, label: 'stdin' };
  return null;
}

function parseMaybeJsonl(text: string): { value: unknown; jsonl: boolean } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return { value: JSON.parse(trimmed), jsonl: false };
  } catch {
    const lines = trimmed.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return null;
    try {
      return { value: lines.map((l) => JSON.parse(l)), jsonl: true };
    } catch {
      return null;
    }
  }
}

function printJson(value: unknown, opts: { minify?: boolean; limit?: number }): void {
  if (opts.minify) {
    process.stdout.write(JSON.stringify(value) + '\n');
    return;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
    process.stdout.write(String(value) + '\n');
    return;
  }
  const pretty = JSON.stringify(value, null, 2);
  const lines = pretty.split('\n');
  const limit = opts.limit && opts.limit > 0 ? opts.limit : lines.length;
  const shown = lines.slice(0, limit);
  process.stdout.write(shown.map((l) => '  ' + colorizeJson(l)).join('\n') + '\n');
  if (shown.length < lines.length) {
    process.stdout.write(paint(`  … ещё ${lines.length - shown.length} строк (--limit=0 чтобы увидеть всё)`, fg(C.faint)) + '\n');
  }
}

export const json = {
  name: 'json',
  aliases: ['jq'],
  group: 'Данные',
  title: 'JSON',
  desc: 'Форматирование, запросы по пути, минификация, JSONL',
  usage: 'jd json [файл] [--query=a.b.0] [--minify] [--shape] [--limit=0]',
  examples: [
    'jd json package.json',
    'jd http https://api.github.com/repos/nodejs/node --raw | jd json --query=stargazers_count',
    'jd json data.json --shape',
    'jd json big.json --query=items.0 --minify',
  ],

  async run({ argv }: { argv: string[] }) {
    const args = parseArgs(argv, { query: 'string', q: 'string', minify: 'boolean', shape: 'boolean', limit: 'number', file: 'string' }, { q: 'query' });
    const source = await loadText(args);
    if (!source) {
      fail('Нет данных.', 'Укажи файл или передай JSON через пайп.');
      return;
    }

    const parsed = parseMaybeJsonl(source.text);
    if (!parsed) {
      fail('Это не валидный JSON.', `Источник: ${source.label}`);
      return;
    }

    const value = parsed.value;
    const query = flagStr(args, 'query', '');

    if (flagBool(args, 'shape')) {
      process.stdout.write('\n  ' + describeShape(value) + '\n\n');
      if (parsed.jsonl) info('Обработан как JSONL (по объекту на строку).');
      return;
    }

    if (query) {
      const found = queryPath(value, query);
      if (found === undefined) {
        fail(`Путь "${query}" не найден.`, 'Подсказка: jd json файл --shape');
        return;
      }
      printJson(found, { minify: flagBool(args, 'minify'), limit: flagNum(args, 'limit', 0) });
      return;
    }

    if (parsed.jsonl) info(`JSONL: ${(value as unknown[]).length} строк.`);
    printJson(value, { minify: flagBool(args, 'minify'), limit: flagNum(args, 'limit', 120) });
  },
} satisfies Command;

/* ---------------------------------- CSV ---------------------------------- */

export function parseDelimited(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function detectSeparator(firstLine: string): string {
  const candidates = [',', ';', '\t', '|'];
  let best = ',';
  let bestCount = 0;
  for (const sep of candidates) {
    const count = firstLine.split(sep).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = sep;
    }
  }
  return best;
}

export const csv = {
  name: 'csv',
  aliases: ['table-csv'],
  group: 'Данные',
  title: 'CSV / TSV',
  desc: 'Таблица в терминале, конверт в JSON, статистика',
  usage: 'jd csv [файл] [--json] [--stats] [--sep=;] [--limit=15] [--all]',
  examples: ['jd csv report.csv', 'jd csv data.csv --json', 'jd csv sales.csv --stats', 'jd csv dump.tsv --sep=\\t'],

  async run({ argv }: { argv: string[] }) {
    const args = parseArgs(
      argv,
      { json: 'boolean', stats: 'boolean', sep: 'string', limit: 'number', all: 'boolean', file: 'string' },
    );
    const source = await loadText(args);
    if (!source) {
      fail('Нет данных.', 'Укажи файл или передай CSV через пайп.');
      return;
    }

    const explicitSep = flagStr(args, 'sep', '');
    const sep = explicitSep === '\\t' ? '\t' : explicitSep || detectSeparator(source.text.split(/\r?\n/)[0] ?? '');
    const rows = parseDelimited(source.text, sep);
    if (rows.length < 2) {
      fail('Нужно минимум две строки: заголовок и данные.');
      return;
    }

    const headers = rows[0].map((h) => h.trim());
    const data = rows.slice(1);
    const objects = data.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));

    if (flagBool(args, 'json')) {
      process.stdout.write(JSON.stringify(objects, null, 2) + '\n');
      return;
    }

    if (flagBool(args, 'stats')) {
      const stats = headers.map((header, index) => {
        const values = data.map((r) => Number((r[index] ?? '').replace(/\s/g, '').replace(',', '.')));
        const numbers = values.filter((v) => Number.isFinite(v));
        if (numbers.length < Math.max(1, values.length * 0.6)) {
          const uniq = new Set(data.map((r) => r[index] ?? ''));
          return [paint(header, fg(C.text)), paint('текст', fg(C.muted)), paint(`уникальных: ${uniq.size}`, fg(C.faint)), '', '', ''];
        }
        const sum = numbers.reduce((a, b) => a + b, 0);
        const min = Math.min(...numbers);
        const max = Math.max(...numbers);
        return [
          paint(header, fg(C.text)),
          paint('число', fg(C.accent)),
          paint(`n=${numbers.length}`, fg(C.faint)),
          paint(`Σ ${sum.toFixed(2)}`, fg(C.ok)),
          paint(`min ${min}`, fg(C.muted)),
          paint(`max ${max}`, fg(C.warn)),
        ];
      });
      process.stdout.write(
        '\n' + table(['КОЛОНКА', 'ТИП', '', 'СУММА', 'МИН', 'МАКС'], stats) + '\n\n',
      );
      info(`средн.: ${headers.map((h, i) => `${h}=${(data.reduce((a, r) => a + (Number((r[i] ?? '').replace(',', '.')) || 0), 0) / data.length).toFixed(2)}`).join('  ')}`);
      return;
    }

    const limit = flagBool(args, 'all') ? data.length : Math.max(1, flagNum(args, 'limit', 15));
    const shown = data.slice(0, limit);
    const colWidth = Math.max(8, Math.floor((process.stdout.columns ?? 120) / Math.max(1, headers.length)) - 2);

    const rendered = table(
      headers.map((h) => truncate(h, colWidth)),
      shown.map((r) => headers.map((_, i) => paint(truncate(r[i] ?? '', colWidth), fg(C.soft)))),
    );

    process.stdout.write('\n' + rendered + '\n');
    process.stdout.write(
      '\n  ' +
        paint(`строк: ${data.length}`, fg(C.muted)) +
        paint(`  колонок: ${headers.length}`, fg(C.muted)) +
        paint(`  разделитель: "${sep === '\t' ? '\\t' : sep}"`, fg(C.faint)) +
        paint(`  размер: ${formatBytes(Buffer.byteLength(source.text))}`, fg(C.faint)) +
        '\n',
    );
    if (shown.length < data.length) {
      process.stdout.write(paint(`  … ещё ${data.length - shown.length} строк (--limit=100 или --all)`, fg(C.faint)) + '\n');
    }
    process.stdout.write('\n');
  },
} satisfies Command;

/* --------------------------------- TABLE --------------------------------- */

export const tableView = {
  name: 'table',
  aliases: ['tbl'],
  group: 'Данные',
  title: 'JSON → таблица',
  desc: 'Массив объектов красиво, как в консоли браузера',
  usage: 'jd table [файл] [--limit=20]',
  examples: ['jd http https://api.github.com/users --raw | jd table', 'jd table rows.json'],

  async run({ argv }: { argv: string[] }) {
    const args = parseArgs(argv, { limit: 'number', file: 'string' });
    const source = await loadText(args);
    if (!source) {
      fail('Нет данных.', 'Передай JSON-массив объектов.');
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(source.text);
    } catch (err) {
      fail(`Не удалось разобрать JSON: ${(err as Error).message}`);
      return;
    }

    const items = Array.isArray(parsed) ? parsed : [parsed];
    if (!items.length || typeof items[0] !== 'object' || items[0] === null) {
      fail('Ожидался массив объектов.');
      return;
    }

    const headers: string[] = [];
    for (const item of items.slice(0, 20)) {
      for (const key of Object.keys(item as Record<string, unknown>)) {
        if (!headers.includes(key)) headers.push(key);
      }
      if (headers.length > 12) break;
    }

    const limit = Math.max(1, flagNum(args, 'limit', 20));
    const shown = items.slice(0, limit);
    const width = Math.max(8, Math.floor((process.stdout.columns ?? 120) / Math.max(1, headers.length)) - 2);

    const fmt = (value: unknown): string => {
      if (value === null || value === undefined) return '—';
      if (typeof value === 'object') return JSON.stringify(value);
      return String(value);
    };

    process.stdout.write(
      '\n' +
        table(
          headers.map((h) => truncate(h, width)),
          shown.map((item) =>
            headers.map((h) => {
              const value = (item as Record<string, unknown>)[h];
              const text = truncate(fmt(value), width);
              if (typeof value === 'number') return paint(text, fg(C.warn));
              if (typeof value === 'boolean') return paint(text, fg(value ? C.ok : C.err));
              if (value === null || value === undefined) return paint(text, fg(C.faint));
              return paint(text, fg(C.soft));
            }),
          ),
        ) +
        '\n',
    );

    if (shown.length < items.length) {
      process.stdout.write(paint(`\n  … ещё ${items.length - shown.length} строк (--limit=${items.length})`, fg(C.faint)) + '\n');
    }
    process.stdout.write('\n');
  },
} satisfies Command;

export default [json, csv, tableView];
