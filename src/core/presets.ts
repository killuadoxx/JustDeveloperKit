// Пресеты — готовые наборы для старта проекта: пакеты, скрипты, переменные
// окружения и файлы-заготовки.
//
// Тексты заготовок лежат живыми файлами в src/templates/<пресет>/... —
// их видно, можно читать и править как обычный код. В базе у пользовательских
// пресетов содержимое файлов хранится строкой, поэтому поле content тоже есть.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Куда положить файл из пресета. */
export interface PresetFile {
  /** Путь относительно папки проекта. */
  path: string;
  /** Путь внутри src/templates — откуда взять содержимое. */
  template?: string;
  /** Содержимое строкой (для пресетов, созданных пользователем). */
  content?: string;
  /** Что это за файл — показываем в карточке пресета. */
  desc?: string;
}

export interface PresetItem {
  name: string;
  dev?: boolean;
  spec?: string;
}

export interface Preset {
  name: string;
  title: string;
  desc: string;
  icon: string;
  items: PresetItem[];
  scripts: Record<string, string>;
  /** Переменные окружения: имя → значение по умолчанию (может быть пустым). */
  env: Record<string, string>;
  files: PresetFile[];
  /** Что сделать после установки. */
  note?: string;
  builtin?: boolean;
}

export const TEMPLATES_DIR = path.join(here, '..', 'templates');

export const PRESETS: Preset[] = [
  {
    name: 'telegram-bot',
    title: 'Telegram-бот',
    icon: '📨',
    desc: 'grammy, zod, pino и готовый src/bot.ts с командами и обработкой ошибок',
    items: [
      { name: 'grammy' },
      { name: 'dotenv' },
      { name: 'zod' },
      { name: 'pino' },
      { name: 'pino-pretty', dev: true },
      { name: 'tsx', dev: true },
      { name: 'typescript', dev: true },
      { name: '@types/node', dev: true },
    ],
    scripts: {
      dev: 'node --watch src/bot.ts',
      start: 'node src/bot.ts',
      typecheck: 'tsc --noEmit',
    },
    env: { BOT_TOKEN: '', LOG_LEVEL: 'info' },
    files: [{ path: 'src/bot.ts', template: 'telegram-bot/src/bot.ts', desc: 'бот с /start, /help, /ping и перехватом ошибок' }],
    note: 'Вставь токен от @BotFather в .env и запусти npm run dev',
  },
  {
    name: 'api-rest',
    title: 'REST API',
    icon: '🌐',
    desc: 'Fastify + zod-валидация, CORS, /health и аккуратное завершение',
    items: [
      { name: 'fastify' },
      { name: '@fastify/cors' },
      { name: 'zod' },
      { name: 'pino' },
      { name: 'pino-pretty', dev: true },
      { name: 'tsx', dev: true },
      { name: 'typescript', dev: true },
      { name: '@types/node', dev: true },
    ],
    scripts: {
      dev: 'node --watch src/server.ts',
      start: 'node src/server.ts',
      typecheck: 'tsc --noEmit',
    },
    env: { PORT: '3000', HOST: '0.0.0.0', LOG_LEVEL: 'info' },
    files: [{ path: 'src/server.ts', template: 'api-rest/src/server.ts', desc: 'GET /health и POST /echo со схемой zod' }],
    note: 'npm run dev — сервер поднимется на http://localhost:3000/health',
  },
  {
    name: 'prisma-sqlite',
    title: 'Prisma + SQLite',
    icon: '🗄️',
    desc: 'Схема с User и Post, готовый клиент и скрипты миграций',
    items: [
      { name: 'prisma', dev: true },
      { name: '@prisma/client' },
    ],
    scripts: {
      'db:push': 'prisma db push',
      'db:migrate': 'prisma migrate dev',
      'db:studio': 'prisma studio',
      'db:generate': 'prisma generate',
    },
    env: { DATABASE_URL: 'file:./dev.db' },
    files: [
      { path: 'prisma/schema.prisma', template: 'prisma-sqlite/prisma/schema.prisma', desc: 'модели User и Post' },
      { path: 'src/db.ts', template: 'prisma-sqlite/src/db.ts', desc: 'единственный экземпляр PrismaClient' },
    ],
    note: 'npm run db:push — создать таблицы, затем npm run db:studio',
  },
  {
    name: 'cli-tool',
    title: 'CLI-утилита',
    icon: '🛠️',
    desc: 'commander, цветной вывод, спиннер и пример своих команд',
    items: [
      { name: 'commander' },
      { name: 'chalk' },
      { name: 'ora' },
      { name: 'zod' },
      { name: 'typescript', dev: true },
      { name: 'tsx', dev: true },
      { name: '@types/node', dev: true },
    ],
    scripts: {
      dev: 'node --watch src/index.ts',
      start: 'node src/index.ts',
      typecheck: 'tsc --noEmit',
    },
    files: [{ path: 'src/index.ts', template: 'cli-tool/src/index.ts', desc: 'каркас CLI с двумя командами и флагами' }],
    note: 'Запусти: npm start -- --help',
  },
  {
    name: 'scraper',
    title: 'Скрейпер',
    icon: '🕷️',
    desc: 'Playwright, cheerio и ограничение параллелизма — сбор данных со страниц',
    items: [
      { name: 'playwright' },
      { name: 'cheerio' },
      { name: 'p-limit' },
      { name: 'dotenv' },
      { name: 'typescript', dev: true },
      { name: 'tsx', dev: true },
      { name: '@types/node', dev: true },
    ],
    scripts: {
      scrape: 'node src/scrape.ts',
      browsers: 'playwright install chromium',
      typecheck: 'tsc --noEmit',
    },
    env: { START_URL: 'https://news.ycombinator.com', CONCURRENCY: '4', HEADLESS: 'true' },
    files: [{ path: 'src/scrape.ts', template: 'scraper/src/scrape.ts', desc: 'обходит список ссылок и собирает заголовки' }],
    note: 'Один раз выполни npm run browsers, потом npm run scrape',
  },
  {
    name: 'worker-queue',
    title: 'Очередь задач',
    icon: '⚙️',
    desc: 'BullMQ + Redis: постановка задач, воркер, повторы и graceful shutdown',
    items: [
      { name: 'bullmq' },
      { name: 'ioredis' },
      { name: 'dotenv' },
      { name: 'zod' },
      { name: 'typescript', dev: true },
      { name: 'tsx', dev: true },
      { name: '@types/node', dev: true },
    ],
    scripts: {
      worker: 'node --watch src/worker.ts',
      enqueue: 'node src/queue.ts',
      typecheck: 'tsc --noEmit',
    },
    env: { REDIS_URL: 'redis://127.0.0.1:6379', QUEUE_NAME: 'jobs', CONCURRENCY: '5' },
    files: [
      { path: 'src/queue.ts', template: 'worker-queue/src/queue.ts', desc: 'описание очереди и пример постановки задачи' },
      { path: 'src/worker.ts', template: 'worker-queue/src/worker.ts', desc: 'воркер с логами и корректной остановкой' },
    ],
    note: 'Нужен Redis: docker run -d -p 6379:6379 redis — затем npm run worker',
  },
  {
    name: 'node-lib',
    title: 'Библиотека',
    icon: '📦',
    desc: 'tsup для сборки, vitest для тестов, строгий tsconfig',
    items: [
      { name: 'typescript', dev: true },
      { name: 'tsup', dev: true },
      { name: 'vitest', dev: true },
      { name: '@types/node', dev: true },
      { name: 'prettier', dev: true },
    ],
    scripts: {
      build: 'tsup src/index.ts --format esm,cjs --dts --clean',
      test: 'vitest run',
      'test:watch': 'vitest',
      typecheck: 'tsc --noEmit',
    },
    files: [
      { path: 'src/index.ts', template: 'node-lib/src/index.ts', desc: 'экспорт функции с типами' },
      { path: 'src/index.test.ts', template: 'node-lib/src/index.test.ts', desc: 'первый тест на vitest' },
    ],
    note: 'npm test — прогон тестов, npm run build — сборка в dist',
  },
];

export function findPreset(name: string): Preset | undefined {
  const key = name.trim().toLowerCase();
  return PRESETS.find((p) => p.name === key);
}

export function presetNames(): string[] {
  return PRESETS.map((p) => p.name);
}
