// Реестр команд: каждая команда — отдельный файл в src/commands.
// Чтобы добавить новую, достаточно положить туда файл с export default.

import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ParsedArgs } from './args.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
export const COMMANDS_DIR = path.join(here, '..', 'commands');

export interface CommandContext {
  args: ParsedArgs;
  argv: string[];
  cwd: string;
}

export interface Command {
  /** Основное имя, по которому вызывается: jd <name> */
  name: string;
  aliases?: string[];
  /** Раздел меню */
  group: string;
  /** Короткое название для меню */
  title: string;
  /** Одна строка пояснения */
  desc: string;
  usage?: string;
  examples?: string[];
  /** Спрятать из меню (служебные) */
  hidden?: boolean;
  run: (ctx: CommandContext) => Promise<void> | void;
}

export type CommandModule = { default?: Command | Command[]; commands?: Command[] };

let cache: Command[] | null = null;

export async function loadCommands(): Promise<Command[]> {
  if (cache) return cache;

  const entries = await readdir(COMMANDS_DIR, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && /\.(ts|js|mjs)$/.test(e.name) && !e.name.startsWith('_'))
    .map((e) => e.name)
    .sort();

  const found: Command[] = [];
  const problems: string[] = [];

  for (const file of files) {
    const url = pathToFileURL(path.join(COMMANDS_DIR, file)).href;
    try {
      const mod = (await import(url)) as CommandModule;
      const exported = mod.default ?? mod.commands;
      if (!exported) {
        problems.push(`${file}: нет export default с командой`);
        continue;
      }
      const list = Array.isArray(exported) ? exported : [exported];
      for (const cmd of list) {
        if (!cmd?.name || typeof cmd.run !== 'function') {
          problems.push(`${file}: команда без name или run`);
          continue;
        }
        found.push(cmd);
      }
    } catch (err) {
      problems.push(`${file}: ${(err as Error).message}`);
    }
  }

  if (problems.length) {
    process.stderr.write('Проблемы при загрузке команд:\n  ' + problems.join('\n  ') + '\n');
  }

  const seen = new Map<string, string>();
  for (const cmd of found) {
    for (const key of [cmd.name, ...(cmd.aliases ?? [])]) {
      const prev = seen.get(key);
      if (prev) process.stderr.write(`Конфликт имени "${key}": ${prev} и ${cmd.name}\n`);
      seen.set(key, cmd.name);
    }
  }

  cache = found;
  return found;
}

export function findCommand(commands: Command[], name: string): Command | undefined {
  return commands.find((c) => c.name === name || (c.aliases ?? []).includes(name));
}

export function groupsOf(commands: Command[]): string[] {
  const order = ['Система', 'Разработка', 'Данные', 'Сеть', 'Файлы', 'Заметки', 'Разное'];
  const present = [...new Set(commands.filter((c) => !c.hidden).map((c) => c.group))];
  return present.sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
}
