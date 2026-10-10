// Общее для тестов: песочница вместо настоящей домашней папки.
//
// Важно: JD_HOME подменяется до первого обращения к базе. Сама база открывается
// лениво (db() в core/store.ts), поэтому достаточно выставить переменную
// при импорте этого файла.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.JD_HOME = mkdtempSync(path.join(os.tmpdir(), 'jd-test-home-'));

export function tempDir(prefix = 'jd-test-'): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Создать файлы (включая вложенные папки) внутри каталога. */
export function writeFiles(dir: string, files: Record<string, string>): string {
  for (const [name, content] of Object.entries(files)) {
    const full = path.join(dir, name);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content, 'utf8');
  }
  return dir;
}

/** Временный проект: папка с заданными файлами. */
export function makeProject(files: Record<string, string> = {}): string {
  return writeFiles(tempDir('jd-proj-'), files);
}

export function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
