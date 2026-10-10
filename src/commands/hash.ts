// jd hash — контрольные суммы файлов и текста: сверить скачанное, найти дубликаты.

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { flagBool, flagStr, parseArgs } from '../core/args.ts';
import { fail, info, ok } from '../core/help.ts';
import { C, bold, fg, paint } from '../core/theme.ts';
import { table, truncate } from '../core/ui.ts';
import { formatBytes } from '../core/util.ts';
import { valueOrStdin } from '../core/util.ts';
import type { Command } from '../core/registry.ts';

const ALGOS = ['sha256', 'sha1', 'md5', 'sha512'] as const;
type Algo = (typeof ALGOS)[number];

function isAlgo(value: string): value is Algo {
  return (ALGOS as readonly string[]).includes(value);
}

/** Посчитать хеш файла потоком — чтобы не тащить в память гигабайты. */
export function hashFile(file: string, algo: Algo): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash(algo);
    const stream = createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

export function hashText(text: string, algo: Algo): string {
  return createHash(algo).update(text, 'utf8').digest('hex');
}

export default {
  name: 'hash',
  aliases: ['checksum', 'sha'],
  group: 'Файлы',
  title: 'Контрольные суммы',
  desc: 'SHA-256 файлов и текста, сверка с ожидаемым значением',
  usage: 'jd hash <файл...> [--algo=sha256] [--verify=<хеш>] [--json]',
  examples: [
    'jd hash setup.exe',
    'jd hash dist/*.zip --algo=md5',
    'jd hash release.zip --verify=abcdef...',
    'echo -n "текст" | jd hash',
  ],

  async run({ argv }) {
    const args = parseArgs(argv, { algo: 'string', a: 'string', verify: 'string', json: 'boolean', text: 'string' }, { a: 'algo' });
    const algoParam = flagStr(args, 'algo', 'sha256').toLowerCase();
    if (!isAlgo(algoParam)) {
      fail(`Алгоритм «${algoParam}» не поддерживается.`, `Есть: ${ALGOS.join(', ')}`);
      return;
    }
    const algo: Algo = algoParam;

    const explicitText = flagStr(args, 'text', '');
    const files = args._.filter(Boolean);

    // Текст: либо флагом, либо из пайпа.
    if (!files.length) {
      const text = explicitText || (await valueOrStdin(undefined));
      if (text === null || text === undefined) {
        fail('Нужен файл или текст.', 'jd hash package.json   ·   echo -n "привет" | jd hash');
        return;
      }
      const digest = hashText(text, algo);
      const expected = flagStr(args, 'verify', '').toLowerCase();
      if (flagBool(args, 'json')) {
        process.stdout.write(JSON.stringify({ source: 'text', algo, hash: digest, bytes: Buffer.byteLength(text) }, null, 2) + '\n');
        return;
      }
      process.stdout.write('\n  ' + paint(`${algo} от текста (${formatBytes(Buffer.byteLength(text))})`, fg(C.muted)) + '\n');
      process.stdout.write('  ' + paint(digest, bold(), fg(C.text)) + '\n');
      if (expected) {
        const same = expected === digest.toLowerCase();
        process.stdout.write('  ' + (same ? paint('✔ совпадает', fg(C.ok)) : paint('✖ не совпадает', fg(C.err))) + '\n');
        if (!same) process.exitCode = 1;
      }
      process.stdout.write('\n');
      return;
    }

    const rows: { file: string; bytes: number; hash: string; error?: string }[] = [];
    for (const file of files) {
      const full = path.resolve(file);
      try {
        const info2 = await stat(full);
        if (info2.isDirectory()) {
          rows.push({ file, bytes: 0, hash: '', error: 'это папка' });
          continue;
        }
        rows.push({ file, bytes: info2.size, hash: await hashFile(full, algo) });
      } catch (err) {
        rows.push({ file, bytes: 0, hash: '', error: (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'файл не найден' : (err as Error).message });
      }
    }

    const expected = flagStr(args, 'verify', '').toLowerCase();
    const failed = rows.filter((r) => r.error);

    if (flagBool(args, 'json')) {
      process.stdout.write(
        JSON.stringify(
          {
            algo,
            verified: expected || null,
            files: rows.map((row) => ({ ...row, matches: expected ? row.hash.toLowerCase() === expected : null })),
          },
          null,
          2,
        ) + '\n',
      );
      if (failed.length) process.exitCode = 1;
      return;
    }

    process.stdout.write('\n');
    if (rows.length === 1 && !rows[0].error) {
      const row = rows[0];
      process.stdout.write('  ' + paint(path.resolve(row.file), fg(C.muted)) + '\n');
      process.stdout.write('  ' + paint(`${algo}: `, fg(C.muted)) + paint(row.hash, bold(), fg(C.text)) + paint(`   ${formatBytes(row.bytes)}\n`, fg(C.faint)));
      if (expected) {
        const same = row.hash.toLowerCase() === expected;
        process.stdout.write('  ' + (same ? paint('✔ хеш совпадает с ожидаемым', bold(), fg(C.ok)) : paint('✖ хеш НЕ совпадает с ожидаемым', bold(), fg(C.err))) + '\n');
        if (!same) process.exitCode = 1;
      }
      process.stdout.write('\n');
      return;
    }

    process.stdout.write(
      table(
        ['ФАЙЛ', 'РАЗМЕР', algo.toUpperCase(), expected ? 'СВЕРКА' : ''],
        rows.map((row) => {
          if (row.error) {
            return [paint(truncate(row.file, 40), fg(C.muted)), paint('—', fg(C.faint)), paint(row.error, fg(C.err)), ''];
          }
          const matches = expected ? row.hash.toLowerCase() === expected : null;
          return [
            paint(truncate(row.file, 40), fg(C.soft)),
            paint(formatBytes(row.bytes), fg(C.faint)),
            paint(row.hash, fg(C.text)),
            matches === null ? '' : matches ? paint('✔', fg(C.ok)) : paint('✖', fg(C.err)),
          ];
        }),
      ) +
        '\n',
    );

    if (expected && !rows.some((r) => r.hash.toLowerCase() === expected)) process.exitCode = 1;
    if (failed.length) {
      info(`не удалось посчитать: ${failed.length}`);
      process.exitCode = 1;
    }
    if (rows.length > 1) {
      const unique = new Set(rows.filter((r) => r.hash).map((r) => r.hash));
      if (unique.size < rows.filter((r) => r.hash).length) info('есть файлы с одинаковым хешем — содержимое совпадает');
      else ok(`все ${rows.length} хешей различны`);
    }
    process.stdout.write('\n');
  },
} satisfies Command;
