// Архитектура проекта: обход папок, типы файлов, строки, точки входа.
//
// Задача — быстро увидеть, из чего состоит проект, не листая проводник:
// где код, где тесты, где шаблоны, что занимает место и что является входом.
// Обход и подсчёт — чистые функции над файловой системой, поэтому их видно тестом.

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { mapLimit } from './ports.ts';
import { stripBom } from './util.ts';

export type FileKind =
  | 'code'
  | 'test'
  | 'config'
  | 'doc'
  | 'style'
  | 'script'
  | 'template'
  | 'data'
  | 'asset'
  | 'other';

export const KIND_LABEL: Record<FileKind, string> = {
  code: 'код',
  test: 'тесты',
  config: 'конфиги',
  doc: 'документация',
  style: 'стили',
  script: 'скрипты',
  template: 'шаблоны',
  data: 'данные',
  asset: 'ресурсы',
  other: 'прочее',
};

export const KIND_ICON: Record<FileKind, string> = {
  code: '📄',
  test: '🧪',
  config: '⚙️',
  doc: '📖',
  style: '🎨',
  script: '📜',
  template: '🧩',
  data: '🗃️',
  asset: '🖼️',
  other: '▪️',
};

/** Папки, которые не рассказывают об архитектуре: их содержимое — не наш код. */
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', 'output', '.next', '.nuxt',
  '.output', '.cache', '.parcel-cache', 'coverage', '.nyc_output', '.venv', 'venv', 'env',
  '__pycache__', '.pytest_cache', '.mypy_cache', 'target', 'vendor', '.turbo', '.svelte-kit',
  '.gradle', '.idea', 'tmp', 'temp', 'logs', '.DS_Store', '.terraform', 'bin', 'obj',
]);

/**
 * Простые имена папок из .gitignore в корне проекта.
 * Глоб-маски и отрицания не разбираем: это уже не архитектура, а полноценный
 * движок игнора, и он тут не нужен — важны личные папки вида `scratch/`.
 */
export function ignoredDirsFromGitignore(text: string): Set<string> {
  const out = new Set<string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    if (/[*?[\]{}]/.test(line)) continue;
    const name = line.replace(/^\//, '').replace(/\/+$/, '');
    if (!name || name.includes('/')) continue;
    out.add(name);
  }
  return out;
}

const SKIP_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

const EXT_KIND: Record<string, FileKind> = {
  // код
  '.ts': 'code', '.tsx': 'code', '.js': 'code', '.jsx': 'code', '.mjs': 'code', '.cjs': 'code',
  '.py': 'code', '.go': 'code', '.rs': 'code', '.java': 'code', '.rb': 'code', '.php': 'code',
  '.c': 'code', '.h': 'code', '.cpp': 'code', '.hpp': 'code', '.cs': 'code', '.kt': 'code',
  '.swift': 'code', '.dart': 'code', '.lua': 'code', '.ex': 'code', '.exs': 'code', '.vue': 'code',
  '.svelte': 'code', '.sql': 'code', '.prisma': 'code',
  // скрипты
  '.sh': 'script', '.bash': 'script', '.zsh': 'script', '.ps1': 'script', '.cmd': 'script',
  '.bat': 'script', '.fish': 'script',
  // стили
  '.css': 'style', '.scss': 'style', '.sass': 'style', '.less': 'style', '.styl': 'style',
  // документация
  '.md': 'doc', '.mdx': 'doc', '.txt': 'doc', '.rst': 'doc', '.adoc': 'doc', '.pdf': 'doc',
  // данные и конфиги
  '.json': 'config', '.jsonc': 'config', '.json5': 'config', '.yaml': 'config', '.yml': 'config',
  '.toml': 'config', '.ini': 'config', '.cfg': 'config', '.conf': 'config', '.env': 'config',
  '.csv': 'data', '.tsv': 'data', '.xml': 'data', '.db': 'data', '.sqlite': 'data',
  '.sqlite3': 'data', '.parquet': 'data', '.ndjson': 'data', '.jsonl': 'data',
  // шаблоны
  '.hbs': 'template', '.ejs': 'template', '.pug': 'template', '.mustache': 'template',
  '.twig': 'template', '.liquid': 'template', '.tmpl': 'template',
  // ресурсы
  '.png': 'asset', '.jpg': 'asset', '.jpeg': 'asset', '.gif': 'asset', '.webp': 'asset',
  '.svg': 'asset', '.ico': 'asset', '.bmp': 'asset', '.woff': 'asset', '.woff2': 'asset',
  '.ttf': 'asset', '.otf': 'asset', '.eot': 'asset', '.mp3': 'asset', '.wav': 'asset',
  '.ogg': 'asset', '.mp4': 'asset', '.webm': 'asset', '.mov': 'asset', '.zip': 'asset',
  '.gz': 'asset', '.tar': 'asset', '.exe': 'asset', '.dll': 'asset',
};

const CONFIG_NAMES = new Set([
  'package.json', 'package-lock.json', 'tsconfig.json', 'jsconfig.json', '.gitignore',
  '.gitattributes', '.editorconfig', '.npmrc', '.nvmrc', '.prettierrc', '.eslintrc',
  'dockerfile', 'makefile', '.env', '.env.example', '.env.local', 'requirements.txt',
  'pyproject.toml', 'go.mod', 'cargo.toml', 'gemfile', 'composer.json', 'procfile',
]);

const DOC_NAMES = new Set(['readme', 'license', 'changelog', 'contributing', 'authors', 'notice', 'todo']);

const TEXT_KINDS = new Set<FileKind>(['code', 'test', 'config', 'doc', 'style', 'script', 'template', 'data']);

/** Файлы больше этого размера не читаем ради подсчёта строк. */
const MAX_COUNT_BYTES = 2 * 1024 * 1024;

export function shouldSkipDir(name: string): boolean {
  return SKIP_DIRS.has(name) || name.startsWith('.git');
}

export function shouldSkipFile(name: string): boolean {
  return SKIP_FILES.has(name) || name.endsWith('.log');
}

/** Тип файла по имени и пути: расширение плюс особые имена и папки. */
export function classifyFile(name: string, relPath = name): FileKind {
  const lower = name.toLowerCase();
  const base = lower.replace(/\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb|php)$/, '');
  const inTests = /(^|[\\/])(tests?|__tests__|spec|e2e)([\\/]|$)/i.test(relPath);
  const inTemplates = /(^|[\\/])(templates?|tpl|skeletons?)([\\/]|$)/i.test(relPath);

  if (/\.(test|spec)\.[a-z0-9]+$/i.test(lower) || /_test\.(go|py|rb)$/i.test(lower) || inTests) return 'test';
  if (inTemplates) return 'template';
  if (CONFIG_NAMES.has(lower) || /^(\.env|\.eslintrc|\.prettierrc|\.babelrc)/.test(lower)) return 'config';
  if (/^tsconfig.*\.json$/.test(lower) || /\.config\.(ts|js|mjs|cjs)$/.test(lower)) return 'config';
  if (DOC_NAMES.has(base) && !path.extname(lower)) return 'doc';
  if (/^(readme|license|changelog|contributing)(\..*)?$/i.test(lower)) return 'doc';

  const ext = path.extname(lower);
  if (ext && EXT_KIND[ext]) return EXT_KIND[ext];
  if (/^\.(bashrc|zshrc|profile|gitignore|gitattributes|editorconfig)$/.test(lower)) return 'config';
  if (lower.startsWith('.')) return 'config';
  if (!ext) return 'other';
  return 'other';
}

export function isTextKind(kind: FileKind): boolean {
  return TEXT_KINDS.has(kind);
}

/** Строк в тексте: без BOM-сюрпризов, последняя строка без \n тоже считается. */
export function countLines(text: string): number {
  if (!text) return 0;
  const normalized = text.replace(/\r\n/g, '\n');
  const newlines = (normalized.match(/\n/g) ?? []).length;
  return normalized.endsWith('\n') ? newlines : newlines + 1;
}

function looksBinary(buffer: Buffer): boolean {
  const limit = Math.min(buffer.length, 8192);
  for (let i = 0; i < limit; i++) if (buffer[i] === 0) return true;
  return false;
}

export interface ArchFile {
  name: string;
  /** Путь относительно корня, со слэшами вперёд. */
  rel: string;
  kind: FileKind;
  bytes: number;
  /** Строк в текстовом файле; null — бинарный, слишком большой или не читался. */
  lines: number | null;
  depth: number;
}

export interface ArchDir {
  name: string;
  rel: string;
  depth: number;
  dirs: ArchDir[];
  files: ArchFile[];
  bytes: number;
  lines: number;
  fileCount: number;
  dirCount: number;
}

export interface KindStat {
  files: number;
  lines: number;
  bytes: number;
}

export interface ArchSummary {
  root: string;
  name: string;
  projectType: string;
  tree: ArchDir;
  files: number;
  dirs: number;
  bytes: number;
  lines: number;
  binaryFiles: number;
  byKind: { kind: FileKind; stat: KindStat }[];
  top: ArchFile[];
  entryPoints: string[];
  /** Обход упёрся в лимит файлов — цифры неполные. */
  truncated: boolean;
}

export interface ScanOptions {
  /** Насколько глубоко строить дерево (по умолчанию 4). */
  depth?: number;
  /** Считать строки в текстовых файлах (по умолчанию да). */
  lines?: boolean;
  /** Не пропускать dist/build/node_modules — для отладки самого сканера. */
  all?: boolean;
  /** Предел числа файлов, чтобы не залипнуть на гигантском дереве. */
  maxFiles?: number;
  signal?: AbortSignal;
}

const toPosix = (value: string): string => value.split(path.sep).join('/');

function emptyDir(name: string, rel: string, depth: number): ArchDir {
  return { name, rel, depth, dirs: [], files: [], bytes: 0, lines: 0, fileCount: 0, dirCount: 0 };
}

/** Определить, что это за проект, по файлам в корне. */
export function detectProjectType(rootNames: string[], hasTypeScript = false): string {
  const has = (...names: string[]): boolean => names.some((n) => rootNames.includes(n));
  const lower = rootNames.map((n) => n.toLowerCase());

  const parts: string[] = [];
  if (lower.includes('package.json')) {
    const isTs = hasTypeScript || lower.some((n) => n.startsWith('tsconfig'));
    parts.push(isTs ? 'Node.js + TypeScript' : 'Node.js');
  }
  if (lower.includes('pyproject.toml') || lower.includes('requirements.txt')) parts.push('Python');
  if (lower.includes('go.mod')) parts.push('Go');
  if (lower.includes('cargo.toml')) parts.push('Rust');
  if (lower.includes('composer.json')) parts.push('PHP');
  if (lower.includes('gemfile')) parts.push('Ruby');
  if (has('Dockerfile', 'dockerfile', 'docker-compose.yml', 'compose.yaml')) parts.push('Docker');
  if (lower.includes('index.html')) parts.push('статика');
  return parts.length ? parts.join(' + ') : 'проект';
}

/** Точки входа: то, с чего начинается запуск. */
export function detectEntryPoints(files: ArchFile[], packageJson: Record<string, unknown> | null): string[] {
  const out = new Set<string>();
  const main = typeof packageJson?.main === 'string' ? packageJson.main : '';
  const bin = packageJson?.bin;
  if (main) out.add(toPosix(main));
  if (typeof bin === 'string') out.add(toPosix(bin));
  else if (bin && typeof bin === 'object') {
    for (const value of Object.values(bin as Record<string, unknown>)) {
      if (typeof value === 'string') out.add(toPosix(value));
    }
  }

  const patterns = [
    /^src\/index\.(ts|tsx|js|mjs|cjs)$/,
    /^src\/cli\.(ts|js)$/,
    /^src\/(server|app|main)\.(ts|tsx|js)$/,
    /^index\.(ts|js|mjs)$/,
    /^main\.(py|go|rs)$/,
    /^src\/main\.(go|rs)$/,
    /^(server|app)\.(ts|js)$/,
    /^bin\/[\w.-]+$/,
  ];
  for (const file of files) {
    if (patterns.some((re) => re.test(file.rel))) out.add(file.rel);
  }
  return [...out].filter((rel) => files.some((f) => f.rel === rel)).sort();
}

async function readPackageJson(root: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = stripBom(await readFile(path.join(root, 'package.json'), 'utf8'));
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Обойти проект и собрать дерево со статистикой. */
export async function scanTree(root: string, opts: ScanOptions = {}): Promise<ArchSummary> {
  const maxDepth = Math.max(0, opts.depth ?? 4);
  const maxFiles = opts.maxFiles ?? 20000;
  const countLinesEnabled = opts.lines !== false;

  // Уважаем .gitignore проекта: личные папки вроде scratch/ — не архитектура.
  let ignored = new Set<string>();
  if (!opts.all) {
    try {
      ignored = ignoredDirsFromGitignore(stripBom(await readFile(path.join(root, '.gitignore'), 'utf8')));
    } catch {
      ignored = new Set();
    }
  }
  const skip = (name: string): boolean => !opts.all && (shouldSkipDir(name) || ignored.has(name));

  const collected: ArchFile[] = [];
  let truncated = false;

  const walk = async (dir: string, node: ArchDir, depth: number): Promise<void> => {
    let entries: Awaited<ReturnType<typeof readdir>>;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => {
      const aDir = a.isDirectory() ? 0 : 1;
      const bDir = b.isDirectory() ? 0 : 1;
      return aDir - bDir || a.name.localeCompare(b.name, 'ru');
    });

    for (const entry of entries) {
      if (opts.signal?.aborted) return;
      if (entry.isDirectory()) {
        if (skip(entry.name)) continue;
        node.dirCount++;
        if (depth >= maxDepth) continue;
        const child = emptyDir(entry.name, node.rel ? `${node.rel}/${entry.name}` : entry.name, node.depth + 1);
        node.dirs.push(child);
        await walk(path.join(dir, entry.name), child, depth + 1);
        node.fileCount += child.fileCount;
        node.dirCount += child.dirCount;
        node.bytes += child.bytes;
        node.lines += child.lines;
        continue;
      }
      if (!entry.isFile() || (shouldSkipFile(entry.name) && !opts.all)) continue;
      if (collected.length >= maxFiles) {
        truncated = true;
        continue;
      }

      const rel = node.rel ? `${node.rel}/${entry.name}` : entry.name;
      let bytes = 0;
      try {
        bytes = (await stat(path.join(dir, entry.name))).size;
      } catch {
        continue;
      }

      const file: ArchFile = {
        name: entry.name,
        rel,
        kind: classifyFile(entry.name, rel),
        bytes,
        lines: null,
        depth: node.depth + 1,
      };
      collected.push(file);
      node.files.push(file);
      node.fileCount++;
      node.bytes += bytes;
    }
  };

  const tree = emptyDir(path.basename(root) || root, '', 0);
  await walk(root, tree, 0);

  // Строки считаем отдельным проходом и параллельно: чтение файлов — самая долгая часть.
  if (countLinesEnabled) {
    const candidates = collected.filter((f) => isTextKind(f.kind) && f.bytes > 0 && f.bytes <= MAX_COUNT_BYTES);
    await mapLimit(candidates, 48, async (file) => {
      try {
        const buffer = await readFile(path.join(root, file.rel.split('/').join(path.sep)));
        if (looksBinary(buffer)) return;
        file.lines = countLines(stripBom(buffer.toString('utf8')));
      } catch {
        file.lines = null;
      }
    });
    // Суммы по папкам собираем снизу вверх: у родителя — свои файлы плюс дети.
    const rollup = (node: ArchDir): number => {
      node.lines = node.files.reduce((sum, f) => sum + (f.lines ?? 0), 0);
      for (const child of node.dirs) node.lines += rollup(child);
      return node.lines;
    };
    rollup(tree);
  }

  const rootNames = (await readdir(root).catch(() => [] as string[])) as string[];
  const packageJson = await readPackageJson(root);

  const kindMap = new Map<FileKind, KindStat>();
  for (const file of collected) {
    const stat = kindMap.get(file.kind) ?? { files: 0, lines: 0, bytes: 0 };
    stat.files++;
    stat.lines += file.lines ?? 0;
    stat.bytes += file.bytes;
    kindMap.set(file.kind, stat);
  }

  const byKind = [...kindMap.entries()]
    .map(([kind, stat]) => ({ kind, stat }))
    .sort((a, b) => b.stat.lines - a.stat.lines || b.stat.files - a.stat.files);

  return {
    root,
    name: path.basename(root) || root,
    projectType: detectProjectType(rootNames, collected.some((f) => /\.(ts|tsx|mts|cts)$/.test(f.name))),
    tree,
    files: collected.length,
    dirs: tree.dirCount,
    bytes: collected.reduce((sum, f) => sum + f.bytes, 0),
    lines: collected.reduce((sum, f) => sum + (f.lines ?? 0), 0),
    binaryFiles: collected.filter((f) => f.lines === null).length,
    byKind,
    top: [...collected].sort((a, b) => b.bytes - a.bytes).slice(0, 12),
    entryPoints: detectEntryPoints(collected, packageJson),
    truncated,
  };
}

/** Плоский список файлов в порядке дерева — для поиска и вкладок. */
export function flattenFiles(node: ArchDir, out: ArchFile[] = []): ArchFile[] {
  out.push(...node.files);
  for (const dir of node.dirs) flattenFiles(dir, out);
  return out;
}

/** Короткое человеческое описание файла — для панели деталей. */
export function describeFile(file: ArchFile): string {
  const lower = file.name.toLowerCase();
  if (file.kind === 'test') return 'тесты: проверки, которые можно запустить';
  if (file.kind === 'config') return 'конфигурация: настройки инструментов и проекта';
  if (file.kind === 'doc') return 'документация: описание проекта для людей';
  if (file.kind === 'template') return 'шаблон: файл-заготовка для генерации';
  if (file.kind === 'asset') return 'ресурс: картинка, шрифт или другой бинарный файл';
  if (file.kind === 'script') return 'скрипт: запускается оболочкой';
  if (file.kind === 'style') return 'стили: оформление интерфейса';
  if (lower.startsWith('index.')) return 'точка входа модуля: то, что импортируют другие';
  if (file.kind === 'code') return 'исходный код';
  return 'файл проекта';
}
