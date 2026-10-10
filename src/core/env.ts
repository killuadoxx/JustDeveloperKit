// Переменные окружения: чтение .env, сравнение с .env.example, дописывание недостающих.
//
// Одна логика на две команды: `jd doctor` ей проверяет проект, `jd env` — показывает
// разницу и умеет её починить. Значения секретов наружу не печатаются.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { stripBom } from './util.ts';

export const ENV_FILE = '.env';
export const ENV_EXAMPLE = '.env.example';

export interface EnvPair {
  key: string;
  value: string;
}

/** Прочитать файл .env: порядок строк сохраняем, комментарии игнорируем. */
export function readEnv(file: string): EnvPair[] {
  if (!existsSync(file)) return [];
  try {
    return stripBom(readFileSync(file, 'utf8'))
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const at = line.indexOf('=');
        return { key: line.slice(0, at).trim(), value: line.slice(at + 1).trim() };
      })
      .filter((pair) => Boolean(pair.key));
  } catch {
    return [];
  }
}

export function envKeys(file: string): string[] {
  return readEnv(file).map((pair) => pair.key);
}

/**
 * Есть ли в имени признак секрета — такие значения маскируем.
 * Слово URL сюда не входит: `DATABASE_URL=file:./dev.db` показывать полезно,
 * а вот строку с логином и паролем внутри прячем (см. CREDENTIALS_RE).
 */
export function isSecretKey(key: string): boolean {
  return /(SECRET|TOKEN|PASSWORD|PASSWD|PASS|APIKEY|API_KEY|PRIVATE|CREDENTIAL|DSN|AUTH|SALT)/i.test(key);
}

/** В значении есть логин и пароль: postgres://user:pass@host/db */
const CREDENTIALS_RE = /:\/\/[^/\s:@]+:[^@\s/]+@/;

/** Показать значение: секреты превращаются в намёк, а не в текст. */
export function maskValue(key: string, value: string): string {
  if (!value) return '(пусто)';
  if (!isSecretKey(key) && !CREDENTIALS_RE.test(value)) return value;
  if (value.length <= 6) return '••••••';
  return `${value.slice(0, 3)}••••••${value.slice(-2)}`;
}

export interface EnvDiff {
  dir: string;
  envFile: string;
  exampleFile: string;
  hasEnv: boolean;
  hasExample: boolean;
  env: EnvPair[];
  example: EnvPair[];
  /** Есть в примере, но нет в .env — с этим приложение обычно падает. */
  missing: string[];
  /** Есть в .env, но нет в примере — стоит дописать в пример для коллег. */
  extra: string[];
  /** Переменные без значения в .env. */
  empty: string[];
}

export function envDiff(dir: string): EnvDiff {
  const envFile = path.join(dir, ENV_FILE);
  const exampleFile = path.join(dir, ENV_EXAMPLE);
  const env = readEnv(envFile);
  const example = readEnv(exampleFile);
  const envNames = env.map((p) => p.key);
  const exampleNames = example.map((p) => p.key);

  return {
    dir,
    envFile,
    exampleFile,
    hasEnv: existsSync(envFile),
    hasExample: existsSync(exampleFile),
    env,
    example,
    missing: exampleNames.filter((k) => !envNames.includes(k)),
    extra: envNames.filter((k) => !exampleNames.includes(k)),
    empty: env.filter((p) => !p.value).map((p) => p.key),
  };
}

export interface FillResult {
  added: string[];
  file: string;
  created: boolean;
}

/**
 * Дописать в .env недостающие переменные из .env.example (значения примера
 * берём как есть). Файл не перезаписывается: только добавляем строки.
 */
export function fillEnvFromExample(dir: string, diff = envDiff(dir)): FillResult {
  const target = path.join(dir, ENV_FILE);
  const created = !diff.hasEnv;
  const missing = diff.missing;

  if (!diff.hasExample) return { added: [], file: target, created: false };
  if (!missing.length && !created) return { added: [], file: target, created: false };

  const byKey = new Map(diff.example.map((p) => [p.key, p.value]));
  const values = missing.length ? missing : diff.example.map((p) => p.key);
  const header = created ? '# создано jd env из .env.example\n' : '';

  const prefix = created || !diff.hasEnv
    ? ''
    : stripBom(readFileSync(target, 'utf8')).endsWith('\n')
      ? ''
      : '\n';
  const block = `${header}${values.map((key) => `${key}=${byKey.get(key) ?? ''}`).join('\n')}\n`;

  writeFileSync(target, block, { flag: created ? 'w' : 'a', encoding: 'utf8' });
  return { added: values, file: target, created };
}

/** Дописать в .env.example ключи, которые есть только в .env (значения — пустые). */
export function fillExampleFromEnv(dir: string, diff = envDiff(dir)): FillResult {
  const target = path.join(dir, ENV_EXAMPLE);
  if (!diff.hasEnv || !diff.extra.length) return { added: [], file: target, created: false };
  const prefix = diff.hasExample && !stripBom(readFileSync(target, 'utf8')).endsWith('\n') ? '\n' : '';
  const block = `${prefix}${diff.extra.map((key) => `${key}=`).join('\n')}\n`;
  writeFileSync(target, block, { flag: diff.hasExample ? 'a' : 'w', encoding: 'utf8' });
  return { added: diff.extra, file: target, created: !diff.hasExample };
}
