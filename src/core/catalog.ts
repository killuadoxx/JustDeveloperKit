// Базовый каталог магазина расширений.
//
// Это стартовая полка: то, что почти всегда нужно руками искать на npm.
// Каталог только засевается в базу — дальше он твой: правь описания,
// удаляй лишнее, добавляй свои пакеты. Пользовательские записи не трогаются
// никогда, даже если базовый каталог обновится.

export interface CatalogEntry {
  /** Имя пакета в npm. */
  name: string;
  /** Одна строка: что пакет делает и зачем он нужен. */
  desc: string;
  category: string;
  title?: string;
  tags?: string;
  url?: string;
  /** Ставится в devDependencies. */
  dev?: boolean;
  /** Спецификация для установки, если отличается от имени (например, с версией). */
  spec?: string;
  /** Подсказка: что нужно вместе с пакетом или после установки. */
  note?: string;
}

interface Extra {
  dev?: boolean;
  title?: string;
  tags?: string;
  note?: string;
  url?: string;
  spec?: string;
}

type Row = readonly [name: string, desc: string, extra?: Extra];

const GROUPS: readonly (readonly [category: string, icon: string, rows: readonly Row[]])[] = [
  [
    'Веб и API',
    '🌐',
    [
      ['express', 'Классический минималистичный веб-фреймворк'],
      ['fastify', 'Быстрый фреймворк со схемами валидации и плагинами'],
      ['koa', 'Асинхронный фреймворк от авторов Express'],
      ['hono', 'Крошечный фреймворк для Node, Bun, Deno и edge'],
      ['@hono/node-server', 'Запуск приложения Hono на Node', { title: 'Hono · Node-адаптер' }],
      ['socket.io', 'Realtime-соединения поверх WebSocket с фолбэками'],
      ['ws', 'Голый WebSocket-сервер без наворотов'],
      ['cors', 'Заголовки CORS одним middleware'],
      ['helmet', 'Набор защитных HTTP-заголовков'],
      ['morgan', 'Логирование HTTP-запросов в консоль'],
      ['compression', 'gzip и deflate для ответов сервера'],
      ['cookie-parser', 'Разбор Cookie в req.cookies'],
      ['multer', 'Загрузка файлов multipart/form-data'],
      ['express-rate-limit', 'Ограничение частоты запросов с одного IP'],
      ['passport', 'Аутентификация: стратегии, сессии, OAuth'],
      ['undici', 'HTTP-клиент из ядра Node: pool, keep-alive, без зависимостей'],
      ['axios', 'HTTP-клиент с интерцепторами и таймаутами'],
      ['ky', 'Маленькая обёртка над fetch с ретраями и хуками'],
      ['ofetch', 'fetch с автопарсингом JSON и повторами'],
      ['got', 'Мощный HTTP-клиент с ретраями, кэшем и потоками'],
      ['graphql', 'Язык запросов и рантайм для API'],
      ['@apollo/server', 'GraphQL-сервер Apollo', { title: 'Apollo Server' }],
      ['@trpc/server', 'End-to-end типизированный API без кодогенерации', { title: 'tRPC Server' }],
      ['@fastify/cors', 'CORS для Fastify', { title: 'Fastify · CORS' }],
      ['@fastify/helmet', 'Защитные заголовки для Fastify', { title: 'Fastify · Helmet' }],
      ['@nestjs/core', 'Каркас NestJS: DI, модули, декораторы', { title: 'NestJS Core', note: 'Обычно нужен вместе с @nestjs/common' }],
    ],
  ],
  [
    'Базы данных',
    '🗄️',
    [
      ['prisma', 'Схема, миграции и генерация типизированного клиента', { dev: true, note: 'Для запросов нужен ещё @prisma/client' }],
      ['@prisma/client', 'Сгенерированный клиент Prisma для запросов', { title: 'Prisma Client' }],
      ['drizzle-orm', 'TypeScript-first ORM поверх обычного SQL', { title: 'Drizzle ORM', tags: 'orm,sql,типы' }],
      ['drizzle-kit', 'Миграции и генерация схем для Drizzle', { dev: true, title: 'Drizzle Kit' }],
      ['typeorm', 'ORM с декораторами, миграциями и репозиториями'],
      ['sequelize', 'Проверенный ORM для SQL-баз'],
      ['mongoose', 'Схемы и модели для MongoDB'],
      ['mongodb', 'Официальный драйвер MongoDB'],
      ['kysely', 'Типобезопасный конструктор SQL-запросов'],
      ['knex', 'Конструктор запросов и миграции'],
      ['better-sqlite3', 'Синхронный SQLite: быстро, локально, без сервера'],
      ['sqlite3', 'Классический асинхронный драйвер SQLite'],
      ['pg', 'Драйвер PostgreSQL'],
      ['mysql2', 'Драйвер MySQL с промисами'],
      ['ioredis', 'Полноценный клиент Redis: кластеры, pub/sub, скрипты'],
      ['redis', 'Официальный клиент Redis'],
      ['lowdb', 'JSON-файл как база: настройки, кэши, мелкое состояние'],
    ],
  ],
  [
    'Telegram и боты',
    '📨',
    [
      ['grammy', 'Современный фреймворк Telegram-ботов на TypeScript', { tags: 'telegram,бот' }],
      ['@grammyjs/runner', 'Параллельная обработка апдейтов в grammy', { title: 'grammy · runner' }],
      ['@grammyjs/conversations', 'Диалоги и пошаговые сценарии в grammy', { title: 'grammy · conversations' }],
      ['@grammyjs/files', 'Скачивание и загрузка файлов в grammy', { title: 'grammy · files' }],
      ['telegraf', 'Популярный фреймворк Telegram-ботов'],
      ['node-telegram-bot-api', 'Простой клиент Telegram Bot API', { title: 'Telegram Bot API' }],
      ['discord.js', 'Библиотека для Discord-ботов', { tags: 'discord,бот' }],
      ['@slack/bolt', 'Фреймворк Slack-приложений и ботов', { title: 'Slack Bolt' }],
      ['vk-io', 'VK API для ботов и пользовательских токенов'],
    ],
  ],
  [
    'AI и LLM',
    '🧠',
    [
      ['openai', 'Официальный клиент OpenAI: чат, эмбеддинги, картинки'],
      ['@anthropic-ai/sdk', 'Клиент Claude от Anthropic', { title: 'Anthropic SDK' }],
      ['ai', 'Vercel AI SDK: стриминг и смена провайдеров', { title: 'AI SDK', tags: 'llm,streaming' }],
      ['@google/generative-ai', 'Клиент Gemini', { title: 'Google Gemini' }],
      ['langchain', 'Цепочки, память и инструменты для LLM'],
      ['ollama', 'Локальные модели через Ollama'],
      ['@modelcontextprotocol/sdk', 'Серверы и клиенты MCP для инструментов агента', { title: 'MCP SDK' }],
      ['tiktoken', 'Подсчёт токенов перед отправкой в модель'],
    ],
  ],
  [
    'Валидация и схемы',
    '🧾',
    [
      ['zod', 'Схемы и вывод типов из одного описания'],
      ['valibot', 'Модульная валидация с крошечным бандлом'],
      ['yup', 'Валидация с приведением типов'],
      ['joi', 'Строгие схемы для данных и конфигов'],
      ['ajv', 'Быстрая валидация по JSON Schema'],
      ['@sinclair/typebox', 'JSON Schema и типы TypeScript из одного описания', { title: 'TypeBox' }],
    ],
  ],
  [
    'Логи и мониторинг',
    '📈',
    [
      ['pino', 'Самый быстрый JSON-логгер для Node'],
      ['pino-pretty', 'Человекочитаемый вывод логов pino', { dev: true }],
      ['winston', 'Гибкие транспорты и уровни логирования'],
      ['signale', 'Красивые консольные статусы, таймеры и ожидание'],
      ['consola', 'Логи с уровнями, тегами и промптами'],
      ['@sentry/node', 'Ошибки и трейсы в Sentry с контекстом', { title: 'Sentry для Node' }],
      ['prom-client', 'Метрики для Prometheus из приложения'],
    ],
  ],
  [
    'CLI и терминал',
    '⌨️',
    [
      ['commander', 'Разбор аргументов и подкоманды'],
      ['yargs', 'Аргументы, справка и автодополнение'],
      ['cac', 'Минималистичный парсер команд'],
      ['meow', 'CLI-каркас с автогенерируемой справкой'],
      ['prompts', 'Простые интерактивные вопросы'],
      ['enquirer', 'Продвинутые промпты: автокомплит, формы'],
      ['@clack/prompts', 'Красивые промпты, спиннеры и рамки', { title: 'Clack' }],
      ['ora', 'Спиннер для долгих операций'],
      ['listr2', 'Список шагов с прогрессом и статусами'],
      ['cli-progress', 'Полоса прогресса для скриптов'],
      ['chalk', 'Цветной вывод в терминале'],
      ['picocolors', 'Цвет без зависимостей и почти без веса'],
      ['boxen', 'Рамки вокруг текста в терминале'],
      ['figlet', 'ASCII-надписи большими буквами'],
      ['gradient-string', 'Градиенты в консольном тексте'],
      ['cli-table3', 'Таблицы в терминале с рамками'],
      ['ink', 'React для терминальных интерфейсов'],
      ['blessed', 'Полноценные TUI: панели, окна, формы'],
      ['qrcode-terminal', 'QR-код прямо в терминале'],
    ],
  ],
  [
    'Тесты',
    '🧪',
    [
      ['vitest', 'Быстрый тест-раннер с нативным ESM', { dev: true }],
      ['jest', 'Классический тест-раннер и моки', { dev: true }],
      ['tsx', 'Запуск TypeScript без сборки и настройки', { dev: true }],
      ['ts-node', 'TypeScript прямо в Node через require-хук', { dev: true }],
      ['@vitest/coverage-v8', 'Покрытие кода для Vitest', { dev: true, title: 'Vitest Coverage' }],
      ['supertest', 'HTTP-проверки express и fastify приложений', { dev: true }],
      ['msw', 'Мок сетевых запросов в тестах и браузере', { dev: true }],
      ['nock', 'Перехват http-запросов в тестах', { dev: true }],
      ['@playwright/test', 'Браузерные e2e-тесты с автоповторами', { dev: true, title: 'Playwright Test' }],
      ['cypress', 'E2E-тесты в браузере с наглядным раннером', { dev: true }],
      ['@testing-library/react', 'Тесты React-компонентов как пользователь', { dev: true, title: 'Testing Library' }],
      ['c8', 'Покрытие на встроенном V8', { dev: true }],
    ],
  ],
  [
    'Утилиты',
    '🧰',
    [
      ['lodash-es', 'Сотни функций для коллекций, объектов и строк', { title: 'Lodash (ESM)' }],
      ['dayjs', 'Даты в 2 КБ с плагинами'],
      ['date-fns', 'Функциональная работа с датами'],
      ['luxon', 'Даты, часовые пояса и интервалы от авторов Moment'],
      ['nanoid', 'Короткие уникальные идентификаторы'],
      ['uuid', 'Уникальные идентификаторы по RFC 4122'],
      ['dotenv', 'Переменные из .env в process.env'],
      ['execa', 'Удобный запуск внешних процессов'],
      ['fs-extra', 'fs плюс ensureDir, copy и работа с JSON'],
      ['globby', 'Поиск файлов по glob-маскам'],
      ['fast-glob', 'Очень быстрый поиск по маскам'],
      ['chokidar', 'Наблюдение за файлами без лишних событий'],
      ['rimraf', 'rm -rf, который работает и на Windows'],
      ['cross-env', 'Переменные окружения в npm-скриптах на любой ОС'],
      ['semver', 'Разбор и сравнение версий'],
      ['ms', '"2 days" в миллисекунды и обратно'],
      ['slugify', 'Транслит и безопасные имена файлов'],
      ['p-limit', 'Ограничить число одновременных промисов'],
      ['p-queue', 'Очередь задач с приоритетами и паузами'],
      ['node-cache', 'Простой кэш в памяти с TTL'],
    ],
  ],
  [
    'Очереди и задачи',
    '⚙️',
    [
      ['bullmq', 'Очереди на Redis: повторы, задержки, воркеры'],
      ['bull', 'Классические очереди на Redis'],
      ['pg-boss', 'Очереди задач прямо в PostgreSQL'],
      ['amqplib', 'Клиент RabbitMQ'],
      ['kafkajs', 'Клиент Kafka без нативных зависимостей'],
      ['mqtt', 'Клиент MQTT для брокеров и IoT'],
      ['node-cron', 'Cron-расписания внутри процесса'],
      ['cron', 'Планировщик с поддержкой часовых поясов'],
      ['bree', 'Планировщик задач и воркеров'],
      ['agenda', 'Планировщик задач на MongoDB'],
    ],
  ],
  [
    'Парсинг и файлы',
    '📄',
    [
      ['cheerio', 'jQuery-подобный разбор HTML'],
      ['jsdom', 'Настоящий DOM в Node для тестов и парсинга'],
      ['playwright', 'Управление браузером: скрейпинг и автоматизация'],
      ['puppeteer', 'Chrome DevTools Protocol из Node'],
      ['csv-parse', 'Разбор CSV потоками, с заголовками и кавычками'],
      ['csv-stringify', 'Генерация CSV из объектов'],
      ['fast-xml-parser', 'Быстрый XML в JSON и обратно'],
      ['yaml', 'YAML без сюрпризов'],
      ['js-yaml', 'Классический парсер YAML'],
      ['marked', 'Markdown в HTML'],
      ['turndown', 'HTML в Markdown'],
      ['exceljs', 'Чтение и запись xlsx со стилями'],
      ['xlsx', 'SheetJS: таблицы почти любого формата', { tags: 'excel,таблицы' }],
      ['pdfkit', 'Генерация PDF из кода'],
      ['pdf-parse', 'Вытащить текст из PDF'],
      ['mammoth', 'docx в HTML и обычный текст'],
      ['archiver', 'ZIP и TAR из потоков'],
      ['adm-zip', 'Простой ZIP без нативных модулей'],
      ['sharp', 'Ресайз и конвертация картинок'],
      ['nodemailer', 'Отправка почты по SMTP'],
    ],
  ],
  [
    'Безопасность',
    '🔐',
    [
      ['jsonwebtoken', 'JWT: подпись и проверка токенов'],
      ['jose', 'JWT и JWE на Web Crypto, без зависимостей'],
      ['bcryptjs', 'bcrypt без нативной сборки'],
      ['bcrypt', 'Нативный bcrypt: быстрее на нагрузке'],
      ['argon2', 'Современное хеширование паролей'],
      ['otplib', 'TOTP и 2FA коды для входа'],
    ],
  ],
  [
    'Сборка и типы',
    '📦',
    [
      ['typescript', 'Компилятор и языковая поддержка типов', { dev: true }],
      ['tsup', 'Сборка библиотек на esbuild одной командой', { dev: true }],
      ['esbuild', 'Сборщик на Go: миллисекунды вместо секунд', { dev: true }],
      ['vite', 'Дев-сервер и сборка фронтенда', { dev: true }],
      ['rollup', 'Сборщик с аккуратным tree-shaking', { dev: true }],
      ['@swc/core', 'Транспиляция TypeScript на Rust', { dev: true, title: 'SWC' }],
      ['@types/node', 'Типы для стандартной библиотеки Node', { dev: true, title: 'Типы Node' }],
      ['@types/express', 'Типы для Express', { dev: true, title: 'Типы Express' }],
      ['nodemon', 'Перезапуск приложения при изменении файлов', { dev: true }],
      ['concurrently', 'Несколько npm-скриптов одной командой', { dev: true }],
      ['@changesets/cli', 'Версии и CHANGELOG для пакетов', { dev: true, title: 'Changesets' }],
    ],
  ],
  [
    'Качество кода',
    '✨',
    [
      ['prettier', 'Единый формат кода без споров', { dev: true }],
      ['eslint', 'Линтер с правилами под любой стиль', { dev: true }],
      ['typescript-eslint', 'Правила ESLint, понимающие типы', { dev: true }],
      ['@biomejs/biome', 'Линтер и форматтер в одном бинарнике', { dev: true, title: 'Biome' }],
      ['husky', 'Git-хуки, которые работают у всей команды', { dev: true }],
      ['lint-staged', 'Линт и формат только изменённых файлов', { dev: true }],
      ['@commitlint/cli', 'Проверка сообщений коммитов', { dev: true, title: 'commitlint' }],
      ['commitizen', 'Помощник в написании коммитов', { dev: true }],
    ],
  ],
  [
    'Инфраструктура',
    '🖥️',
    [
      ['dockerode', 'Docker API из Node: контейнеры, логи, exec'],
      ['@aws-sdk/client-s3', 'S3: бакеты, объекты, presigned-ссылки', { title: 'AWS S3' }],
      ['minio', 'Клиент MinIO и совместимых хранилищ'],
      ['pm2', 'Менеджер процессов, кластер и автозапуск', { dev: true }],
    ],
  ],
];

export const CATALOG: CatalogEntry[] = GROUPS.flatMap(([category, , rows]) =>
  rows.map(([name, desc, extra]) => ({
    name,
    desc,
    category,
    url: `https://www.npmjs.com/package/${name}`,
    ...(extra ?? {}),
  })),
);

export const CATEGORIES: string[] = GROUPS.map(([category]) => category);

export const CATEGORY_ICON: Record<string, string> = Object.fromEntries(
  GROUPS.map(([category, icon]) => [category, icon]),
);

/** Иконка раздела: у пользовательских разделов её нет — берём нейтральную. */
export function categoryIcon(category: string): string {
  return CATEGORY_ICON[category] ?? '📦';
}

/** Человеческое имя пакета: без scope, с заглавной буквы. */
export function prettifyPackageName(name: string): string {
  const base = name.startsWith('@') ? (name.split('/')[1] ?? name) : name;
  return base
    .split(/[-_.]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
