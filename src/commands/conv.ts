// jd conv — конвертеры, которые нужны по десять раз на дню.

import { createHash, randomUUID } from 'node:crypto';
import { parseArgs, flagBool, flagNum, flagStr } from '../core/args.ts';
import { fail, info } from '../core/help.ts';
import { isInteractive, selectList } from '../core/input.ts';
import { C, bold, fg, paint } from '../core/theme.ts';
import { table } from '../core/ui.ts';
import { formatDuration, valueOrStdin } from '../core/util.ts';
import type { Command } from '../core/registry.ts';

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

const KINDS: { value: string; label: string; hint: string }[] = [
  { value: 'b64', label: 'base64', hint: 'кодировать / --decode' },
  { value: 'url', label: 'URL', hint: 'encodeURIComponent / --decode' },
  { value: 'jwt', label: 'JWT', hint: 'разобрать токен' },
  { value: 'ts', label: 'Время', hint: 'unixtime ↔ дата' },
  { value: 'hex', label: 'HEX', hint: 'строка ↔ hex' },
  { value: 'hash', label: 'Хеш', hint: 'md5, sha1, sha256, sha512' },
  { value: 'uuid', label: 'UUID', hint: 'сгенерировать' },
  { value: 'case', label: 'Регистр', hint: 'camelCase, snake_case, …' },
  { value: 'slug', label: 'Slug', hint: 'транслит в url-вид' },
];

function decodeBase64(input: string): string {
  const normalized = input.trim().replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf8');
}

function decodeJwt(token: string): { header: unknown; payload: unknown; signature: string; valid: boolean } | null {
  const parts = token.trim().split('.');
  if (parts.length < 2) return null;
  try {
    const header = JSON.parse(decodeBase64(parts[0]));
    const payload = JSON.parse(decodeBase64(parts[1]));
    return { header, payload, signature: parts[2] ?? '', valid: parts.length === 3 };
  } catch {
    return null;
  }
}

function words(input: string): string[] {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.\s]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

function toCase(input: string, mode: string): string {
  const parts = words(input);
  const lower = parts.map((w) => w.toLowerCase());
  switch (mode) {
    case 'camel':
      return lower.map((w, i) => (i === 0 ? w : w[0].toUpperCase() + w.slice(1))).join('');
    case 'pascal':
      return lower.map((w) => w[0].toUpperCase() + w.slice(1)).join('');
    case 'snake':
      return lower.join('_');
    case 'kebab':
      return lower.join('-');
    case 'const':
      return lower.join('_').toUpperCase();
    case 'dot':
      return lower.join('.');
    case 'title':
      return parts.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
    default:
      return input;
  }
}

function slugify(input: string): string {
  const translit = [...input.toLowerCase()].map((ch) => TRANSLIT[ch] ?? ch).join('');
  return translit
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function timeInfo(value: string): string[] {
  const out: string[] = [];
  const digits = /^\d{9,13}$/.test(value.trim());

  if (digits) {
    const raw = Number(value.trim());
    const ms = value.trim().length >= 12 ? raw : raw * 1000;
    const date = new Date(ms);
    out.push(paint('unix (мс)', fg(C.muted)) + '  ' + paint(String(ms), fg(C.text)));
    out.push(paint('unix (с) ', fg(C.muted)) + '  ' + paint(String(Math.floor(ms / 1000)), fg(C.text)));
    out.push(paint('ISO 8601  ', fg(C.muted)) + '  ' + paint(date.toISOString(), fg(C.info)));
    out.push(paint('локально  ', fg(C.muted)) + '  ' + paint(date.toLocaleString('ru-RU'), fg(C.text)));
    out.push(paint('день      ', fg(C.muted)) + '  ' + paint(date.toLocaleDateString('ru-RU', { weekday: 'long' }), fg(C.accent)));
  } else {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return [paint('не удалось разобрать дату', fg(C.err))];
    out.push(paint('вход      ', fg(C.muted)) + '  ' + paint(value, fg(C.text)));
    out.push(paint('unix (с)  ', fg(C.muted)) + '  ' + paint(String(Math.floor(date.getTime() / 1000)), fg(C.ok)));
    out.push(paint('unix (мс) ', fg(C.muted)) + '  ' + paint(String(date.getTime()), fg(C.ok)));
    out.push(paint('ISO 8601  ', fg(C.muted)) + '  ' + paint(date.toISOString(), fg(C.info)));
  }
  return out;
}

export default {
  name: 'conv',
  aliases: ['c', 'convert'],
  group: 'Данные',
  title: 'Конвертеры',
  desc: 'base64, url, jwt, время, hex, хеши, uuid, регистр, slug',
  usage: 'jd conv <вид> [значение] [--decode] [--algo=sha256] [--count=5]',
  examples: [
    'jd conv b64 "привет"',
    'echo "aGVsbG8=" | jd conv b64 --decode',
    'jd conv jwt eyJhbGciOi...',
    'jd conv ts 1734567890',
    'jd conv ts "2025-01-01"',
    'jd conv hash "текст" --algo=md5',
    'jd conv case "Hello World Test"',
  ],

  async run({ argv }) {
    const args = parseArgs(
      argv,
      { decode: 'boolean', d: 'boolean', encode: 'boolean', e: 'boolean', algo: 'string', count: 'number', n: 'number' },
      { d: 'decode', e: 'encode', n: 'count' },
    );

    let kind = args._[0];
    if (!kind) {
      if (!isInteractive()) {
        process.stdout.write('\n  Виды: ' + KINDS.map((k) => k.value).join(', ') + '\n\n');
        return;
      }
      const index = await selectList(
        KINDS.map((k) => ({ label: k.label, hint: k.hint, group: 'Конвертеры' })),
        { title: 'Что конвертируем?', pageSize: KINDS.length },
      );
      if (index === null) return;
      kind = KINDS[index].value;
    }

    const rest = args._.slice(1).join(' ');
    const decode = flagBool(args, 'decode');
    const raw = await valueOrStdin(rest);

    const need = (): string | null => {
      if (raw === null || raw === '') {
        fail('Нужно значение: передай аргументом или через пайп.', `Например: jd conv ${kind} "текст"`);
        return null;
      }
      return raw;
    };

    switch (kind) {
      case 'b64':
      case 'base64': {
        if (kind === 'base64' && !decode) {
          const value = need();
          if (value === null) return;
          process.stdout.write(Buffer.from(value, 'utf8').toString('base64') + '\n');
          return;
        }
        const value = need();
        if (value === null) return;
        process.stdout.write(
          (decode ? decodeBase64(value) : Buffer.from(value, 'utf8').toString('base64')) + '\n',
        );
        return;
      }

      case 'url': {
        const value = need();
        if (value === null) return;
        if (decode) {
          try {
            process.stdout.write(decodeURIComponent(value) + '\n');
          } catch {
            fail('Строка не является корректным URL-энкодингом.');
          }
        } else {
          process.stdout.write(encodeURIComponent(value) + '\n');
        }
        return;
      }

      case 'hex': {
        const value = need();
        if (value === null) return;
        if (decode) {
          const clean = value.replace(/[^0-9a-fA-F]/g, '');
          process.stdout.write(Buffer.from(clean, 'hex').toString('utf8') + '\n');
        } else {
          process.stdout.write(Buffer.from(value, 'utf8').toString('hex') + '\n');
        }
        return;
      }

      case 'jwt': {
        const value = need();
        if (value === null) return;
        const parsed = decodeJwt(value);
        if (!parsed) {
          fail('Это не похоже на JWT (нужно минимум два сегмента через точку).');
          return;
        }
        const lines: string[] = [];
        lines.push(paint('HEADER', bold(), fg(C.accent)));
        lines.push(JSON.stringify(parsed.header, null, 2));
        lines.push('');
        lines.push(paint('PAYLOAD', bold(), fg(C.accent)));
        lines.push(JSON.stringify(parsed.payload, null, 2));

        const payload = parsed.payload as { exp?: number; iat?: number; nbf?: number };
        if (payload?.exp) {
          const left = payload.exp * 1000 - Date.now();
          lines.push('');
          lines.push(
            paint('истекает: ', fg(C.muted)) +
              paint(new Date(payload.exp * 1000).toLocaleString('ru-RU'), fg(C.text)) +
              paint(left > 0 ? `  (осталось ${formatDuration(left)})` : '  — ПРОСРОЧЕН', fg(left > 0 ? C.ok : C.err)),
          );
        }
        if (payload?.iat) {
          lines.push(paint('выдан:    ', fg(C.muted)) + paint(new Date(payload.iat * 1000).toLocaleString('ru-RU'), fg(C.soft)));
        }
        if (!parsed.signature) {
          lines.push(paint('подпись отсутствует (alg=none?)', fg(C.warn)));
        }
        process.stdout.write('\n' + lines.join('\n') + '\n\n');
        return;
      }

      case 'ts':
      case 'time': {
        const value = need();
        if (value === null) return;
        process.stdout.write(timeInfo(value).join('\n') + '\n');
        return;
      }

      case 'hash': {
        const value = need();
        if (value === null) return;
        const algo = flagStr(args, 'algo', 'sha256');
        try {
          process.stdout.write(createHash(algo).update(value).digest('hex') + '\n');
        } catch {
          fail(`Алгоритм "${algo}" не поддерживается.`, 'Попробуй: md5, sha1, sha256, sha512');
        }
        return;
      }

      case 'uuid': {
        const count = Math.max(1, Math.min(flagNum(args, 'count', 1), 100));
        for (let i = 0; i < count; i++) process.stdout.write(randomUUID() + '\n');
        return;
      }

      case 'case': {
        const value = need();
        if (value === null) return;
        const modes = ['camel', 'pascal', 'snake', 'kebab', 'const', 'dot', 'title'];
        const rows = modes.map((mode) => [paint(mode, fg(C.muted)), paint(toCase(value, mode), fg(C.text))]);
        process.stdout.write(table(['вид', 'результат'], rows, { showHeader: false }) + '\n');
        return;
      }

      case 'slug': {
        const value = need();
        if (value === null) return;
        process.stdout.write(slugify(value) + '\n');
        return;
      }

      default: {
        info(`Неизвестный вид "${kind}".`);
        process.stdout.write('  Доступно: ' + KINDS.map((k) => paint(k.value, fg(C.info))).join(', ') + '\n');
        process.exitCode = 1;
      }
    }
  },
} satisfies Command;
