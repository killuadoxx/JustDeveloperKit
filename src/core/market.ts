// Магазин расширений: каталог пакетов, установка в проект, пресеты.
//
// Идея: не вспоминать точные имена пакетов и не лазить каждый раз на npm.
// Всё, что нужно, лежит в локальном каталоге; своё добавляется одной командой
// или через форму, а пресет ставит сразу набор под задачу.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CATALOG, CATEGORIES, prettifyPackageName } from './catalog.ts';
import { PRESETS, TEMPLATES_DIR, type Preset, type PresetFile } from './presets.ts';
import { runLine } from './shell.ts';
import { db } from './store.ts';
import { fuzzyMatch, stripBom } from './util.ts';

/* ---------------------------------- типы ---------------------------------- */

export interface Pkg {
  name: string;
  spec: string;
  title: string;
  desc: string;
  category: string;
  tags: string[];
  url: string;
  dev: boolean;
  builtin: boolean;
  hidden: boolean;
  installs: number;
  created_at: string;
}

export interface PkgRow {
  name: string;
  spec: string;
  title: string;
  desc: string;
  category: string;
  tags: string;
  url: string;
  dev: number;
  builtin: number;
  hidden: number;
  installs: number;
  created_at: string;
  updated_at: string;
}

export type Manager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export interface ProjectPackage {
  file: string;
  exists: boolean;
  json: Record<string, unknown> | null;
  deps: Record<string, string>;
  devDeps: Record<string, string>;
  scripts: Record<string, string>;
  type: string;
}

function now(): string {
  return new Date().toISOString();
}

function parseTags(tags: string): string[] {
  return tags
    .split(/[,\s]+/)
    .map((t) => t.trim().replace(/^#/, ''))
    .filter(Boolean);
}

function rowToPkg(row: PkgRow): Pkg {
  return {
    name: row.name,
    spec: row.spec,
    title: row.title || prettifyPackageName(row.name),
    desc: row.desc,
    category: row.category,
    tags: parseTags(row.tags),
    url: row.url,
    dev: Boolean(row.dev),
    builtin: Boolean(row.builtin),
    hidden: Boolean(row.hidden),
    installs: row.installs,
    created_at: row.created_at,
  };
}

/* --------------------------------- каталог -------------------------------- */

let seeded = false;

/**
 * Засеять базовый каталог. Уже существующие записи не трогаем: пользователь
 * мог поправить описание или скрыть пакет — это его полка, а не наша.
 * Возвращает число добавленных записей.
 */
export function seedCatalog(force = false): number {
  if (seeded && !force) return 0;
  seeded = true;
  const statement = db().prepare(
    `INSERT INTO pkgs (name, spec, title, desc, category, tags, url, dev, builtin, hidden, installs, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,1,0,0,?,?)
     ON CONFLICT(name) DO NOTHING`,
  );
  let added = 0;
  const at = now();
  for (const entry of CATALOG) {
    const res = statement.run(
      entry.name,
      entry.spec ?? entry.name,
      entry.title ?? '',
      entry.desc,
      entry.category,
      entry.tags ?? '',
      entry.url ?? `https://www.npmjs.com/package/${entry.name}`,
      entry.dev ? 1 : 0,
      at,
      at,
    );
    added += Number(res.changes);
  }
  return added;
}

export function allPkgs(includeHidden = false): Pkg[] {
  seedCatalog();
  const sql = includeHidden
    ? 'SELECT * FROM pkgs ORDER BY category, name'
    : 'SELECT * FROM pkgs WHERE hidden = 0 ORDER BY category, name';
  return (db().prepare(sql).all() as unknown as PkgRow[]).map(rowToPkg);
}

export function getPkg(name: string): Pkg | null {
  seedCatalog();
  const row = db().prepare('SELECT * FROM pkgs WHERE name = ?').get(name) as PkgRow | undefined;
  return row ? rowToPkg(row) : null;
}

export interface ListOptions {
  category?: string;
  query?: string;
  installedOnly?: boolean;
  includeHidden?: boolean;
}

export function listPkgs(opts: ListOptions = {}): Pkg[] {
  const installed = installedMap(process.cwd());
  let items = allPkgs(opts.includeHidden);

  if (opts.category) {
    const want = opts.category.toLowerCase();
    items = items.filter((p) => p.category.toLowerCase() === want);
  }
  if (opts.query) {
    const q = opts.query.toLowerCase();
    items = items.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.title.toLowerCase().includes(q) ||
        p.desc.toLowerCase().includes(q) ||
        p.tags.some((t) => t.toLowerCase().includes(q)) ||
        p.category.toLowerCase().includes(q),
    );
  }
  if (opts.installedOnly) items = items.filter((p) => installed.has(p.name));

  return items.sort((a, b) => a.category.localeCompare(b.category, 'ru') || a.name.localeCompare(b.name));
}

export interface SavePkgInput {
  name: string;
  spec?: string;
  title?: string;
  desc: string;
  category?: string;
  tags?: string;
  url?: string;
  dev?: boolean;
  /** Обновляем запись из базового каталога или пользовательскую. */
  builtin?: boolean;
}

export function savePkg(input: SavePkgInput): 'created' | 'updated' {
  seedCatalog();
  const name = input.name.trim();
  const existing = db().prepare('SELECT name FROM pkgs WHERE name = ?').get(name) as { name: string } | undefined;
  const spec = (input.spec ?? name).trim() || name;
  const title = (input.title ?? '').trim();
  const category = (input.category ?? '').trim() || 'Моё';
  const url = (input.url ?? '').trim() || `https://www.npmjs.com/package/${name}`;
  const at = now();

  if (existing) {
    // Правка базовой записи делает её пользовательской: каталог её больше не перезапишет.
    db()
      .prepare(
        `UPDATE pkgs SET spec = ?, title = ?, desc = ?, category = ?, tags = ?, url = ?, dev = ?, builtin = 0, hidden = 0, updated_at = ?
         WHERE name = ?`,
      )
      .run(spec, title, input.desc.trim(), category, (input.tags ?? '').trim(), url, input.dev ? 1 : 0, at, name);
    return 'updated';
  }

  db()
    .prepare(
      `INSERT INTO pkgs (name, spec, title, desc, category, tags, url, dev, builtin, hidden, installs, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,0,0,?,?)`,
    )
    .run(name, spec, title, input.desc.trim(), category, (input.tags ?? '').trim(), url, input.dev ? 1 : 0, input.builtin ? 1 : 0, at, at);
  return 'created';
}

/** Скрыть базовый пакет или удалить свой. */
export function removePkg(name: string): 'hidden' | 'deleted' | null {
  const row = db().prepare('SELECT builtin FROM pkgs WHERE name = ?').get(name) as { builtin: number } | undefined;
  if (!row) return null;
  if (row.builtin) {
    db().prepare('UPDATE pkgs SET hidden = 1, updated_at = ? WHERE name = ?').run(now(), name);
    return 'hidden';
  }
  db().prepare('DELETE FROM pkgs WHERE name = ?').run(name);
  return 'deleted';
}

export function restorePkg(name: string): boolean {
  const res = db().prepare('UPDATE pkgs SET hidden = 0, updated_at = ? WHERE name = ? AND hidden = 1').run(now(), name);
  return Number(res.changes) > 0;
}

export function categoriesInUse(): string[] {
  const known = new Set(CATEGORIES);
  const custom = allPkgs(true)
    .map((p) => p.category)
    .filter((c) => !known.has(c));
  return [...CATEGORIES, ...[...new Set(custom)].sort()];
}

export function storeStats(): { total: number; builtin: number; custom: number; hidden: number } {
  const rows = allPkgs(true);
  return {
    total: rows.filter((r) => !r.hidden).length,
    builtin: rows.filter((r) => r.builtin && !r.hidden).length,
    custom: rows.filter((r) => !r.builtin && !r.hidden).length,
    hidden: rows.filter((r) => r.hidden).length,
  };
}

/**
 * Похожие пакеты — чтобы поймать опечатку вроде "grammyjs".
 * Нечёткий счёт ограничен сверху: иначе длинные имена вроде "@grammyjs/runner"
 * перебивают точное совпадение по имени, которое человек и имел в виду.
 */
export function suggestPackages(query: string, limit = 3): string[] {
  const target = query.trim().toLowerCase();
  if (target.length < 3) return [];
  return allPkgs()
    .map((pkg) => {
      const name = pkg.name.toLowerCase();
      const fuzzy = fuzzyMatch(target, name)?.score ?? Number.NEGATIVE_INFINITY;
      let score = Number.isFinite(fuzzy) ? Math.min(fuzzy, 120) : Number.NEGATIVE_INFINITY;
      // Набрано начало имени: "gramm" → grammy.
      if (name.startsWith(target)) score = Math.max(score, 160);
      // К имени дописали лишние буквы: "grammyjs" → grammy.
      if (target.startsWith(name) && name.length >= 3) {
        score = Math.max(score, 200 - (target.length - name.length) * 5);
      }
      const distance = editDistance(target, name);
      if (distance <= 2 && name[0] === target[0]) score = Math.max(score, 150 - distance * 10);
      return { name: pkg.name, score };
    })
    .filter((x) => Number.isFinite(x.score))
    .sort((a, b) => b.score - a.score || a.name.length - b.name.length)
    .slice(0, limit)
    .map((x) => x.name);
}

function editDistance(a: string, b: string): number {
  const dp: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

/* ------------------------------ разбор команд ----------------------------- */

const MANAGERS: Manager[] = ['npm', 'pnpm', 'yarn', 'bun'];
const VERBS = new Set(['install', 'i', 'add', 'a', 'get', 'isntall']);
const IGNORED_FLAGS = new Set([
  '-E', '--save-exact', '-P', '--save-prod', '--save', '-S', '-O', '--save-optional',
  '--no-save', '-f', '--force', '--legacy-peer-deps', '--prefer-offline', '--silent', '-s',
  '--workspace', '-w', '--save-peer', '--exact', '--production', '--omit=dev',
]);
const DEV_FLAGS = new Set(['-D', '--save-dev', '--dev', '-d']);
const GLOBAL_FLAGS = new Set(['-g', '--global']);

export interface ParsedInstall {
  /** Менеджер, если он был указан в команде. */
  manager: Manager | null;
  specs: { name: string; spec: string; dev: boolean }[];
  global: boolean;
  /** Строка, которую не поняли — показываем пользователю. */
  unknown: string[];
}

/**
 * Понять строку установки так, как её пишет человек:
 * npm install grammy, pnpm add -D prisma@6, yarn add zod, просто grammy@1.30.
 */
export function parseInstallCommand(input: string): ParsedInstall {
  const tokens = input.trim().split(/\s+/).filter(Boolean);
  const unknown: string[] = [];
  let manager: Manager | null = null;
  let dev = false;
  let global = false;
  let i = 0;

  const first = (tokens[0] ?? '').toLowerCase();
  if ((MANAGERS as string[]).includes(first) || first === 'npx' || first === 'pnpx') {
    manager = (MANAGERS as string[]).includes(first) ? (first as Manager) : 'npm';
    i++;
  }
  // "npx --yes pkg" и подобное — пропускаем необязательные токены до глагола.
  while (i < tokens.length && tokens[i].startsWith('-')) {
    if (GLOBAL_FLAGS.has(tokens[i])) global = true;
    i++;
  }
  if (VERBS.has((tokens[i] ?? '').toLowerCase())) i++;

  const specs: { name: string; spec: string; dev: boolean }[] = [];
  for (; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.startsWith('-')) {
      if (DEV_FLAGS.has(token)) dev = true;
      else if (GLOBAL_FLAGS.has(token)) global = true;
      else if (!IGNORED_FLAGS.has(token)) unknown.push(token);
      continue;
    }
    const name = extractSpecName(token);
    if (!name) continue;
    specs.push({ name, spec: token, dev });
  }

  return { manager, specs, global, unknown };
}

/** "@scope/name@1.2" → "@scope/name", "grammy@latest" → "grammy". */
export function extractSpecName(spec: string): string {
  const trimmed = spec.trim().replace(/^npm:/, '');
  if (!trimmed) return '';
  if (trimmed.startsWith('@')) {
    const slash = trimmed.indexOf('/');
    if (slash === -1) return trimmed;
    const at = trimmed.indexOf('@', slash);
    return at === -1 ? trimmed : trimmed.slice(0, at);
  }
  const at = trimmed.indexOf('@');
  return at <= 0 ? trimmed : trimmed.slice(0, at);
}

/** Строка установки для человека: npm install --save-dev grammy prisma@6 */
export function installText(manager: Manager, specs: { spec: string; dev: boolean }[]): string {
  const normal = specs.filter((s) => !s.dev).map((s) => s.spec);
  const devSpecs = specs.filter((s) => s.dev).map((s) => s.spec);
  const parts: string[] = [];
  if (normal.length) parts.push(`${manager} ${manager === 'npm' ? 'install' : 'add'} ${normal.join(' ')}`);
  if (devSpecs.length) {
    const flag = manager === 'npm' ? '--save-dev' : manager === 'bun' ? '-d' : '-D';
    parts.push(`${manager} ${manager === 'npm' ? 'install' : 'add'} ${flag} ${devSpecs.join(' ')}`);
  }
  return parts.join(' && ') || `${manager} install`;
}

/* -------------------------------- установка ------------------------------- */

export function detectManager(dir: string): Manager {
  if (existsSync(path.join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(path.join(dir, 'yarn.lock'))) return 'yarn';
  if (existsSync(path.join(dir, 'bun.lockb')) || existsSync(path.join(dir, 'bun.lock'))) return 'bun';
  return 'npm';
}

export function readProjectPackage(dir: string): ProjectPackage {
  const file = path.join(dir, 'package.json');
  if (!existsSync(file)) {
    return { file, exists: false, json: null, deps: {}, devDeps: {}, scripts: {}, type: '' };
  }
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(stripBom(readFileSync(file, 'utf8'))) as Record<string, unknown>;
  } catch {
    json = null;
  }
  return {
    file,
    exists: true,
    json,
    deps: (json?.dependencies as Record<string, string> | undefined) ?? {},
    devDeps: (json?.devDependencies as Record<string, string> | undefined) ?? {},
    scripts: (json?.scripts as Record<string, string> | undefined) ?? {},
    type: typeof json?.type === 'string' ? (json.type as string) : '',
  };
}

/** Что уже стоит в проекте: имя → диапазон версии и признак dev. */
export function installedMap(dir: string): Map<string, { range: string; dev: boolean }> {
  const pkg = readProjectPackage(dir);
  const out = new Map<string, { range: string; dev: boolean }>();
  for (const [name, range] of Object.entries(pkg.deps)) out.set(name, { range, dev: false });
  for (const [name, range] of Object.entries(pkg.devDeps)) out.set(name, { range, dev: true });
  return out;
}

export interface InstallOutcome {
  ok: boolean;
  text: string;
  ms: number;
  stderr: string;
  stdout: string;
}

/** Экранировать аргумент для командной строки оболочки. */
export function quoteArg(value: string): string {
  return /^[A-Za-z0-9@/._^~<>=*+-]+$/.test(value) ? value : `"${value.replace(/"/g, '\\"')}"`;
}

export async function runInstall(
  dir: string,
  specs: { spec: string; dev: boolean }[],
  opts: { manager?: Manager; timeoutMs?: number } = {},
): Promise<InstallOutcome> {
  const manager = opts.manager ?? detectManager(dir);
  const normal = specs.filter((s) => !s.dev).map((s) => s.spec);
  const dev = specs.filter((s) => s.dev).map((s) => s.spec);
  const verb = manager === 'npm' ? 'install' : 'add';
  const started = Date.now();
  const texts: string[] = [];

  const steps: string[][] = [];
  if (normal.length) steps.push([verb, ...normal]);
  if (dev.length) {
    const flag = manager === 'npm' ? '--save-dev' : manager === 'bun' ? '-d' : '-D';
    steps.push([verb, flag, ...dev]);
  }

  let stderr = '';
  let stdout = '';
  for (const args of steps) {
    const line = [manager, ...args.map(quoteArg)].join(' ');
    texts.push(line);
    const res = await runLine(line, { cwd: dir, timeout: opts.timeoutMs ?? 600000 });
    stderr += res.stderr;
    stdout += res.stdout;
    if (!res.ok) {
      return { ok: false, text: texts.join(' && '), ms: Date.now() - started, stderr, stdout };
    }
  }

  return { ok: true, text: texts.join(' && '), ms: Date.now() - started, stderr, stdout };
}

/** Понятная причина из вывода пакетного менеджера. */
export function bestInstallError(outcome: InstallOutcome): string {
  const lines = `${outcome.stderr}\n${outcome.stdout}`
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const interesting = lines.filter((l) => /npm ERR!|error|ERR_|E404|not found|ENOTFOUND|403|404|permission|EACCES/i.test(l));
  const pick = (interesting[interesting.length - 1] ?? lines[lines.length - 1] ?? '').replace(/^npm ERR!\s*/, '');
  return pick.slice(0, 160) || 'пакетный менеджер завершился с ошибкой';
}

export function recordInstall(project: string, name: string, spec: string, dev: boolean, ok: boolean): void {
  db()
    .prepare('INSERT INTO installs (project, name, spec, dev, ok, created_at) VALUES (?,?,?,?,?,?)')
    .run(path.resolve(project), name, spec, dev ? 1 : 0, ok ? 1 : 0, now());
  if (ok) db().prepare('UPDATE pkgs SET installs = installs + 1 WHERE name = ?').run(name);
}

export interface InstallManyResult {
  ok: boolean;
  error?: string;
  created: boolean;
  resolved: { name: string; range: string; dev: boolean }[];
}

/**
 * Установить пакеты в проект и запомнить это в истории.
 * package.json при отсутствии создаём: без него ставить некуда.
 */
export async function installToProject(
  dir: string,
  specs: { name: string; spec: string; dev: boolean }[],
  opts: { manager?: Manager; create?: boolean; timeoutMs?: number } = {},
): Promise<InstallManyResult> {
  const manager = opts.manager ?? detectManager(dir);
  let created = false;
  if (!existsSync(path.join(dir, 'package.json'))) {
    if (opts.create === false) return { ok: false, error: 'в папке нет package.json', created: false, resolved: [] };
    const made = ensurePackageJson(dir, manager);
    if (made === 'failed') return { ok: false, error: 'не удалось создать package.json', created: false, resolved: [] };
    created = made === 'created';
  }

  const outcome = await runInstall(dir, specs, { manager, timeoutMs: opts.timeoutMs });
  for (const item of specs) recordInstall(dir, item.name, item.spec, item.dev, outcome.ok);

  if (!outcome.ok) {
    return { ok: false, error: bestInstallError(outcome), created, resolved: [] };
  }

  // Версии, которые реально записал менеджер, а не те, что мы предполагали.
  const installed = installedMap(dir);
  return {
    ok: true,
    created,
    resolved: specs.map((s) => ({
      name: s.name,
      range: installed.get(s.name)?.range ?? '—',
      dev: installed.get(s.name)?.dev ?? s.dev,
    })),
  };
}

export interface InstallRecord {
  id: number;
  project: string;
  name: string;
  spec: string;
  dev: number;
  ok: number;
  created_at: string;
}

export function installHistory(project?: string, limit = 40): InstallRecord[] {
  const sql = project
    ? 'SELECT * FROM installs WHERE project = ? ORDER BY id DESC LIMIT ?'
    : 'SELECT * FROM installs ORDER BY id DESC LIMIT ?';
  const args: (string | number)[] = project ? [path.resolve(project), limit] : [limit];
  return db().prepare(sql).all(...args) as unknown as InstallRecord[];
}

/* ---------------------------------- пресеты -------------------------------- */

export interface PresetRow {
  name: string;
  title: string;
  desc: string;
  icon: string;
  items: string;
  scripts: string;
  env: string;
  files: string;
  builtin: number;
  uses: number;
  created_at: string;
  updated_at: string;
  custom?: boolean;
}

function jsonParse<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export function rowToPreset(row: PresetRow): Preset {
  return {
    name: row.name,
    title: row.title || prettifyPackageName(row.name),
    desc: row.desc,
    icon: row.icon || '📦',
    items: jsonParse(row.items, []),
    scripts: jsonParse(row.scripts, {}),
    env: jsonParse(row.env, {}),
    files: jsonParse(row.files, []),
    builtin: Boolean(row.builtin),
  };
}

/** Все пресеты: пользовательские перекрывают базовые с тем же именем. */
export function allPresets(): (Preset & { custom: boolean; uses: number })[] {
  const rows = db().prepare('SELECT * FROM presets ORDER BY name').all() as unknown as PresetRow[];
  const custom = new Map(rows.map((r) => [r.name, r]));
  const out: (Preset & { custom: boolean; uses: number })[] = [];

  for (const row of rows) out.push({ ...rowToPreset(row), custom: true, uses: row.uses });
  for (const preset of PRESETS) {
    if (custom.has(preset.name)) continue;
    out.push({ ...preset, builtin: true, custom: false, uses: 0 });
  }
  return out;
}

export function getPreset(name: string): (Preset & { custom: boolean; uses: number }) | null {
  const key = name.trim().toLowerCase();
  return allPresets().find((p) => p.name === key) ?? null;
}

export function savePreset(preset: Preset, opts: { builtin?: boolean } = {}): void {
  const at = now();
  db()
    .prepare(
      `INSERT INTO presets (name, title, desc, icon, items, scripts, env, files, builtin, uses, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,0,?,?)
       ON CONFLICT(name) DO UPDATE SET
         title = excluded.title, desc = excluded.desc, icon = excluded.icon,
         items = excluded.items, scripts = excluded.scripts, env = excluded.env,
         files = excluded.files, builtin = excluded.builtin, updated_at = excluded.updated_at`,
    )
    .run(
      preset.name.trim().toLowerCase(),
      preset.title,
      preset.desc,
      preset.icon,
      JSON.stringify(preset.items),
      JSON.stringify(preset.scripts),
      JSON.stringify(preset.env),
      JSON.stringify(preset.files),
      opts.builtin ? 1 : 0,
      at,
      at,
    );
}

export function removePreset(name: string): boolean {
  return Number(db().prepare('DELETE FROM presets WHERE name = ?').run(name.trim().toLowerCase()).changes) > 0;
}

export function bumpPresetUses(name: string): void {
  db().prepare('UPDATE presets SET uses = uses + 1 WHERE name = ?').run(name);
}

/** Содержимое файла пресета: из src/templates или из базы. */
export function presetFileContent(file: PresetFile): string {
  if (file.content !== undefined) return file.content;
  if (file.template) {
    const full = path.join(TEMPLATES_DIR, file.template);
    if (existsSync(full)) return stripBom(readFileSync(full, 'utf8'));
    throw new Error(`шаблон не найден: ${file.template}`);
  }
  return '';
}

/** Собрать пресет из текущего проекта: пакеты, скрипты и имена переменных. */
export function presetFromProject(dir: string, name: string): Preset | null {
  const pkg = readProjectPackage(dir);
  if (!pkg.json) return null;
  const items = [
    ...Object.keys(pkg.deps).map((n) => ({ name: n, dev: false })),
    ...Object.keys(pkg.devDeps).map((n) => ({ name: n, dev: true })),
  ].slice(0, 60);
  if (!items.length) return null;

  // Значения .env не копируем никогда: в пресете хранятся только имена.
  const envKeys = ['.env', '.env.example']
    .map((f) => path.join(dir, f))
    .filter((f) => existsSync(f))
    .flatMap((f) =>
      stripBom(readFileSync(f, 'utf8'))
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#') && line.includes('='))
        .map((line) => line.slice(0, line.indexOf('=')).trim()),
    );

  return {
    name: name.trim().toLowerCase(),
    title: prettifyPackageName(name),
    desc: `Набор из ${items.length} пакетов, собранный в проекте ${String(pkg.json.name ?? path.basename(dir))}`,
    icon: '🧩',
    items,
    scripts: { ...pkg.scripts },
    env: Object.fromEntries([...new Set(envKeys)].map((k) => [k, ''])),
    files: [],
    note: 'Создан из package.json текущего проекта',
  };
}

/* ---------------------------------- .env ---------------------------------- */

function readEnvNames(file: string): string[] {
  if (!existsSync(file)) return [];
  return stripBom(readFileSync(file, 'utf8'))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => line.slice(0, line.indexOf('=')).trim());
}

export interface EnvResult {
  added: string[];
  skipped: string[];
  files: string[];
  /** Пришлось дописать .env в .gitignore. */
  gitignore: boolean;
}

/** Дописать недостающие переменные. Существующие значения не трогаем никогда. */
export function upsertEnv(dir: string, values: Record<string, string>): EnvResult {
  const added: string[] = [];
  const skipped: string[] = [];
  const files: string[] = [];
  let gitignore = false;
  const keys = Object.keys(values);
  if (!keys.length) return { added, skipped, files, gitignore };

  for (const file of ['.env.example', '.env']) {
    const full = path.join(dir, file);
    const existing = readEnvNames(full);
    const missing = keys.filter((k) => !existing.includes(k));
    skipped.push(...keys.filter((k) => existing.includes(k)));
    if (!missing.length) continue;

    const prefix = existsSync(full)
      ? `${stripBom(readFileSync(full, 'utf8')).endsWith('\n') ? '' : '\n'}\n`
      : '';
    const block = `${prefix}# добавлено jd preset\n${missing.map((k) => `${k}=${values[k]}`).join('\n')}\n`;
    writeFileSync(full, block, { flag: existsSync(full) ? 'a' : 'w', encoding: 'utf8' });
    files.push(file);
    added.push(...missing);
    if (file === '.env') gitignore = ensureGitignored(dir);
  }

  return { added: [...new Set(added)], skipped: [...new Set(skipped)], files, gitignore };
}

/** .env не должен уехать в репозиторий: дописываем его в .gitignore, если тот есть. */
export function ensureGitignored(dir: string): boolean {
  const file = path.join(dir, '.gitignore');
  if (!existsSync(file)) return false;
  const body = stripBom(readFileSync(file, 'utf8'));
  if (/^\.env(\s|$)/m.test(body) || /^\.env\*/m.test(body)) return false;
  const separator = !body ? '' : body.endsWith('\n') ? '\n' : '\n\n';
  writeFileSync(file, `${body}${separator}# секреты\n.env\n`, 'utf8');
  return true;
}

/* ---------------------------------- план ---------------------------------- */

export interface PlanItem {
  name: string;
  spec: string;
  dev: boolean;
  known: boolean;
  title: string;
  desc: string;
  installedRange: string | null;
}

export interface PresetPlan {
  preset: Preset;
  dir: string;
  manager: Manager;
  items: PlanItem[];
  scripts: { name: string; value: string }[];
  scriptsSkipped: { name: string; value: string }[];
  envAdded: { key: string; value: string }[];
  envSkipped: string[];
  filesNew: PresetFile[];
  filesSkipped: PresetFile[];
  typeModule: boolean;
  installText: string;
}

/** Чистый расчёт: что именно произойдёт, если применить пресет. */
export function planPreset(preset: Preset, dir: string, opts: { manager?: Manager } = {}): PresetPlan {
  seedCatalog();
  const manager = opts.manager ?? detectManager(dir);
  const installed = installedMap(dir);
  const pkg = readProjectPackage(dir);

  const items: PlanItem[] = preset.items.map((item) => {
    const known = getPkg(item.name);
    const current = installed.get(item.name) ?? null;
    return {
      name: item.name,
      spec: item.spec ?? known?.spec ?? item.name,
      dev: item.dev ?? known?.dev ?? false,
      known: Boolean(known),
      title: known?.title ?? prettifyPackageName(item.name),
      desc: known?.desc ?? 'нет в каталоге — будет установлен как обычный пакет',
      installedRange: current ? current.range : null,
    };
  });

  const scripts = Object.entries(preset.scripts).map(([name, value]) => ({ name, value }));
  const scriptsNew = scripts.filter((s) => !(s.name in pkg.scripts));
  const scriptsSkipped = scripts.filter((s) => s.name in pkg.scripts);

  const envNames = [
    ...readEnvNames(path.join(dir, '.env')),
    ...readEnvNames(path.join(dir, '.env.example')),
  ];
  const envAdded = Object.entries(preset.env)
    .filter(([key]) => !envNames.includes(key))
    .map(([key, value]) => ({ key, value }));
  const envSkipped = Object.keys(preset.env).filter((key) => envNames.includes(key));

  const filesNew: PresetFile[] = [];
  const filesSkipped: PresetFile[] = [];
  for (const file of preset.files) {
    (existsSync(path.join(dir, file.path)) ? filesSkipped : filesNew).push(file);
  }

  return {
    preset,
    dir,
    manager,
    items,
    scripts: scriptsNew,
    scriptsSkipped,
    envAdded,
    envSkipped,
    filesNew,
    filesSkipped,
    typeModule: Boolean(pkg.json) && !pkg.type,
    installText: installText(manager, items),
  };
}

export interface ApplyOptions {
  /** Ничего не делать, только вернуть план — используется для --dry. */
  dry?: boolean;
  /** Ставить ли пакеты (тесты подставляют false). */
  install?: boolean;
  scripts?: boolean;
  env?: boolean;
  files?: boolean;
  /** Внешняя установка — чтобы тесты не ходили в npm. */
  installer?: (plan: PresetPlan) => Promise<InstallOutcome>;
}

export interface ApplyResult {
  installed: boolean;
  installText: string;
  error?: string;
  typeModule: boolean;
  scripts: string[];
  env: string[];
  envFiles: string[];
  gitignore: boolean;
  files: string[];
  skippedFiles: string[];
}

function setTypeModule(dir: string): boolean {
  const file = path.join(dir, 'package.json');
  if (!existsSync(file)) return false;
  try {
    const json = JSON.parse(stripBom(readFileSync(file, 'utf8'))) as Record<string, unknown>;
    if (json.type) return false;
    json.type = 'module';
    writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8');
    return true;
  } catch {
    return false;
  }
}

function applyScripts(dir: string, scripts: { name: string; value: string }[]): string[] {
  const file = path.join(dir, 'package.json');
  if (!existsSync(file) || !scripts.length) return [];
  try {
    const json = JSON.parse(stripBom(readFileSync(file, 'utf8'))) as Record<string, unknown>;
    const current = (json.scripts as Record<string, string> | undefined) ?? {};
    for (const s of scripts) if (!(s.name in current)) current[s.name] = s.value;
    json.scripts = current;
    writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8');
    return scripts.map((s) => s.name);
  } catch {
    return [];
  }
}

export function ensurePackageJson(dir: string, manager: Manager = 'npm'): 'exists' | 'created' | 'failed' {
  if (existsSync(path.join(dir, 'package.json'))) return 'exists';
  const name = path.basename(dir).toLowerCase().replace(/[^a-z0-9-_.]/g, '-') || 'my-project';
  const json = {
    name,
    version: '0.1.0',
    private: true,
    type: 'module',
    description: '',
    scripts: {},
  };
  try {
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify(json, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
    return 'created';
  } catch {
    void manager;
    return 'failed';
  }
}

/** Применить пресет. Пакеты ставим первыми: если упадёт — файлы не появятся зря. */
export async function applyPresetPlan(plan: PresetPlan, opts: ApplyOptions = {}): Promise<ApplyResult> {
  const result: ApplyResult = {
    installed: false,
    installText: plan.installText,
    typeModule: false,
    scripts: [],
    env: [],
    envFiles: [],
    gitignore: false,
    files: [],
    skippedFiles: plan.filesSkipped.map((f) => f.path),
  };
  if (opts.dry) return result;

  const dir = plan.dir;

  if (opts.install !== false && plan.items.length) {
    const installer = opts.installer ?? ((p: PresetPlan) => runInstall(p.dir, p.items, { manager: p.manager }));
    const outcome = await installer(plan);
    for (const item of plan.items) recordInstall(dir, item.name, item.spec, item.dev, outcome.ok);
    if (!outcome.ok) {
      result.error = bestInstallError(outcome);
      return result;
    }
    result.installed = true;
  }

  result.typeModule = setTypeModule(dir);
  if (opts.scripts !== false) result.scripts = applyScripts(dir, plan.scripts);
  if (opts.env !== false) {
    const env = upsertEnv(dir, Object.fromEntries(plan.envAdded.map((e) => [e.key, e.value])));
    result.env = env.added;
    result.envFiles = env.files;
    result.gitignore = env.gitignore;
  }

  if (opts.files !== false) {
    for (const file of plan.filesNew) {
      const target = path.join(dir, file.path);
      mkdirSync(path.dirname(target), { recursive: true });
      const content = presetFileContent(file);
      writeFileSync(target, content, { encoding: 'utf8', flag: 'wx' });
      result.files.push(file.path);
    }
  }

  return result;
}
